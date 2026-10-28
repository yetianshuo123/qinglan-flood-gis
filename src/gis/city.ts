import {
  area as turfArea,
  booleanIntersects,
  buffer,
  centroid,
  featureCollection,
  lineString,
  point,
  polygon,
} from '@turf/turf'
import type { Feature, LineString, Polygon } from 'geojson'
import type {
  BuildingProps,
  CityData,
  DistrictProps,
  HydroProps,
  LonLat,
  LowlandProps,
  PumpProps,
  RoadProps,
} from './types'
import { buildTerrain, type Depression } from './terrain'
import {
  distanceMeters,
  polylineLengthMeters,
  sampleGrid,
  cellCenter,
  lonLatToCell,
} from './grid'
import { mulberry32, randomNormal, valueNoise } from './rng'

const BOUNDS: [number, number, number, number] = [120.0, 30.0, 120.1, 30.08]
const COLS = 100
const ROWS = 90

const RIVER: LonLat[] = [
  [120.002, 30.053],
  [120.012, 30.05],
  [120.022, 30.046],
  [120.031, 30.043],
  [120.04, 30.038],
  [120.048, 30.034],
  [120.055, 30.03],
  [120.062, 30.026],
  [120.07, 30.023],
  [120.078, 30.019],
  [120.086, 30.016],
  [120.095, 30.01],
  [120.099, 30.006],
]

const CANALS: { id: string; name: string; widthM: number; coords: LonLat[]; capacity: number }[] = [
  {
    id: 'C01',
    name: '北岭排水渠',
    widthM: 18,
    capacity: 22,
    coords: [
      [120.018, 30.07],
      [120.022, 30.06],
      [120.028, 30.05],
      [120.034, 30.042],
    ],
  },
  {
    id: 'C02',
    name: '云栖排水渠',
    widthM: 16,
    capacity: 18,
    coords: [
      [120.057, 30.068],
      [120.06, 30.057],
      [120.058, 30.044],
      [120.057, 30.032],
    ],
  },
  {
    id: 'C03',
    name: '南塘排涝干渠',
    widthM: 22,
    capacity: 30,
    coords: [
      [120.038, 30.011],
      [120.047, 30.017],
      [120.054, 30.026],
    ],
  },
  {
    id: 'C04',
    name: '东港排水渠',
    widthM: 20,
    capacity: 26,
    coords: [
      [120.082, 30.062],
      [120.08, 30.05],
      [120.077, 30.035],
      [120.074, 30.024],
    ],
  },
  {
    id: 'C05',
    name: '西溪支渠',
    widthM: 12,
    capacity: 10,
    coords: [
      [120.005, 30.027],
      [120.014, 30.031],
      [120.024, 30.038],
      [120.034, 30.042],
    ],
  },
]

const PUMPS: { id: string; name: string; lon: number; lat: number; capacity: number; district: string }[] = [
  { id: 'P01', name: '南塘泵站', lon: 120.0555, lat: 30.0285, capacity: 4.6, district: '南塘区' },
  { id: 'P02', name: '东港泵站', lon: 120.088, lat: 30.0135, capacity: 5.2, district: '东港区' },
  { id: 'P03', name: '青岚泵站', lon: 120.079, lat: 30.058, capacity: 2.8, district: '青岚区' },
  { id: 'P04', name: '西溪泵站', lon: 120.016, lat: 30.047, capacity: 2.1, district: '北岭区' },
]

const LOWLANDS: {
  id: string
  name: string
  lon: number
  lat: number
  rx: number
  ry: number
  rot: number
  amp: number
  district: string
}[] = [
  { id: 'L01', name: '南塘低洼区', lon: 120.049, lat: 30.024, rx: 0.011, ry: 0.0068, rot: -18, amp: 3.4, district: '南塘区' },
  { id: 'L02', name: '云栖北洼地', lon: 120.03, lat: 30.06, rx: 0.0085, ry: 0.0055, rot: 12, amp: 2.5, district: '云栖区' },
  { id: 'L03', name: '东港滩地', lon: 120.0835, lat: 30.0445, rx: 0.0078, ry: 0.0046, rot: 25, amp: 2.6, district: '东港区' },
  { id: 'L04', name: '临川洼地', lon: 120.064, lat: 30.0335, rx: 0.0068, ry: 0.0042, rot: -8, amp: 2.4, district: '临川区' },
  { id: 'L05', name: '青岚洼地', lon: 120.08, lat: 30.06, rx: 0.0056, ry: 0.0036, rot: 20, amp: 2.1, district: '青岚区' },
]

const DISTRICTS: { id: string; name: string; west: number; south: number; east: number; north: number }[] = [
  { id: 'D1', name: '北岭区', west: 120.0, south: 30.044, east: 120.034, north: 30.08 },
  { id: 'D2', name: '云栖区', west: 120.034, south: 30.044, east: 120.068, north: 30.08 },
  { id: 'D3', name: '青岚区', west: 120.068, south: 30.044, east: 120.1, north: 30.08 },
  { id: 'D4', name: '南塘区', west: 120.0, south: 30.0, east: 120.034, north: 30.044 },
  { id: 'D5', name: '临川区', west: 120.034, south: 30.0, east: 120.068, north: 30.044 },
  { id: 'D6', name: '东港区', west: 120.068, south: 30.0, east: 120.1, north: 30.044 },
]

const ROAD_DEFS: {
  id: string
  name: string
  roadClass: RoadProps['roadClass']
  lanes: number
  a: LonLat
  b: LonLat
  amp: number
  axis: 'ew' | 'ns'
  surface: string
}[] = [
  { id: 'R01', name: '北岭大道', roadClass: '主干道', lanes: 6, a: [120.003, 30.07], b: [120.097, 30.07], amp: 0.0007, axis: 'ew', surface: '沥青' },
  { id: 'R02', name: '云栖东路', roadClass: '次干道', lanes: 4, a: [120.003, 30.056], b: [120.097, 30.056], amp: 0.0008, axis: 'ew', surface: '沥青' },
  { id: 'R03', name: '中央大道', roadClass: '主干道', lanes: 8, a: [120.003, 30.04], b: [120.097, 30.04], amp: 0.0006, axis: 'ew', surface: '沥青' },
  { id: 'R04', name: '临川路', roadClass: '次干道', lanes: 4, a: [120.003, 30.024], b: [120.097, 30.024], amp: 0.0009, axis: 'ew', surface: '混凝土' },
  { id: 'R05', name: '南塘路', roadClass: '支路', lanes: 2, a: [120.003, 30.008], b: [120.097, 30.008], amp: 0.0012, axis: 'ew', surface: '沥青' },
  { id: 'R06', name: '西溪路', roadClass: '次干道', lanes: 4, a: [120.01, 30.003], b: [120.01, 30.077], amp: 0.0008, axis: 'ns', surface: '沥青' },
  { id: 'R07', name: '学府路', roadClass: '支路', lanes: 2, a: [120.028, 30.003], b: [120.028, 30.077], amp: 0.001, axis: 'ns', surface: '混凝土' },
  { id: 'R08', name: '云栖中路', roadClass: '主干道', lanes: 6, a: [120.047, 30.003], b: [120.047, 30.077], amp: 0.0007, axis: 'ns', surface: '沥青' },
  { id: 'R09', name: '青岚路', roadClass: '次干道', lanes: 4, a: [120.066, 30.003], b: [120.066, 30.077], amp: 0.0009, axis: 'ns', surface: '沥青' },
  { id: 'R10', name: '东港大道', roadClass: '主干道', lanes: 8, a: [120.085, 30.003], b: [120.085, 30.077], amp: 0.0006, axis: 'ns', surface: '沥青' },
  { id: 'R11', name: '环城东路', roadClass: '次干道', lanes: 4, a: [120.097, 30.003], b: [120.097, 30.077], amp: 0.0005, axis: 'ns', surface: '混凝土' },
  { id: 'R12', name: '滨江大道', roadClass: '主干道', lanes: 6, a: [120.006, 30.059], b: [120.095, 30.015], amp: 0.0009, axis: 'ew', surface: '沥青' },
  { id: 'R13', name: '望江街', roadClass: '支路', lanes: 2, a: [120.018, 30.019], b: [120.074, 30.06], amp: 0.0016, axis: 'ns', surface: '石板' },
  { id: 'R14', name: '学府支路', roadClass: '支路', lanes: 2, a: [120.028, 30.048], b: [120.044, 30.051], amp: 0.0005, axis: 'ew', surface: '混凝土' },
  { id: 'R15', name: '湖畔街', roadClass: '支路', lanes: 2, a: [120.058, 30.011], b: [120.08, 30.009], amp: 0.0007, axis: 'ew', surface: '石板' },
  { id: 'R16', name: '北岭西街', roadClass: '支路', lanes: 2, a: [120.005, 30.061], b: [120.022, 30.064], amp: 0.0006, axis: 'ew', surface: '混凝土' },
  { id: 'R17', name: '汇景路', roadClass: '支路', lanes: 2, a: [120.039, 30.067], b: [120.06, 30.069], amp: 0.0005, axis: 'ew', surface: '沥青' },
  { id: 'R18', name: '东港二路', roadClass: '支路', lanes: 2, a: [120.086, 30.03], b: [120.098, 30.033], amp: 0.0005, axis: 'ew', surface: '混凝土' },
  { id: 'R19', name: '南塘南街', roadClass: '支路', lanes: 2, a: [120.02, 30.004], b: [120.043, 30.007], amp: 0.0005, axis: 'ew', surface: '沥青' },
]

function blob(
  lon: number,
  lat: number,
  rx: number,
  ry: number,
  rotDeg: number,
  seed: number,
): LonLat[] {
  const rot = (rotDeg * Math.PI) / 180
  const rnd = mulberry32(seed)
  const n = 34
  const coords: LonLat[] = []
  for (let i = 0; i < n; i++) {
    const theta = (i / n) * Math.PI * 2
    const r =
      1 +
      0.12 * Math.sin(3 * theta + seed) +
      0.06 * Math.sin(7 * theta + seed * 0.7) +
      (rnd() - 0.5) * 0.05
    const ex = Math.cos(theta) * rx * r
    const ey = Math.sin(theta) * ry * r
    coords.push([
      lon + ex * Math.cos(rot) - ey * Math.sin(rot),
      lat + ex * Math.sin(rot) + ey * Math.cos(rot),
    ])
  }
  coords.push(coords[0])
  return coords
}

function jitterRect(
  west: number,
  south: number,
  east: number,
  north: number,
  seed: number,
): LonLat[] {
  const rnd = mulberry32(seed)
  const coords: LonLat[] = []
  const jitter = 0.0016
  const pushEdge = (x1: number, y1: number, x2: number, y2: number, segs: number) => {
    for (let i = 0; i < segs; i++) {
      const t = i / segs
      coords.push([
        x1 + (x2 - x1) * t + (i === 0 ? 0 : (rnd() - 0.5) * jitter),
        y1 + (y2 - y1) * t + (i === 0 ? 0 : (rnd() - 0.5) * jitter),
      ])
    }
  }
  pushEdge(west, south, east, south, 5)
  pushEdge(east, south, east, north, 5)
  pushEdge(east, north, west, north, 5)
  pushEdge(west, north, west, south, 5)
  coords.push(coords[0])
  return coords
}

function wiggleLine(
  a: LonLat,
  b: LonLat,
  amp: number,
  axis: 'ew' | 'ns',
  seed: number,
  steps = 22,
): LonLat[] {
  const coords: LonLat[] = []
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const offset =
      Math.sin(t * Math.PI * 3.2 + seed) * amp * 0.55 +
      (valueNoise(t * 12, seed * 3, seed) - 0.5) * amp
    const nx = -dy / len
    const ny = dx / len
    coords.push([a[0] + dx * t + nx * offset, a[1] + dy * t + ny * offset])
  }
  if (axis === 'ew') {
    // 保持路径整体水平趋势，避免端点漂移
    coords[0] = [a[0], a[1]]
    coords[coords.length - 1] = [b[0], b[1]]
  }
  return coords
}

function rectBuilding(
  lon: number,
  lat: number,
  wM: number,
  dM: number,
  rotDeg: number,
): LonLat[] {
  const rot = (rotDeg * Math.PI) / 180
  const mPerLat = 111132
  const mPerLon = 111320 * Math.cos((lat * Math.PI) / 180)
  const corners: LonLat[] = []
  const base: [number, number][] = [
    [-wM / 2, -dM / 2],
    [wM / 2, -dM / 2],
    [wM / 2, dM / 2],
    [-wM / 2, dM / 2],
    [-wM / 2, -dM / 2],
  ]
  for (const [x, y] of base) {
    const rx = x * Math.cos(rot) - y * Math.sin(rot)
    const ry = x * Math.sin(rot) + y * Math.cos(rot)
    corners.push([lon + rx / mPerLon, lat + ry / mPerLat])
  }
  return corners
}

const RESIDENTIAL_NAMES = [
  '云栖花园',
  '临川新村',
  '青岚雅苑',
  '南塘家园',
  '东港公寓',
  '望江里',
  '湖畔名庭',
  '北岭山庄',
  '汇景苑',
  '学府里',
  '水岸新城',
  '锦澜苑',
]
const COMMERCIAL_NAMES = [
  '云栖商务中心',
  '临川大厦',
  '青岚国际',
  '东港广场',
  '南塘商业街',
  '汇景中心',
  '望江写字楼',
  '中央商务楼',
]
const PUBLIC_NAMES = [
  '云栖社区中心',
  '临川文化馆',
  '青岚体育馆',
  '南塘街道办',
  '东港客运站',
  '北岭图书馆',
  '临川档案馆',
]
const SCHOOL_NAMES = [
  '临川第二小学',
  '云栖实验中学',
  '青岚小学',
  '南塘中学',
  '东港小学',
  '北岭职业技术学院',
]
const HOSPITAL_NAMES = ['南塘医院', '云栖社区卫生服务中心', '临川区人民医院']
const INDUSTRIAL_NAMES = ['东港物流园', '北岭产业园', '青岚科创园', '南塘水厂', '临川仓储中心']

function roadDistrict(lon: number, lat: number, centers: Record<string, LonLat>): string {
  let best = '云栖区'
  let bestD = Infinity
  for (const [name, c] of Object.entries(centers)) {
    const d = distanceMeters([lon, lat], c)
    if (d < bestD) {
      bestD = d
      best = name
    }
  }
  return best
}

export function generateCity(): CityData {
  const [west, south, east, north] = BOUNDS
  const depressions: Depression[] = LOWLANDS.map((l) => ({
    lon: l.lon,
    lat: l.lat,
    rx: l.rx * 1.25,
    ry: l.ry * 1.25,
    rot: l.rot,
    amp: l.amp,
  }))

  const { terrain, rainPattern } = buildTerrain({
    bounds: BOUNDS,
    cols: COLS,
    rows: ROWS,
    riverCoords: RIVER,
    canalCoords: CANALS.map((c) => c.coords),
    pumpCoords: PUMPS.map((p) => [p.lon, p.lat] as LonLat),
    depressions,
  })

  const districtCenters: Record<string, LonLat> = {}
  const districts = DISTRICTS.map((d, idx) => {
    const ring = jitterRect(d.west, d.south, d.east, d.north, 40 + idx)
    const center: LonLat = [(d.west + d.east) / 2, (d.south + d.north) / 2]
    districtCenters[d.name] = center
    const props: DistrictProps = {
      kind: 'district',
      id: d.id,
      name: d.name,
      code: `V${idx + 1}`,
      areaM2: Math.round(turfArea(polygon([ring]))),
    }
    return { type: 'Feature' as const, properties: props, geometry: { type: 'Polygon' as const, coordinates: [ring] } }
  })

  const riverLine = lineString(RIVER)
  const riverAreaFeature = buffer(riverLine, 0.065, { units: 'kilometers' })
  if (!riverAreaFeature) throw new Error('river buffer failed')
  const riverAreaGeometry = riverAreaFeature.geometry as unknown as Polygon
  const riverRing = riverAreaGeometry.coordinates[0]
  const hydroAreas: Feature<Polygon, HydroProps>[] = [
    {
      type: 'Feature',
      properties: {
        kind: 'river',
        id: 'W01',
        name: '青澜河',
        widthM: 110,
        lengthM: Math.round(polylineLengthMeters(RIVER)),
        capacityM3s: 210,
      },
      geometry: riverAreaGeometry,
    },
  ]

  const hydro: Feature<LineString, HydroProps>[] = [
    lineString(RIVER, {
      kind: 'river' as const,
      id: 'W01',
      name: '青澜河',
      widthM: 110,
      lengthM: Math.round(polylineLengthMeters(RIVER)),
      capacityM3s: 210,
    } satisfies HydroProps),
    ...CANALS.map((c) =>
      lineString(c.coords, {
        kind: 'canal' as const,
        id: c.id,
        name: c.name,
        widthM: c.widthM,
        lengthM: Math.round(polylineLengthMeters(c.coords)),
        capacityM3s: c.capacity,
      } satisfies HydroProps) as Feature<LineString, HydroProps>,
    ),
  ]

  const pumps = PUMPS.map((p) =>
    point([p.lon, p.lat], {
      kind: 'pump' as const,
      id: p.id,
      name: p.name,
      capacityM3s: p.capacity,
      district: p.district,
    } satisfies PumpProps),
  )

  const lowlands = LOWLANDS.map((l) => {
    const ring = blob(l.lon, l.lat, l.rx, l.ry, l.rot, l.lon * 1000 + l.lat * 100)
    const poly = polygon([ring])
    let sum = 0
    let count = 0
    let min = Infinity
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const c = cellCenter(terrain.dem, row, col)
        if (
          c[0] >= l.lon - l.rx * 2 &&
          c[0] <= l.lon + l.rx * 2 &&
          c[1] >= l.lat - l.ry * 2 &&
          c[1] <= l.lat + l.ry * 2
        ) {
          const inside = pointInRing(c, ring)
          if (!inside) continue
          const elev = terrain.dem.values[row * COLS + col]
          sum += elev
          count += 1
          if (elev < min) min = elev
        }
      }
    }
    const a = turfArea(poly)
    const props: LowlandProps = {
      kind: 'lowland',
      id: l.id,
      name: l.name,
      areaM2: Math.round(a),
      meanElev: count ? Math.round((sum / count) * 10) / 10 : 0,
      minElev: Number.isFinite(min) ? Math.round(min * 10) / 10 : 0,
      storageM3: Math.round((a * 0.16) / 100) * 100,
      district: l.district,
    }
    return { type: 'Feature' as const, properties: props, geometry: { type: 'Polygon' as const, coordinates: [ring] } }
  })

  const roads = ROAD_DEFS.map((r) => {
    const coords = wiggleLine(r.a, r.b, r.amp, r.axis, Number(r.id.slice(1)) * 1.7)
    const line = lineString(coords)
    const bridge = booleanIntersects(line, polygon([riverRing]))
    const mid = coords[Math.floor(coords.length / 2)]
    const props: RoadProps = {
      kind: 'road',
      id: r.id,
      name: r.name,
      roadClass: r.roadClass,
      lanes: r.lanes,
      lengthM: Math.round(polylineLengthMeters(coords)),
      district: roadDistrict(mid[0], mid[1], districtCenters),
      surface: r.surface,
      bridge,
    }
    return { type: 'Feature' as const, properties: props, geometry: { type: 'LineString' as const, coordinates: coords } }
  })

  const rnd = mulberry32(20261028)
  const buildings: CityData['buildings']['features'] = []
  const occupied = new Set<string>()
  const nameCounter: Record<string, number> = {}
  const types: BuildingProps['buildingType'][] = ['住宅', '商业', '公共', '学校', '医院', '工业']
  const typeWeights = [0.6, 0.145, 0.09, 0.05, 0.035, 0.08]
  const districtList = Object.entries(districtCenters)

  let attempts = 0
  while (buildings.length < 215 && attempts < 12000) {
    attempts++
    const [, center] = districtList[Math.floor(rnd() * districtList.length)]
    const lon = center[0] + randomNormal(rnd) * 0.014
    const lat = center[1] + randomNormal(rnd) * 0.011
    if (lon < west + 0.002 || lon > east - 0.002 || lat < south + 0.002 || lat > north - 0.002) continue
    const riverDist = Math.min(
      ...RIVER.map((p) => distanceMeters([lon, lat], p)),
    )
    if (riverDist < 170) continue
    const cellKey = `${Math.floor(lon / 0.0013)}_${Math.floor(lat / 0.0012)}`
    if (occupied.has(cellKey)) continue

    const roll = rnd()
    let acc = 0
    let type: BuildingProps['buildingType'] = '住宅'
    for (let i = 0; i < types.length; i++) {
      acc += typeWeights[i]
      if (roll <= acc) {
        type = types[i]
        break
      }
    }

    let wM = 45 + rnd() * 40
    let dM = 30 + rnd() * 25
    let floors = 6 + Math.floor(rnd() * 20)
    if (type === '商业') {
      wM = 60 + rnd() * 60
      dM = 45 + rnd() * 45
      floors = 8 + Math.floor(rnd() * 24)
    } else if (type === '公共') {
      wM = 70 + rnd() * 40
      dM = 50 + rnd() * 30
      floors = 4 + Math.floor(rnd() * 6)
    } else if (type === '学校') {
      wM = 120 + rnd() * 60
      dM = 90 + rnd() * 50
      floors = 3 + Math.floor(rnd() * 3)
    } else if (type === '医院') {
      wM = 100 + rnd() * 50
      dM = 80 + rnd() * 30
      floors = 8 + Math.floor(rnd() * 8)
    } else if (type === '工业') {
      wM = 90 + rnd() * 60
      dM = 60 + rnd() * 40
      floors = 2 + Math.floor(rnd() * 3)
    }

    const ring = rectBuilding(lon, lat, wM, dM, rnd() * 180)
    const poly = polygon([ring])
    const c = centroid(poly)
    const a = turfArea(poly)
    const cLon = c.geometry.coordinates[0]
    const cLat = c.geometry.coordinates[1]
    if (a > 12000) {
      const bigKey = `big_${Math.floor(lon / 0.003)}_${Math.floor(lat / 0.003)}`
      if (occupied.has(bigKey)) continue
      occupied.add(bigKey)
    }
    occupied.add(cellKey)

    let name = ''
    if (type === '住宅') {
      const estateIdx = nameCounter.estateIdx ?? 0
      nameCounter.estateIdx = estateIdx + 1
      const estate = RESIDENTIAL_NAMES[estateIdx % RESIDENTIAL_NAMES.length]
      const bKey = `est_${estateIdx % RESIDENTIAL_NAMES.length}`
      const bIdx = (nameCounter[bKey] ?? 0) + 1
      nameCounter[bKey] = bIdx
      name = `${estate} ${bIdx} 号楼`
    } else {
      const pools: Record<string, string[]> = {
        商业: COMMERCIAL_NAMES,
        公共: PUBLIC_NAMES,
        学校: SCHOOL_NAMES,
        医院: HOSPITAL_NAMES,
        工业: INDUSTRIAL_NAMES,
      }
      const pool = pools[type] ?? PUBLIC_NAMES
      const key = `t_${type}`
      const idx = nameCounter[key] ?? 0
      nameCounter[key] = idx + 1
      name = pool[idx % pool.length]
      if (idx >= pool.length) name += ` ${Math.floor(idx / pool.length) + 1} 期`
    }

    const cell = lonLatToCell(terrain.dem, cLon, cLat)
    const elevation = sampleGrid(terrain.dem, cLon, cLat)
    const props: BuildingProps = {
      kind: 'building',
      id: `B${String(buildings.length + 1).padStart(3, '0')}`,
      name,
      buildingType: type,
      district: roadDistrict(cLon, cLat, districtCenters),
      floors,
      heightM: Math.round(floors * 3.1),
      footprintM2: Math.round(a),
      elevation: Math.round(elevation * 10) / 10,
    }
    if (!cell.inside) continue
    buildings.push({
      type: 'Feature',
      properties: props,
      geometry: { type: 'Polygon', coordinates: [ring] },
    })
  }

  return {
    bounds: BOUNDS,
    districts: featureCollection(districts),
    roads: featureCollection(roads),
    buildings: { ...featureCollection(buildings) },
    hydro: featureCollection(hydro),
    hydroAreas: featureCollection(hydroAreas),
    pumps: featureCollection(pumps),
    lowlands: featureCollection(lowlands),
    river: riverLine,
    terrain,
    rainPattern,
    districtCenters,
  }
}

/** 射线法：点是否在环内 */
export function pointInRing(point: LonLat, ring: LonLat[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi + 1e-15) + xi
    if (intersect) inside = !inside
  }
  return inside
}


