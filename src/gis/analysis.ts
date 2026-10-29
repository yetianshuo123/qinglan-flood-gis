import { area as turfArea, polygon } from '@turf/turf'
import type { Geometry } from 'geojson'
import type {
  AreaStats,
  CityData,
  FeatureDetail,
  LonLat,
  ModelResult,
  RoadImpact,
} from './types'
import {
  cellAreaAtRow,
  cellCenter,
  distanceMeters,
  lonLatToCell,
  pointToLineDistanceMeters,
  polylineLengthMeters,
  sampleGrid,
  sampleLine,
} from './grid'
import { FLOOD_THRESHOLD_M, RISK_LABELS } from './model'
import { pointInRing } from './city'

export function formatArea(m2: number): string {
  if (m2 >= 1_000_000) return `${(m2 / 1_000_000).toFixed(2)} km²`
  if (m2 >= 10_000) return `${(m2 / 10_000).toFixed(1)} ha`
  return `${Math.round(m2)} m²`
}

export function formatLength(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`
  return `${Math.round(m)} m`
}

export function formatDepth(m: number): string {
  if (m < 0.005) return '0.00 m'
  if (m < 0.1) return `${(m * 100).toFixed(1)} cm`
  return `${m.toFixed(2)} m`
}

export function riskName(r: number): string {
  return RISK_LABELS[r] ?? '未知'
}

interface CellHit {
  i: number
  lon: number
  lat: number
  areaM2: number
  elev: number
  rain: number
  depth: number
  risk: number
}

function collectCells(
  city: CityData,
  model: ModelResult,
  ring: LonLat[],
): { cells: CellHit[]; polygonAreaM2: number } {
  let minLon = Infinity
  let maxLon = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const p of ring) {
    minLon = Math.min(minLon, p[0])
    maxLon = Math.max(maxLon, p[0])
    minLat = Math.min(minLat, p[1])
    maxLat = Math.max(maxLat, p[1])
  }
  const { cols, rows } = city.terrain.dem
  const cells: CellHit[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = cellCenter(city.terrain.dem, row, col)
      if (c[0] < minLon || c[0] > maxLon || c[1] < minLat || c[1] > maxLat) continue
      if (!pointInRing(c, ring)) continue
      const i = row * cols + col
      cells.push({
        i,
        lon: c[0],
        lat: c[1],
        areaM2: cellAreaAtRow(model.depth, row),
        elev: city.terrain.dem.values[i],
        rain: model.rain.values[i],
        depth: model.depth.values[i],
        risk: model.risk[i],
      })
    }
  }
  const polygonAreaM2 = Math.round(turfArea(polygon([ring])))
  return { cells, polygonAreaM2 }
}

export function computeAreaStats(
  city: CityData,
  model: ModelResult,
  ring: LonLat[],
): AreaStats {
  const { cells, polygonAreaM2 } = collectCells(city, model, ring)
  const riskAreaM2: [number, number, number, number, number] = [0, 0, 0, 0, 0]
  let elevSum = 0
  let minElev = Infinity
  let maxElev = -Infinity
  let rainSum = 0
  let depthSum = 0
  let maxDepth = 0
  let floodedAreaM2 = 0
  let deepestPoint: LonLat | null = null

  for (const cell of cells) {
    riskAreaM2[cell.risk] += cell.areaM2
    elevSum += cell.elev
    minElev = Math.min(minElev, cell.elev)
    maxElev = Math.max(maxElev, cell.elev)
    rainSum += cell.rain
    depthSum += cell.depth
    if (cell.depth >= FLOOD_THRESHOLD_M) floodedAreaM2 += cell.areaM2
    if (cell.depth > maxDepth) {
      maxDepth = cell.depth
      deepestPoint = [cell.lon, cell.lat]
    }
  }

  const roads: AreaStats['roads'] = []
  let roadLengthInAreaM = 0
  let floodedRoadLengthM = 0
  for (const f of city.roads.features) {
    const coords = f.geometry.coordinates as LonLat[]
    const samples = sampleLine(coords, 30)
    let inside = 0
    let flooded = 0
    for (const s of samples) {
      if (!pointInRing(s.point, ring)) continue
      inside++
      const d = sampleGrid(model.depth, s.point[0], s.point[1])
      if (d >= FLOOD_THRESHOLD_M) flooded++
    }
    if (inside > 0) {
      const lengthInArea = inside * 30
      const floodedLen = flooded * 30
      roadLengthInAreaM += lengthInArea
      floodedRoadLengthM += floodedLen
      roads.push({
        id: f.properties.id,
        name: f.properties.name,
        lengthInAreaM: lengthInArea,
        floodedLengthM: floodedLen,
      })
    }
  }

  const buildings: AreaStats['buildings'] = []
  let floodedBuildings = 0
  for (const f of city.buildings.features) {
    const r = f.geometry.coordinates[0] as LonLat[]
    const c = ringCentroid(r)
    if (!pointInRing(c, ring)) continue
    const d = sampleGrid(model.depth, c[0], c[1])
    const cell = lonLatToCell(model.depth, c[0], c[1])
    const risk = model.risk[cell.row * model.depth.cols + cell.col]
    if (d >= 0.05) floodedBuildings++
    buildings.push({
      id: f.properties.id,
      name: f.properties.name,
      buildingType: f.properties.buildingType,
      depth: d,
      risk,
    })
  }

  return {
    areaM2: polygonAreaM2,
    cellCount: cells.length,
    avgElev: cells.length ? elevSum / cells.length : null,
    minElev: Number.isFinite(minElev) ? minElev : null,
    maxElev: Number.isFinite(maxElev) ? maxElev : null,
    meanRainMmH: cells.length ? rainSum / cells.length : null,
    totalRainMm: cells.length ? (rainSum / cells.length) * model.scenario.durationH : null,
    avgDepth: cells.length ? depthSum / cells.length : null,
    maxDepth,
    floodedAreaM2,
    riskAreaM2: riskAreaM2.map((v) => Math.round(v)) as [
      number,
      number,
      number,
      number,
      number,
    ],
    roads,
    roadLengthInAreaM,
    floodedRoadLengthM,
    buildings,
    floodedBuildings,
    deepestPoint,
  }
}

export function ringCentroid(ring: LonLat[]): LonLat {
  let x = 0
  let y = 0
  const n = ring.length > 1 ? ring.length - 1 : ring.length
  for (let i = 0; i < n; i++) {
    x += ring[i][0]
    y += ring[i][1]
  }
  return [x / n, y / n]
}

function nearestRoad(city: CityData, lon: number, lat: number) {
  let best: { name: string; id: string; distance: number } | null = null
  for (const f of city.roads.features) {
    const d = pointToLineDistanceMeters(
      lon,
      lat,
      f.geometry.coordinates as LonLat[],
    )
    if (!best || d < best.distance) {
      best = { name: f.properties.name, id: f.properties.id, distance: d }
    }
  }
  return best
}

function nearestHydro(city: CityData, lon: number, lat: number) {
  let best: { name: string; id: string; distance: number; kind: string } | null = null
  for (const f of city.hydro.features) {
    const d = pointToLineDistanceMeters(
      lon,
      lat,
      f.geometry.coordinates as LonLat[],
    )
    if (!best || d < best.distance) {
      best = {
        name: f.properties.name,
        id: f.properties.id,
        distance: d,
        kind: f.properties.kind,
      }
    }
  }
  return best
}

function nearestPump(city: CityData, lon: number, lat: number) {
  let best: { name: string; distance: number; capacity: number } | null = null
  for (const f of city.pumps.features) {
    const c = f.geometry.coordinates as LonLat
    const d = distanceMeters([lon, lat], c)
    if (!best || d < best.distance) {
      best = { name: f.properties.name, distance: d, capacity: f.properties.capacityM3s }
    }
  }
  return best
}

function nearestFloodedDistanceM(
  model: ModelResult,
  lon: number,
  lat: number,
): number {
  if (sampleGrid(model.depth, lon, lat) >= FLOOD_THRESHOLD_M) return 0
  let best = Infinity
  for (let row = 0; row < model.depth.rows; row++) {
    for (let col = 0; col < model.depth.cols; col++) {
      if (model.depth.values[row * model.depth.cols + col] < FLOOD_THRESHOLD_M) continue
      const c = cellCenter(model.depth, row, col)
      const d = distanceMeters([lon, lat], c)
      if (d < best) best = d
    }
  }
  return best
}

function lowlandsAt(city: CityData, point: LonLat): string[] {
  return city.lowlands.features
    .filter((f) => pointInRing(point, f.geometry.coordinates[0] as LonLat[]))
    .map((f) => f.properties.name)
}

export interface PointQuery {
  lon: number
  lat: number
  elevation: number
  rainMmH: number
  depth: number
  risk: number
  district: string | null
  lowlands: string[]
  floodedDistanceM: number
  nearestRoad: { name: string; distance: number } | null
  nearestHydro: { name: string; distance: number; kind: string } | null
  nearestPump: { name: string; distance: number } | null
  nearestBuilding: { name: string; buildingType: string; distance: number } | null
}

/** 地图点查询：直接采样当前情景栅格并做邻近要素分析 */
export function queryPoint(
  city: CityData,
  model: ModelResult,
  lon: number,
  lat: number,
): PointQuery {
  const elevation = sampleGrid(city.terrain.dem, lon, lat)
  const rainMmH = sampleGrid(model.rain, lon, lat)
  const depth = sampleGrid(model.depth, lon, lat)
  const cell = lonLatToCell(model.depth, lon, lat)
  const risk = model.risk[cell.row * model.depth.cols + cell.col]

  let district: string | null = null
  for (const f of city.districts.features) {
    if (pointInRing([lon, lat], f.geometry.coordinates[0] as LonLat[])) {
      district = f.properties.name
      break
    }
  }

  let nearestBuilding: PointQuery['nearestBuilding'] = null
  for (const f of city.buildings.features) {
    const c = ringCentroid(f.geometry.coordinates[0] as LonLat[])
    const d = distanceMeters([lon, lat], c)
    if (!nearestBuilding || d < nearestBuilding.distance) {
      nearestBuilding = {
        name: f.properties.name,
        buildingType: f.properties.buildingType,
        distance: d,
      }
    }
  }

  return {
    lon,
    lat,
    elevation,
    rainMmH,
    depth,
    risk,
    district,
    lowlands: lowlandsAt(city, [lon, lat]),
    floodedDistanceM: nearestFloodedDistanceM(model, lon, lat),
    nearestRoad: nearestRoad(city, lon, lat),
    nearestHydro: nearestHydro(city, lon, lat),
    nearestPump: nearestPump(city, lon, lat),
    nearestBuilding,
  }
}

export function buildFeatureDetail(
  city: CityData,
  model: ModelResult,
  kind: string,
  props: Record<string, unknown>,
  geometry: Geometry,
): FeatureDetail {
  const riskColorTone = (risk: number): 'ok' | 'warn' | 'danger' =>
    risk >= 3 ? 'danger' : risk >= 2 ? 'warn' : 'ok'

  if (kind === 'building') {
    const ring = (geometry as unknown as { coordinates: LonLat[][] }).coordinates[0]
    const c = ringCentroid(ring)
    const elev = sampleGrid(city.terrain.dem, c[0], c[1])
    const depth = sampleGrid(model.depth, c[0], c[1])
    const cell = lonLatToCell(model.depth, c[0], c[1])
    const risk = model.risk[cell.row * model.depth.cols + cell.col]
    const road = nearestRoad(city, c[0], c[1])
    const hydro = nearestHydro(city, c[0], c[1])
    const floodDist = nearestFloodedDistanceM(model, c[0], c[1])
    const lowlands = lowlandsAt(city, c)
    const hit = model.metrics.affectedBuildings.find((b) => b.id === props.id)
    return {
      kind: '建筑',
      id: String(props.id),
      title: String(props.name),
      subtitle: `${props.buildingType} · ${props.district}`,
      sections: [
        {
          title: '基本信息',
          rows: [
            { label: '建筑编号', value: String(props.id) },
            { label: '建筑类型', value: String(props.buildingType) },
            { label: '所在分区', value: String(props.district) },
            { label: '层数 / 高度', value: `${props.floors} 层 / ${props.heightM} m` },
            { label: '基底面积', value: formatArea(Number(props.footprintM2)) },
            { label: '地面高程', value: `${elev.toFixed(2)} m` },
          ],
        },
        {
          title: '当前情景空间关系',
          rows: [
            {
              label: '所在位置积水深度',
              value: formatDepth(depth),
              tone: depth >= 0.1 ? 'danger' : depth >= FLOOD_THRESHOLD_M ? 'warn' : 'ok',
            },
            { label: '内涝风险等级', value: riskName(risk), tone: riskColorTone(risk) },
            {
              label: '距最近积水网格',
              value: floodDist === 0 ? '位于积水区内' : formatLength(floodDist),
              tone: floodDist === 0 ? 'warn' : undefined,
            },
            {
              label: '是否位于低洼区',
              value: lowlands.length ? lowlands.join('、') : '否',
              tone: lowlands.length ? 'warn' : undefined,
            },
          ],
        },
        {
          title: '邻近要素',
          rows: [
            {
              label: '最近道路',
              value: road ? `${road.name} · ${formatLength(road.distance)}` : '无',
            },
            {
              label: '最近水系',
              value: hydro ? `${hydro.name} · ${formatLength(hydro.distance)}` : '无',
            },
            {
              label: '受影响判定',
              value: hit ? `是（模拟水深 ${formatDepth(hit.depth)}）` : '否（水深低于 5 cm）',
              tone: hit ? 'danger' : 'ok',
            },
          ],
        },
      ],
      note: '以上关系由当前情景栅格与矢量要素实时计算。',
    }
  }

  if (kind === 'road') {
    const coords = (geometry as unknown as { coordinates: LonLat[] }).coordinates
    const mid = coords[Math.floor(coords.length / 2)]
    const samples = sampleLine(coords, 25)
    let maxDepth = 0
    let flooded = 0
    const lowlandNames = new Set<string>()
    for (const s of samples) {
      const d = sampleGrid(model.depth, s.point[0], s.point[1])
      if (d > maxDepth) maxDepth = d
      if (d >= FLOOD_THRESHOLD_M) flooded++
      for (const name of lowlandsAt(city, s.point)) lowlandNames.add(name)
    }
    const floodedLength = (flooded / samples.length) * Number(props.lengthM)
    const affected = model.metrics.affectedRoads.find((r) => r.id === props.id)
    let nearbyBuildings = 0
    for (const f of city.buildings.features) {
      const c = ringCentroid(f.geometry.coordinates[0] as LonLat[])
      if (pointToLineDistanceMeters(c[0], c[1], coords) < 100) nearbyBuildings++
    }
    return {
      kind: '道路',
      id: String(props.id),
      title: String(props.name),
      subtitle: `${props.roadClass} · ${props.district}`,
      sections: [
        {
          title: '基本信息',
          rows: [
            { label: '道路编号', value: String(props.id) },
            { label: '道路等级', value: String(props.roadClass) },
            { label: '车道数', value: `${props.lanes} 车道` },
            { label: '路面类型', value: String(props.surface) },
            { label: '道路长度', value: formatLength(Number(props.lengthM)) },
            { label: '跨越河道', value: props.bridge ? '是（跨河桥涵）' : '否' },
          ],
        },
        {
          title: '当前情景积涝关系',
          rows: [
            {
              label: '沿线最大水深',
              value: formatDepth(maxDepth),
              tone: maxDepth >= 0.18 ? 'danger' : maxDepth >= FLOOD_THRESHOLD_M ? 'warn' : 'ok',
            },
            {
              label: '积水路段长度',
              value: `${formatLength(floodedLength)}（${Math.round((floodedLength / Number(props.lengthM)) * 1000) / 10}%）`,
              tone: floodedLength > 0 ? 'warn' : 'ok',
            },
            {
              label: '受影响判定',
              value: affected ? '是（超过 30 m 积水）' : '否',
              tone: affected ? 'danger' : 'ok',
            },
            {
              label: '穿越低洼区',
              value: lowlandNames.size ? Array.from(lowlandNames).join('、') : '无',
            },
            { label: '100 m 内建筑', value: `${nearbyBuildings} 栋` },
          ],
        },
        {
          title: '位置',
          rows: [
            { label: '中点经度', value: mid[0].toFixed(5) },
            { label: '中点纬度', value: mid[1].toFixed(5) },
          ],
        },
      ],
      note: '沿线积水按 25 m 间隔采样栅格计算。',
    }
  }

  if (kind === 'river' || kind === 'canal') {
    const coords = (geometry as unknown as { coordinates: LonLat[] }).coordinates
    const mid = coords[Math.floor(coords.length / 2)]
    const samples = sampleLine(coords, 60)
    let elevSum = 0
    let minElev = Infinity
    for (const s of samples) {
      const e = sampleGrid(city.terrain.dem, s.point[0], s.point[1])
      elevSum += e
      minElev = Math.min(minElev, e)
    }
    const meanElev = samples.length ? elevSum / samples.length : 0
    const pump = nearestPump(city, mid[0], mid[1])
    return {
      kind: props.kind === 'river' ? '河流' : '排水渠',
      id: String(props.id),
      title: String(props.name),
      subtitle: props.kind === 'river' ? '天然河道 · 受纳水体' : '人工排水设施',
      sections: [
        {
          title: '设施属性',
          rows: [
            { label: '设施编号', value: String(props.id) },
            { label: '类型', value: props.kind === 'river' ? '河流' : '排水渠' },
            { label: '长度', value: formatLength(polylineLengthMeters(coords)) },
            { label: '宽度', value: `${props.widthM} m` },
            { label: '设计排水能力', value: `${props.capacityM3s} m³/s` },
            { label: '沿线平均高程', value: `${meanElev.toFixed(2)} m` },
            { label: '沿线最低高程', value: `${minElev.toFixed(2)} m` },
          ],
        },
        {
          title: '空间关系',
          rows: [
            {
              label: '最近泵站',
              value: pump ? `${pump.name} · ${formatLength(pump.distance)}` : '无',
            },
            {
              label: '当前河道积水',
              value: formatDepth(
                sampleGrid(model.depth, mid[0], mid[1]),
              ),
            },
            {
              label: '排水范围影响',
              value: '河道两侧 600 m 内排水能力按距离衰减计入模型',
            },
          ],
        },
      ],
      note: '水系作为排水边界，不参与建筑/道路统计。',
    }
  }

  if (kind === 'lowland') {
    const ring = (geometry as unknown as { coordinates: LonLat[][] }).coordinates[0]
    const stats = computeAreaStats(city, model, ring)
    const pump = nearestPump(city, stats.deepestPoint?.[0] ?? ring[0][0], stats.deepestPoint?.[1] ?? ring[0][1])
    const floodedPct = stats.areaM2 ? (stats.floodedAreaM2 / stats.areaM2) * 100 : 0
    const maxDepth = stats.maxDepth ?? 0
    return {
      kind: '低洼区',
      id: String(props.id),
      title: String(props.name),
      subtitle: `${props.district} · 洼地`,
      sections: [
        {
          title: '地形属性',
          rows: [
            { label: '洼地编号', value: String(props.id) },
            { label: '洼地面积', value: formatArea(stats.areaM2) },
            { label: '平均高程', value: `${Number(props.meanElev).toFixed(1)} m` },
            { label: '最低高程', value: `${Number(props.minElev).toFixed(1)} m` },
            { label: '估算滞蓄容积', value: `${(Number(props.storageM3) / 10000).toFixed(1)} 万 m³` },
            {
              label: '最近泵站',
              value: pump ? `${pump.name} · ${formatLength(pump.distance)}` : '无',
            },
          ],
        },
        {
          title: '当前情景积水',
          rows: [
            {
              label: '积水面积',
              value: `${formatArea(stats.floodedAreaM2)}（${floodedPct.toFixed(1)}%）`,
              tone: floodedPct > 30 ? 'danger' : floodedPct > 5 ? 'warn' : 'ok',
            },
            { label: '最大水深', value: formatDepth(maxDepth), tone: maxDepth >= 0.18 ? 'danger' : 'warn' },
            {
              label: '受影响建筑',
              value: `${stats.floodedBuildings} / ${stats.buildings.length} 栋`,
            },
            {
              label: '高风险及以上面积',
              value: formatArea(stats.riskAreaM2[3] + stats.riskAreaM2[4]),
            },
          ],
        },
      ],
      note: '低洼区为虚拟城市洼地概化边界，统计按网格中心落区计算。',
    }
  }

  if (kind === 'pump') {
    const c = (geometry as unknown as { coordinates: LonLat }).coordinates
    const hydro = nearestHydro(city, c[0], c[1])
    let nearArea = 0
    let nearFlooded = 0
    for (let row = 0; row < model.depth.rows; row++) {
      for (let col = 0; col < model.depth.cols; col++) {
        const cc = cellCenter(model.depth, row, col)
        if (distanceMeters(c, cc) > 500) continue
        const a = cellAreaAtRow(model.depth, row)
        nearArea += a
        if (model.depth.values[row * model.depth.cols + col] >= FLOOD_THRESHOLD_M) {
          nearFlooded += a
        }
      }
    }
    return {
      kind: '泵站',
      id: String(props.id),
      title: String(props.name),
      subtitle: `${props.district} · 排涝设施`,
      sections: [
        {
          title: '设施属性',
          rows: [
            { label: '泵站编号', value: String(props.id) },
            { label: '排涝能力', value: `${props.capacityM3s} m³/s` },
            { label: '所在分区', value: String(props.district) },
            {
              label: '最近水系',
              value: hydro ? `${hydro.name} · ${formatLength(hydro.distance)}` : '无',
            },
          ],
        },
        {
          title: '500 m 服务范围（当前情景）',
          rows: [
            {
              label: '积水面积占比',
              value: nearArea ? `${((nearFlooded / nearArea) * 100).toFixed(1)}%` : '—',
              tone: nearFlooded > 0 ? 'warn' : 'ok',
            },
            { label: '范围内积水面积', value: formatArea(nearFlooded) },
          ],
        },
      ],
    }
  }

  if (kind === 'park') {
    const ring = (geometry as unknown as { coordinates: LonLat[][] }).coordinates[0]
    const stats = computeAreaStats(city, model, ring)
    const floodedPct = stats.areaM2 ? (stats.floodedAreaM2 / stats.areaM2) * 100 : 0
    return {
      kind: '绿地',
      id: String(props.id),
      title: String(props.name),
      subtitle: `${String(props.parkType)} · ${String(props.district)}`,
      sections: [
        {
          title: '绿地概况',
          rows: [
            { label: '绿地类型', value: String(props.parkType) },
            { label: '绿地面积', value: formatArea(Number(props.areaM2)) },
          ],
        },
        {
          title: '当前情景积涝',
          rows: [
            {
              label: '积水面积占比',
              value: `${floodedPct.toFixed(1)}%`,
              tone: floodedPct > 20 ? 'danger' : floodedPct > 5 ? 'warn' : 'ok',
            },
            {
              label: '平均高程',
              value: stats.avgElev === null ? '—' : `${stats.avgElev.toFixed(1)} m`,
            },
            {
              label: '高风险及以上面积',
              value: formatArea(stats.riskAreaM2[3] + stats.riskAreaM2[4]),
            },
          ],
        },
      ],
    }
  }

  if (kind === 'district') {
    const ring = (geometry as unknown as { coordinates: LonLat[][] }).coordinates[0]
    const stats = computeAreaStats(city, model, ring)
    const totalBuildings = city.buildings.features.filter(
      (f) => f.properties.district === props.name,
    ).length
    const totalRoads = city.roads.features.filter(
      (f) => f.properties.district === props.name,
    ).length
    const floodedPct = stats.areaM2 ? (stats.floodedAreaM2 / stats.areaM2) * 100 : 0
    return {
      kind: '分区',
      id: String(props.id),
      title: `${String(props.name)}（虚拟）`,
      subtitle: `行政分区 · ${String(props.code)}`,
      sections: [
        {
          title: '分区概况',
          rows: [
            { label: '分区面积', value: formatArea(stats.areaM2) },
            { label: '建筑数量', value: `${totalBuildings} 栋` },
            { label: '道路数量', value: `${totalRoads} 条` },
          ],
        },
        {
          title: '当前情景积涝',
          rows: [
            {
              label: '积水面积占比',
              value: `${floodedPct.toFixed(1)}%`,
              tone: floodedPct > 20 ? 'danger' : floodedPct > 5 ? 'warn' : 'ok',
            },
            { label: '高风险及以上面积', value: formatArea(stats.riskAreaM2[3] + stats.riskAreaM2[4]) },
            { label: '受影响建筑', value: `${stats.floodedBuildings} 栋` },
          ],
        },
      ],
    }
  }

  return {
    kind: '要素',
    id: String(props.id ?? '—'),
    title: String(props.name ?? '未命名要素'),
    subtitle: '空间要素',
    sections: [
      {
        title: '属性',
        rows: Object.entries(props)
          .filter(([k]) => k !== 'kind')
          .slice(0, 10)
          .map(([k, v]) => ({ label: k, value: String(v) })),
      },
    ],
  }
}

export interface OverlayFinding {
  id: string
  title: string
  method: string
  summary: string
  metrics: { label: string; value: string; tone?: 'warn' | 'danger' | 'ok' }[]
  details: { label: string; value: string; point: LonLat }[]
  locate: LonLat | null
}

export function analyzeLowlandFlooding(
  city: CityData,
  model: ModelResult,
): OverlayFinding {
  interface Row {
    name: string
    area: number
    flooded: number
    pct: number
    maxDepth: number
    point: LonLat
  }
  const rows: Row[] = []
  for (const f of city.lowlands.features) {
    const ring = f.geometry.coordinates[0] as LonLat[]
    const { cells, polygonAreaM2 } = collectCells(city, model, ring)
    let flooded = 0
    let maxDepth = 0
    let deepest = ringCentroid(ring)
    for (const c of cells) {
      if (c.depth >= FLOOD_THRESHOLD_M) flooded += c.areaM2
      if (c.depth > maxDepth) {
        maxDepth = c.depth
        deepest = [c.lon, c.lat]
      }
    }
    rows.push({
      name: f.properties.name,
      area: polygonAreaM2,
      flooded,
      pct: polygonAreaM2 ? (flooded / polygonAreaM2) * 100 : 0,
      maxDepth,
      point: deepest,
    })
  }
  rows.sort((a, b) => b.pct - a.pct)
  const totalArea = rows.reduce((s, r) => s + r.area, 0)
  const totalFlooded = rows.reduce((s, r) => s + r.flooded, 0)
  const share = model.metrics.floodedAreaM2
    ? (totalFlooded / model.metrics.floodedAreaM2) * 100
    : 0
  const worst = rows[0]
  return {
    id: 'lowland-flood',
    title: '低洼区 × 积水区叠加',
    method: '以低洼区边界裁剪积水栅格，统计网格中心落入洼地内的积水面积。',
    summary: worst
      ? `${worst.name} 的 ${worst.pct.toFixed(1)}% 面积出现积水（最大 ${formatDepth(worst.maxDepth)}）；全部低洼区承接了全城 ${share.toFixed(0)}% 的积水面积。`
      : '当前情景无低洼区积水。',
    metrics: [
      { label: '低洼区总面积', value: formatArea(totalArea) },
      { label: '洼地内积水面积', value: formatArea(totalFlooded), tone: totalFlooded > 0 ? 'warn' : 'ok' },
      { label: '占全城积水', value: `${share.toFixed(0)}%` },
      { label: '最高洼地积水率', value: worst ? `${worst.pct.toFixed(1)}%` : '—', tone: 'danger' },
    ],
    details: rows.slice(0, 5).map((r) => ({
      label: r.name,
      value: `积水 ${r.pct.toFixed(1)}% · 最大 ${formatDepth(r.maxDepth)}`,
      point: r.point,
    })),
    locate: worst?.point ?? null,
  }
}

export function analyzeRoadFlooding(
  city: CityData,
  model: ModelResult,
): OverlayFinding {
  const affected = model.metrics.affectedRoads
  const totalFloodedLength = affected.reduce((s, r) => s + r.floodedLengthM, 0)
  const worst = affected[0]
  const top5 = affected.slice(0, 5)
  return {
    id: 'road-flood',
    title: '道路 × 积水区叠加',
    method: '沿每条道路每 25 m 采样积水栅格；连续积水累计长度 ≥ 30 m 判定为受影响。',
    summary: worst
      ? `${affected.length} / ${city.roads.features.length} 条道路受影响，累计积水路段 ${formatLength(totalFloodedLength)}；${worst.name} 最严重（${formatLength(worst.floodedLengthM)}，最大 ${formatDepth(worst.maxDepth)}）。`
      : '当前情景无道路达到受影响阈值。',
    metrics: [
      { label: '受影响道路', value: `${affected.length} 条`, tone: affected.length ? 'warn' : 'ok' },
      { label: '积水路段总长', value: formatLength(totalFloodedLength) },
      { label: '最严重道路', value: worst?.name ?? '—' },
      { label: '最大路段水深', value: worst ? formatDepth(worst.maxDepth) : '—', tone: 'danger' },
    ],
    details: top5.map((r: RoadImpact) => ({
      label: r.name,
      value: `积水 ${formatLength(r.floodedLengthM)}（${r.floodedPct}%）· 最大 ${formatDepth(r.maxDepth)}`,
      point: r.point,
    })),
    locate: worst?.point ?? null,
  }
}

export function analyzeBuildingRisk(
  city: CityData,
  model: ModelResult,
): OverlayFinding {
  const affected = model.metrics.affectedBuildings
  const high = affected.filter((b) => b.risk >= 3)
  const worst = affected[0]
  const districtCount: Record<string, number> = {}
  for (const b of affected) districtCount[b.district] = (districtCount[b.district] ?? 0) + 1
  const topDistrict = Object.entries(districtCount).sort((a, b) => b[1] - a[1])[0]
  return {
    id: 'building-risk',
    title: '建筑 × 高风险区叠加',
    method: '以建筑基底中心采样积水深度，深度 ≥ 5 cm 判定为受影响；风险等级取所在网格。',
    summary: worst
      ? `${affected.length} 栋建筑受影响，其中 ${high.length} 栋位于高风险及以上网格；${worst.name} 积水最深（${formatDepth(worst.depth)}）。`
      : '当前情景无建筑受影响。',
    metrics: [
      {
        label: '受影响建筑',
        value: `${affected.length} / ${city.buildings.features.length} 栋`,
        tone: affected.length ? 'warn' : 'ok',
      },
      { label: '高风险及以上', value: `${high.length} 栋`, tone: high.length ? 'danger' : 'ok' },
      { label: '涉及分区', value: topDistrict ? `${topDistrict[0]}（${topDistrict[1]} 栋）` : '—' },
      { label: '最大建筑处水深', value: worst ? formatDepth(worst.depth) : '—', tone: 'danger' },
    ],
    details: affected.slice(0, 5).map((b) => ({
      label: b.name,
      value: `${b.buildingType} · ${formatDepth(b.depth)} · ${riskName(b.risk)}`,
      point: b.point,
    })),
    locate: worst?.point ?? null,
  }
}

export function analyzeRainDepth(
  city: CityData,
  model: ModelResult,
): OverlayFinding {
  const rain = model.rain.values
  const depth = model.depth.values
  const n = rain.length
  let sumR = 0
  let sumD = 0
  for (let i = 0; i < n; i++) {
    sumR += rain[i]
    sumD += depth[i]
  }
  const meanR = sumR / n
  const meanD = sumD / n
  let cov = 0
  let varR = 0
  let varD = 0
  for (let i = 0; i < n; i++) {
    const dr = rain[i] - meanR
    const dd = depth[i] - meanD
    cov += dr * dd
    varR += dr * dr
    varD += dd * dd
  }
  const corr = varR > 0 && varD > 0 ? cov / Math.sqrt(varR * varD) : 0

  const sortedRain = Array.from(rain).sort((a, b) => a - b)
  const p75 = sortedRain[Math.floor(0.75 * (n - 1))]
  const p50 = sortedRain[Math.floor(0.5 * (n - 1))]
  let highRainDry = 0
  let lowRainWet = 0
  let cityArea = 0
  let mismatchPoint: LonLat | null = null
  let maxMismatchDepth = 0
  for (let row = 0; row < model.depth.rows; row++) {
    const area = cellAreaAtRow(model.depth, row)
    cityArea += area * model.depth.cols
    for (let col = 0; col < model.depth.cols; col++) {
      const i = row * model.depth.cols + col
      const c = cellCenter(model.depth, row, col)
      if (rain[i] >= p75 && depth[i] < FLOOD_THRESHOLD_M) highRainDry += area
      if (rain[i] <= p50 && depth[i] >= FLOOD_THRESHOLD_M) {
        lowRainWet += area
        if (depth[i] > maxMismatchDepth) {
          maxMismatchDepth = depth[i]
          mismatchPoint = c
        }
      }
    }
  }
  const mismatchPct = cityArea ? ((highRainDry + lowRainWet) / cityArea) * 100 : 0
  const interp =
    corr > 0.55
      ? '降雨与积水在空间上总体同步，地形再分配作用相对有限。'
      : corr > 0.2
        ? '降雨与积水仅中度相关，低洼地形与排水条件对积水位置有明显再分配。'
        : '降雨与积水空间相关性弱，积水位置主要受低洼地形、汇流与排水条件控制。'
  return {
    id: 'rain-depth',
    title: '降雨分布 × 积水范围差异',
    method: '逐网格计算降雨强度与积水深度的 Pearson 相关系数，并统计“高雨强未积水 / 低雨强积水”两类错配网格。',
    summary: `相关系数 r = ${corr.toFixed(2)}。${interp} 错配网格约占 ${mismatchPct.toFixed(1)}%。`,
    metrics: [
      { label: '空间相关系数 r', value: corr.toFixed(2) },
      { label: '高雨强未积水', value: formatArea(highRainDry), tone: 'warn' },
      { label: '低雨强仍积水', value: formatArea(lowRainWet), tone: 'danger' },
      {
        label: '错配面积占全城',
        value: `${mismatchPct.toFixed(1)}%`,
      },
    ],
    details: [
      {
        label: '最大错配点水深',
        value: `${formatDepth(maxMismatchDepth)}（低雨强区积水）`,
        point: mismatchPoint ?? [city.bounds[0] + 0.05, city.bounds[1] + 0.04],
      },
      {
        label: '全城平均降雨',
        value: `${meanR.toFixed(1)} mm/h`,
        point: [city.bounds[0] + 0.05, city.bounds[1] + 0.04],
      },
      {
        label: '全城平均积水',
        value: formatDepth(meanD),
        point: [city.bounds[0] + 0.05, city.bounds[1] + 0.04],
      },
    ],
    locate: mismatchPoint,
  }
}

export interface ScenarioSnapshot {
  savedAt: number
  model: ModelResult
  depth: Float64Array
  risk: Uint8Array
}

export function takeSnapshot(model: ModelResult): ScenarioSnapshot {
  return {
    savedAt: Date.now(),
    model,
    depth: Float64Array.from(model.depth.values),
    risk: Uint8Array.from(model.risk),
  }
}

export interface CompareRow {
  label: string
  unit: string
  before: number
  after: number
  delta: number
  deltaPct: number
  lowerIsBetter: boolean
  format: (v: number) => string
}

export interface CompareResult {
  rows: CompareRow[]
  newRoads: RoadImpact[]
  newBuildings: ModelResult['metrics']['affectedBuildings']
  removedRoads: RoadImpact[]
}

export function compareScenarios(
  baseline: ModelResult,
  current: ModelResult,
): CompareResult {
  const mk = (
    label: string,
    unit: string,
    before: number,
    after: number,
    lowerIsBetter: boolean,
    format: (v: number) => string,
  ): CompareRow => {
    const delta = after - before
    return {
      label,
      unit,
      before,
      after,
      delta,
      deltaPct: before > 0 ? (delta / before) * 100 : after > 0 ? 100 : 0,
      lowerIsBetter,
      format,
    }
  }
  const rows: CompareRow[] = [
    mk(
      '积水面积',
      'ha',
      baseline.metrics.floodedAreaM2 / 10000,
      current.metrics.floodedAreaM2 / 10000,
      true,
      (v) => `${v.toFixed(1)} ha`,
    ),
    mk(
      '高风险及以上面积',
      'ha',
      baseline.metrics.highRiskAreaM2 / 10000,
      current.metrics.highRiskAreaM2 / 10000,
      true,
      (v) => `${v.toFixed(1)} ha`,
    ),
    mk(
      '受影响道路',
      '条',
      baseline.metrics.affectedRoads.length,
      current.metrics.affectedRoads.length,
      true,
      (v) => `${Math.round(v)} 条`,
    ),
    mk(
      '受影响建筑',
      '栋',
      baseline.metrics.affectedBuildings.length,
      current.metrics.affectedBuildings.length,
      true,
      (v) => `${Math.round(v)} 栋`,
    ),
    mk(
      '最大积水深度',
      'm',
      baseline.metrics.maxDepth,
      current.metrics.maxDepth,
      true,
      (v) => `${v.toFixed(2)} m`,
    ),
  ]
  const baseRoadIds = new Set(baseline.metrics.affectedRoads.map((r) => r.id))
  const baseBuildingIds = new Set(baseline.metrics.affectedBuildings.map((b) => b.id))
  return {
    rows,
    newRoads: current.metrics.affectedRoads.filter((r) => !baseRoadIds.has(r.id)),
    newBuildings: current.metrics.affectedBuildings.filter((b) => !baseBuildingIds.has(b.id)),
    removedRoads: baseline.metrics.affectedRoads.filter(
      (r) => !current.metrics.affectedRoads.some((c) => c.id === r.id),
    ),
  }
}
