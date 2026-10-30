import { useEffect, useRef, useState } from 'react'
import Feature from 'ol/Feature'
import Map from 'ol/Map'
import View from 'ol/View'
import { defaults as defaultControls, ScaleLine, Zoom } from 'ol/control'
import GeoJSON from 'ol/format/GeoJSON'
import type { Geometry } from 'geojson'
import type BaseLayer from 'ol/layer/Base'
import ImageLayer from 'ol/layer/Image'
import TileLayer from 'ol/layer/Tile'
import VectorLayer from 'ol/layer/Vector'
import { defaults as defaultInteractions, Draw } from 'ol/interaction'
import type { DrawEvent } from 'ol/interaction/Draw'
import LineString from 'ol/geom/LineString'
import Point from 'ol/geom/Point'
import Polygon from 'ol/geom/Polygon'
import type OlGeometry from 'ol/geom/Geometry'
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj'
import type { Extent } from 'ol/extent'
import ImageStatic from 'ol/source/ImageStatic'
import VectorSource from 'ol/source/Vector'
import XYZ from 'ol/source/XYZ'
import { getArea, getLength } from 'ol/sphere'
import type { CityData, LonLat, ModelResult } from '../gis/types'
import type { DiffMode } from '../gis/rasters'
import {
  createDepthDataUrl,
  createDiffDataUrl,
  createRainDataUrl,
  createRiskDataUrl,
  contourSegments,
  rasterLevelFor,
} from '../gis/rasters'
import { WaterOverlay } from '../gis/waterOverlay'
import {
  buildingStyle,
  BUILDING_COLORS,
  districtStyle,
  FONT,
  focusStyle,
  LABEL_HALO,
  lowlandStyle,
  measureLineStyle,
  measurePolygonStyle,
  PARK_COLORS,
  parkStyle,
  queryPolygonStyle,
  roadStyle,
  selectionStyle,
  setBuildingMinHeight,
  waterStyle,
} from '../gis/vectorStyles'
import { lonLatToCell, sampleGrid } from '../gis/grid'
import type {
  CursorInfo,
  LayerStates,
  SelectionInfo,
  Tool,
} from '../uiTypes'

export interface MapViewProps {
  city: CityData
  model: ModelResult
  layerStates: LayerStates
  tool: Tool
  selection: SelectionInfo | null
  queryRing: LonLat[] | null
  focusPoint: { point: LonLat; key: number } | null
  resetKey: number
  clearKey: number
  diffVisible: boolean
  diffMode: DiffMode
  baselineModel: ModelResult | null
  /** 三维体块与平面建筑的最小展示高度（m），0 表示全部展示 */
  buildingMinHeight: number
  /** 是否播放水位上涨淹没演示 */
  floodDemo: boolean
  onCursor: (info: CursorInfo | null) => void
  onSelect: (sel: SelectionInfo | null) => void
  onPointQuery: (p: LonLat) => void
  onRingDrawn: (ring: LonLat[]) => void
  onViewChange: (v: { zoom: number; scaleText: string }) => void
}

const FIT_PADDING: [number, number, number, number] = [12, 12, 12, 12]
const VECTOR_IDS = ['districts', 'parks', 'lowland', 'water', 'roads', 'buildings']

function featureSubtitle(props: Record<string, unknown>): string {
  const kind = String(props.kind ?? '')
  if (kind === 'building') return `${props.buildingType} · ${props.district}`
  if (kind === 'road') return `${props.roadClass} · ${Math.round(Number(props.lengthM))} m`
  if (kind === 'river') return `天然河道 · ${props.capacityM3s} m³/s`
  if (kind === 'canal') return `排水渠 · ${props.capacityM3s} m³/s`
  if (kind === 'pump') return `泵站 · ${props.capacityM3s} m³/s`
  if (kind === 'lowland') return `低洼区 · ${props.district}`
  if (kind === 'park') return `${props.parkType} · ${props.district}`
  if (kind === 'district') return '行政分区'
  return ''
}

function fmtLength(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`
}

function fmtArea(m2: number): string {
  if (m2 >= 1_000_000) return `${(m2 / 1_000_000).toFixed(2)} km²`
  if (m2 >= 10_000) return `${(m2 / 10_000).toFixed(2)} ha`
  return `${m2.toFixed(0)} m²`
}

export default function MapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const tipTitleRef = useRef<HTMLSpanElement>(null)
  const tipSubRef = useRef<HTMLSpanElement>(null)
  const b3dRef = useRef<HTMLCanvasElement>(null)
  const flowRef = useRef<HTMLCanvasElement>(null)
  const floodRef = useRef<HTMLCanvasElement>(null)
  const waterOverlayRef = useRef<WaterOverlay | null>(null)
  const labelRef = useRef<HTMLCanvasElement>(null)
  const mapRef = useRef<Map | null>(null)
  const layersRef = useRef<Record<string, BaseLayer>>({})
  const mapExtentRef = useRef<Extent | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  const [measure, setMeasure] = useState<string | null>(null)
  const [rasterLevel, setRasterLevel] = useState(() => rasterLevelFor(13.6))

  const setImageSource = (id: string, url: string, interpolate: boolean) => {
    const layer = layersRef.current[id]
    const extent = mapExtentRef.current
    if (!layer || !extent) return
    ;(layer as ImageLayer<ImageStatic>).setSource(
      new ImageStatic({
        url,
        imageExtent: extent,
        projection: 'EPSG:3857',
        interpolate,
      }),
    )
  }

  // 按「源数据对象 + 级别」缓存已生成的栅格，避免来回缩放时重复计算
  const rasterCacheRef = useRef(
    new globalThis.Map<string, { src: object; url: string }>(),
  )
  const getRaster = (key: string, src: object) => {
    const hit = rasterCacheRef.current.get(key)
    return hit && hit.src === src ? hit.url : null
  }
  const putRaster = (key: string, src: object, url: string) => {
    const cache = rasterCacheRef.current
    cache.set(key, { src, url })
    while (cache.size > 12) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }

  const clearMeasure = () => {
    const layer = layersRef.current.measure as VectorLayer<VectorSource> | undefined
    layer?.getSource()?.clear()
    setMeasure(null)
  }

  /* ---------------- 初始化地图与图层 ---------------- */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const city = props.city
    const mapExtent = transformExtent(city.bounds, 'EPSG:4326', 'EPSG:3857') as Extent
    mapExtentRef.current = mapExtent
    const geoJson = new GeoJSON()
    const read = (fc: unknown) =>
      geoJson.readFeatures(fc as never, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857',
      })
    const sourceOf = (fc: unknown) => new VectorSource({ features: read(fc) })

    const view = new View({
      center: fromLonLat([(city.bounds[0] + city.bounds[2]) / 2, (city.bounds[1] + city.bounds[3]) / 2]),
      zoom: 13.6,
      minZoom: 11.5,
      maxZoom: 19,
      extent: transformExtent(
        [city.bounds[0] - 0.03, city.bounds[1] - 0.03, city.bounds[2] + 0.03, city.bounds[3] + 0.03],
        'EPSG:4326',
        'EPSG:3857',
      ) as Extent,
    })

    // 真实卫星影像底图（ArcGIS World Imagery，全球覆盖、免鉴权）
    const terrainLayer = new TileLayer({
      source: new XYZ({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attributions: 'Esri, Maxar, Earthstar Geographics',
        maxZoom: 19,
        crossOrigin: 'anonymous',
      }),
      zIndex: 1,
    })
    const rainfallLayer = new ImageLayer({ zIndex: 10 })
    const depthLayer = new ImageLayer({ zIndex: 20 })
    const riskLayer = new ImageLayer({ zIndex: 25 })
    const diffLayer = new ImageLayer({ zIndex: 28, opacity: 0.92 })
    diffLayer.setVisible(false)

    const districtsLayer = new VectorLayer({
      source: sourceOf(city.districts),
      style: districtStyle,
      zIndex: 30,
      properties: { layerId: 'districts' },
    })
    const parksLayer = new VectorLayer({
      source: sourceOf(city.parks),
      style: parkStyle,
      zIndex: 35,
      properties: { layerId: 'parks' },
    })
    const lowlandLayer = new VectorLayer({
      source: sourceOf(city.lowlands),
      style: lowlandStyle,
      zIndex: 40,
      properties: { layerId: 'lowland' },
    })
    const waterLayer = new VectorLayer({
      source: new VectorSource({
        features: [
          ...read(city.hydroAreas),
          ...read(city.hydro),
          ...read(city.pumps),
        ],
      }),
      style: waterStyle,
      zIndex: 50,
      properties: { layerId: 'water' },
    })
    const buildingsLayer = new VectorLayer({
      source: sourceOf(city.buildings),
      style: buildingStyle,
      zIndex: 60,
      properties: { layerId: 'buildings' },
    })
    const roadsLayer = new VectorLayer({
      source: sourceOf(city.roads),
      style: roadStyle,
      zIndex: 70,
      properties: { layerId: 'roads' },
    })

    const queryLayer = new VectorLayer({
      source: new VectorSource(),
      style: queryPolygonStyle,
      zIndex: 85,
    })
    const measureLayer = new VectorLayer({
      source: new VectorSource(),
      zIndex: 86,
    })
    const selectionLayer = new VectorLayer({
      source: new VectorSource(),
      style: selectionStyle,
      zIndex: 90,
    })
    const focusLayer = new VectorLayer({
      source: new VectorSource(),
      style: focusStyle,
      zIndex: 95,
    })

    layersRef.current = {
      terrain: terrainLayer,
      rainfall: rainfallLayer,
      depth: depthLayer,
      risk: riskLayer,
      diff: diffLayer,
      districts: districtsLayer,
      parks: parksLayer,
      lowland: lowlandLayer,
      water: waterLayer,
      buildings: buildingsLayer,
      roads: roadsLayer,
      query: queryLayer,
      measure: measureLayer,
      selection: selectionLayer,
      focus: focusLayer,
    }

    const map = new Map({
      target: container,
      layers: [
        terrainLayer,
        rainfallLayer,
        depthLayer,
        riskLayer,
        diffLayer,
        districtsLayer,
        parksLayer,
        lowlandLayer,
        waterLayer,
        buildingsLayer,
        roadsLayer,
        queryLayer,
        measureLayer,
        selectionLayer,
        focusLayer,
      ],
      view,
      controls: defaultControls({ zoom: false, rotate: false, attribution: false }),
      interactions: defaultInteractions({ altShiftDragRotate: false, pinchRotate: false }),
    })
    map.addControl(
      new ScaleLine({
        units: 'metric',
        bar: false,
        minWidth: 90,
        className: 'gis-scale',
      }),
    )
    map.addControl(new Zoom({ className: 'gis-zoom' }))
    mapRef.current = map

    // 三维水面覆盖层：用 Three.js ShaderMaterial 实时渲染河道与淹没水面
    // 若浏览器环境不支持 WebGL（如部分沙箱/无 GPU），则降级跳过，不影响底图与交互
    const host = container.parentElement
    let water: WaterOverlay | null = null
    try {
      water = new WaterOverlay(host ?? container, city.terrain.dem)
      waterOverlayRef.current = water
      map.on('postrender', () => {
        water?.syncView(map)
      })
      window.addEventListener('resize', () => water?.resize())
      water.start()
    } catch {
      waterOverlayRef.current = null
    }

    view.fit(mapExtent, { padding: FIT_PADDING })

    const updateViewState = () => {
      const v = map.getView()
      const res = v.getResolution() ?? 1
      const zoom = v.getZoom() ?? 12
      const denom = Math.round(res * 3779.53)
      propsRef.current.onViewChange({
        zoom: Math.round(zoom * 10) / 10,
        scaleText: `1:${denom.toLocaleString('en-US')}`,
      })
    }
    updateViewState()
    map.on('moveend', updateViewState)

    // 放大时切换到更高级别的栅格重采样
    const syncRasterLevel = () => {
      const next = rasterLevelFor(map.getView().getZoom() ?? 0)
      setRasterLevel((prev) => (prev.key === next.key ? prev : next))
    }
    map.on('moveend', syncRasterLevel)
    syncRasterLevel()

    let lastCursor = 0
    map.on('pointermove', (evt) => {
      if (evt.dragging) return
      const [lon, lat] = toLonLat(evt.coordinate) as LonLat
      const now = performance.now()
      if (now - lastCursor > 80) {
        lastCursor = now
        const { bounds } = city
        if (lon >= bounds[0] && lon <= bounds[2] && lat >= bounds[1] && lat <= bounds[3]) {
          const cell = lonLatToCell(propsRef.current.model.depth, lon, lat)
          const m = propsRef.current.model
          propsRef.current.onCursor({
            lon,
            lat,
            elevation: sampleGrid(city.terrain.dem, lon, lat),
            depth: sampleGrid(m.depth, lon, lat),
            rain: sampleGrid(m.rain, lon, lat),
            risk: m.risk[cell.row * m.depth.cols + cell.col],
          })
        } else {
          propsRef.current.onCursor(null)
        }
      }

      let hoverText = ''
      let hoverSub = ''
      let hoverId = ''
      map.forEachFeatureAtPixel(
        evt.pixel,
        (feature, layer) => {
          const lid = layer?.get('layerId')
          if (!lid || lid === 'districts') return false
          const p = feature.getProperties()
          hoverText = String(p.name ?? '')
          hoverSub = featureSubtitle(p)
          hoverId = `${lid}:${String(p.id ?? '')}`
          return true
        },
        { hitTolerance: 3 },
      )

      const tip = tooltipRef.current
      const targetEl = map.getTargetElement()
      if (tip && tipTitleRef.current && tipSubRef.current) {
        if (hoverText) {
          tip.style.display = 'block'
          tip.style.left = `${evt.pixel[0] + 16}px`
          tip.style.top = `${evt.pixel[1] + 14}px`
          tipTitleRef.current.textContent = hoverText
          tipSubRef.current.textContent = hoverSub
          if (targetEl) targetEl.style.cursor = 'pointer'
        } else {
          tip.style.display = 'none'
          if (targetEl) {
            targetEl.style.cursor =
              propsRef.current.tool === 'select' ? '' : 'crosshair'
          }
        }
      }
      void hoverId
    })

    map.on('click', () => {
      if (tooltipRef.current) tooltipRef.current.style.display = 'none'
    })

    map.on('singleclick', (evt) => {
      const p = propsRef.current
      if (p.tool === 'query-point') {
        const [lon, lat] = toLonLat(evt.coordinate) as LonLat
        p.onPointQuery([lon, lat])
        return
      }
      if (p.tool !== 'select') return

      interface Hit {
        feature: Feature
        layerId: string
        priority: number
      }
      const hits: Hit[] = []
      map.forEachFeatureAtPixel(
        evt.pixel,
        (feature, layer) => {
          const lid = layer?.get('layerId')
          if (!lid || !VECTOR_IDS.includes(lid)) return
          const props = feature.getProperties()
          const geomType = feature.getGeometry()?.getType()
          let priority = 1
          if (lid === 'buildings') priority = 5
          else if (lid === 'lowland') priority = 4
          else if (lid === 'water') priority = props.kind === 'pump' ? 4 : 3
          else if (lid === 'roads') priority = 3
          if (geomType === 'Polygon' && (props.kind === 'river' || props.kind === 'canal')) {
            priority = 2
          }
          hits.push({ feature: feature as Feature, layerId: lid, priority })
        },
        { hitTolerance: 4 },
      )

      if (!hits.length) {
        p.onSelect(null)
        return
      }
      const best = hits.reduce((a, b) => (b.priority > a.priority ? b : a))
      const properties = best.feature.getProperties() as Record<string, unknown>
      delete properties.geometry
      const kind = String(properties.kind ?? 'feature')
      const geometry = best.feature.getGeometry()
      if (!geometry) return

      let dataGeometry: Geometry
      if (geometry.getType() === 'Polygon' && (kind === 'river' || kind === 'canal')) {
        const line = city.hydro.features.find((f) => f.properties.id === properties.id)
        if (line) {
          dataGeometry = line.geometry as Geometry
        } else {
          dataGeometry = geoJson.writeGeometryObject(geometry, {
            featureProjection: 'EPSG:3857',
            dataProjection: 'EPSG:4326',
          }) as Geometry
        }
      } else {
        dataGeometry = geoJson.writeGeometryObject(geometry, {
          featureProjection: 'EPSG:3857',
          dataProjection: 'EPSG:4326',
        }) as Geometry
      }

      p.onSelect({
        kind,
        id: String(properties.id ?? ''),
        props: properties,
        geometry: dataGeometry,
      })
    })

    const resizeObserver = new ResizeObserver(() => map.updateSize())
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      map.un('moveend', updateViewState)
      map.un('moveend', syncRasterLevel)
      water?.dispose()
      waterOverlayRef.current = null
      map.setTarget(undefined)
      mapRef.current = null
      layersRef.current = {}
    }
  }, [])

  /* ---------------- 三维建筑体块（细节层次 + 平滑渐入） ---------------- */
  useEffect(() => {
    const map = mapRef.current
    const canvas = b3dRef.current
    if (!map || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // k > 0 向白色提亮，k < 0 向黑色压暗，用于浅色电子地图的体块明暗分层
    const shift = (hex: string, k: number) => {
      const v = hex.replace('#', '')
      const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v
      const n = parseInt(full, 16)
      const mix = (c: number) =>
        Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k))
      return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`
    }

    const render = () => {
      const size = map.getSize()
      if (!size) return
      const [w, h] = size
      const dpr = window.devicePixelRatio || 1
      const cw = Math.round(w * dpr)
      const ch = Math.round(h * dpr)
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw
        canvas.height = ch
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const layer = layersRef.current.buildings as
        | VectorLayer<VectorSource>
        | undefined
      if (!layer || !layer.getVisible()) return

      const view = map.getView()
      const zoom = view.getZoom() ?? 0
      const res = view.getResolution() ?? 1
      // 分级渲染：小比例尺直接使用矢量层的平面基底，避免逐栋投影；
      // 15.75 → 16.3 渐入三维体块，兼顾观感与移动端帧率
      const t = Math.min(1, Math.max(0, (zoom - 15.75) / 0.55))
      if (t <= 0) return

      interface Block {
        pts: number[][]
        color: string
        floors: number
        heightM: number
        name: string
        type: string
        depth: number
      }
      const blocks: Block[] = []
      for (const feature of layer.getSource()?.getFeatures() ?? []) {
        const geom = feature.getGeometry()
        if (!(geom instanceof Polygon)) continue
        // 先用外包框中心做屏幕裁剪，避免对全量建筑逐一投影
        const ex = geom.getExtent()
        const center = map.getPixelFromCoordinate([
          (ex[0] + ex[2]) / 2,
          (ex[1] + ex[3]) / 2,
        ])
        if (!center) continue
        if (center[0] < -140 || center[0] > w + 140 || center[1] < -140 || center[1] > h + 220) continue
        const ring = geom.getCoordinates()[0]
        const pts: number[][] = []
        let minX = Infinity
        let maxX = -Infinity
        let minY = Infinity
        let maxY = -Infinity
        for (const coord of ring) {
          const px = map.getPixelFromCoordinate(coord)
          if (!px) continue
          pts.push(px)
          if (px[0] < minX) minX = px[0]
          if (px[0] > maxX) maxX = px[0]
          if (px[1] < minY) minY = px[1]
          if (px[1] > maxY) maxY = px[1]
        }
        if (pts.length < 3) continue
        if (maxX < -80 || minX > w + 80 || maxY < -80 || maxY > h + 160) continue
        // 屏幕上过小的建筑不再绘制体块，远距离时可省去大量路径运算
        if ((maxX - minX) * (maxY - minY) < 26) continue
        const type = String(feature.get('buildingType') ?? '住宅')
        const heightM = Number(feature.get('heightM') ?? 12)
        // 高度筛选：低于阈值的建筑不绘制体块，透出绿地与地形底图，降低城市密度
        if (heightM < propsRef.current.buildingMinHeight) continue
        blocks.push({
          pts,
          color: BUILDING_COLORS[type] ?? '#d9dbd4',
          floors: Number(feature.get('floors') ?? 0),
          heightM,
          name: String(feature.get('name') ?? ''),
          type,
          depth: maxY,
        })
      }

      // 先绘制远景，再绘制近景，保证体块遮挡关系稳定
      blocks.sort((a, b) => a.depth - b.depth)
      ctx.globalAlpha = t * layer.getOpacity()
      ctx.lineJoin = 'round'
      // 建筑细节分级：16.6 起绘制屋面内轮廓，17 起叠加楼层线
      const detailLevel = zoom >= 17 ? 2 : zoom >= 16.6 ? 1 : 0

      for (const b of blocks) {
        const heightPx = Math.min(90, b.heightM / res)
        const dx = heightPx * 0.46
        const dy = -heightPx * 0.58
        const n = b.pts.length
        // 渐入阶段（t < 0.5）只画平面基底，体块成形后再叠加投影与立面
        const solid = t >= 0.5

        // 地面投影：向受光方向偏移的柔和阴影，模拟电子地图的立体感
        if (solid) {
          ctx.beginPath()
          b.pts.forEach((p, i) => {
            const x = p[0] + dx * 0.5
            const y = p[1] + dy * 0.5
            if (i) ctx.lineTo(x, y)
            else ctx.moveTo(x, y)
          })
          ctx.closePath()
          ctx.fillStyle = 'rgba(96, 110, 118, 0.13)'
          ctx.fill()
        }

        // 地面基底
        ctx.beginPath()
        b.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
        ctx.closePath()
        ctx.fillStyle = shift(b.color, -0.08)
        ctx.fill()

        // 立面：受光面更浅、背光面略深，保持浅灰层次
        if (solid) {
          for (let i = 0; i < n; i += 1) {
            const p1 = b.pts[i]
            const p2 = b.pts[(i + 1) % n]
            const nx = p2[1] - p1[1]
            const ny = -(p2[0] - p1[0])
            const facing = (nx * dx + ny * dy) / (Math.hypot(nx, ny) || 1)
            ctx.beginPath()
            ctx.moveTo(p1[0], p1[1])
            ctx.lineTo(p2[0], p2[1])
            ctx.lineTo(p2[0] + dx, p2[1] + dy)
            ctx.lineTo(p1[0] + dx, p1[1] + dy)
            ctx.closePath()
            ctx.fillStyle = shift(b.color, facing >= 0 ? 0.18 : -0.12)
            ctx.fill()
          }
        }

        // 屋顶：接近白色，仅在边缘保留淡描边
        ctx.beginPath()
        b.pts.forEach((p, i) => {
          const x = p[0] + dx
          const y = p[1] + dy
          if (i) ctx.lineTo(x, y)
          else ctx.moveTo(x, y)
        })
        ctx.closePath()
        ctx.fillStyle = shift(b.color, 0.62)
        ctx.fill()
        ctx.globalAlpha = t * layer.getOpacity() * 0.5
        ctx.strokeStyle = 'rgba(126, 130, 122, 0.6)'
        ctx.lineWidth = 0.8
        ctx.stroke()

        if (detailLevel > 0) {
          let cx = 0
          let cy = 0
          for (const p of b.pts) {
            cx += p[0]
            cy += p[1]
          }
          cx = cx / n + dx
          cy = cy / n + dy
          // 屋面内轮廓，近似女儿墙与屋面分层
          ctx.beginPath()
          b.pts.forEach((p, i) => {
            const x = cx + (p[0] + dx - cx) * 0.72
            const y = cy + (p[1] + dy - cy) * 0.72
            if (i) ctx.lineTo(x, y)
            else ctx.moveTo(x, y)
          })
          ctx.closePath()
          ctx.globalAlpha = t * layer.getOpacity() * 0.6
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
          ctx.lineWidth = 0.7
          ctx.stroke()
        }

        if (detailLevel >= 2 && b.floors >= 2) {
          // 楼层线：把基底轮廓按高度比例逐层抬升
          const steps = Math.min(10, b.floors - 1)
          ctx.globalAlpha = t * layer.getOpacity() * 0.32
          ctx.strokeStyle = 'rgba(133, 136, 128, 0.85)'
          ctx.lineWidth = 0.6
          for (let k = 1; k <= steps; k += 1) {
            const f = k / (steps + 1)
            ctx.beginPath()
            b.pts.forEach((p, i) => {
              const x = p[0] + dx * f
              const y = p[1] + dy * f
              if (i) ctx.lineTo(x, y)
              else ctx.moveTo(x, y)
            })
            ctx.closePath()
            ctx.stroke()
          }
        }
        ctx.globalAlpha = t * layer.getOpacity()
      }

      // 语义标注：高层级要素在放大后显示名称
      if (zoom >= 16) {
        const labels = blocks
          .filter((b) => zoom >= 17.2 || b.type !== '住宅')
          .slice(-24)
        ctx.globalAlpha = Math.min(1, t * layer.getOpacity())
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = '500 9.5px "Noto Sans SC", "PingFang SC", system-ui, sans-serif'
        for (const b of labels) {
          const heightPx = Math.min(90, b.heightM / res)
          const dx = heightPx * 0.46
          const dy = -heightPx * 0.58
          let cx = 0
          let cy = 0
          for (const p of b.pts) {
            cx += p[0]
            cy += p[1]
          }
          cx = cx / b.pts.length + dx
          cy = cy / b.pts.length + dy - 6
          const text = b.type === '住宅' ? `${b.type} · ${b.floors}F` : b.name
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
          ctx.lineWidth = 3
          ctx.strokeText(text, cx, cy)
          ctx.fillStyle = '#454c50'
          ctx.fillText(text, cx, cy)
        }
      }
      ctx.globalAlpha = 1
    }

    map.on('postrender', render)
    render()
    return () => {
      map.un('postrender', render)
    }
  }, [])

  /* ---------------- 置顶文字标注（位于所有图层与建筑体块之上） ---------------- */
  useEffect(() => {
    const map = mapRef.current
    const canvas = labelRef.current
    if (!map || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const featuresOf = (id: string): Feature[] => {
      const layer = layersRef.current[id] as
        | VectorLayer<VectorSource>
        | undefined
      if (!layer || !layer.getVisible()) return []
      return layer.getSource()?.getFeatures() ?? []
    }

    const render = () => {
      const size = map.getSize()
      if (!size) return
      const [w, h] = size
      const dpr = window.devicePixelRatio || 1
      const cw = Math.round(w * dpr)
      const ch = Math.round(h * dpr)
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw
        canvas.height = ch
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const res = map.getView().getResolution() ?? 1

      // 视口内可见点判定，用于放大后为长线/大面要素选取近在眼前的锚点
      const inView = (c: number[]) => {
        const p = map.getPixelFromCoordinate(c as [number, number])
        if (!p) return false
        return p[0] > 8 && p[0] < w - 8 && p[1] > 8 && p[1] < h - 8
      }

      /** 锚点：优先取视口内可见几何段的中点，避免放大后要素中心落到视野外 */
      const visibleAnchor = (geom: OlGeometry | undefined): [number, number] | null => {
        if (!geom) return null
        const type = geom.getType()
        if (type === 'Point') return (geom as Point).getCoordinates() as [number, number]
        if (type === 'LineString') {
          const pts = (geom as LineString).getCoordinates()
          const vis = pts.filter(inView)
          if (vis.length) return vis[Math.floor(vis.length / 2)] as [number, number]
          return null
        }
        if (type === 'Polygon') {
          const ip = (geom as Polygon).getInteriorPoint().getCoordinates() as [number, number]
          if (inView(ip)) return ip
          const ring = (geom as Polygon).getCoordinates()[0] as number[][]
          const vis = ring.filter(inView)
          if (vis.length) return vis[Math.floor(vis.length / 2)] as [number, number]
          return null
        }
        return null
      }

      const placed: [number, number, number, number][] = []
      const free = (x: number, y: number, tw: number, th: number) => {
        const x0 = x - tw / 2
        const x1 = x + tw / 2
        const y0 = y - th / 2
        const y1 = y + th / 2
        for (const p of placed) {
          if (x0 <= p[2] && x1 >= p[0] && y0 <= p[3] && y1 >= p[1]) return false
        }
        placed.push([x0, y0, x1, y1])
        return true
      }

      const draw = (
        coord: [number, number],
        text: string,
        font: string,
        fontSize: number,
        color: string,
      ) => {
        if (!text) return
        // 要素几何坐标已是 EPSG:3857 投影坐标，直接转屏幕像素
        const pixel = map.getPixelFromCoordinate(coord)
        if (!pixel) return
        const [x, y] = pixel
        if (x < -60 || x > w + 60 || y < -30 || y > h + 30) return
        if (!free(x, y, fontSize * text.length * 0.96, fontSize * 1.5)) return
        ctx.font = font
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineWidth = Math.max(2.6, fontSize * 0.34)
        ctx.strokeStyle = LABEL_HALO
        ctx.strokeText(text, x, y)
        ctx.fillStyle = color
        ctx.fillText(text, x, y)
      }

      // 功能分区名称：优先级最高，先占位
      if (res < 40) {
        for (const f of featuresOf('districts')) {
          const a = visibleAnchor(f.getGeometry())
          if (a)
            draw(
              a,
              String(f.get('name') ?? ''),
              `600 13px ${FONT}`,
              13,
              '#2b3a46',
            )
        }
      }

      // 生态绿地
      if (res < 18) {
        for (const f of featuresOf('parks')) {
          const a = visibleAnchor(f.getGeometry())
          if (!a) continue
          const cfg =
            PARK_COLORS[String(f.get('parkType') ?? '')] ?? PARK_COLORS['城市公园']
          draw(a, String(f.get('name') ?? ''), `600 10.5px ${FONT}`, 10.5, cfg.label)
        }
      }

      // 洼地 / 滞洪区
      if (res < 6) {
        for (const f of featuresOf('lowland')) {
          const a = visibleAnchor(f.getGeometry())
          if (a) draw(a, String(f.get('name') ?? ''), `600 11px ${FONT}`, 11, '#8a5216')
        }
      }

      // 河道、排水渠与泵站
      if (res < 5.5) {
        for (const f of featuresOf('water')) {
          const geom = f.getGeometry()
          if (!geom || geom.getType() === 'Polygon') continue
          const a = visibleAnchor(geom)
          if (!a) continue
          const fs = String(f.get('kind') ?? '') === 'pump' ? 10 : 11
          draw(a, String(f.get('name') ?? ''), `600 ${fs}px ${FONT}`, fs, '#12566e')
        }
      }

      // 道路名称：数量最多，最后绘制并做碰撞剔除
      if (res < 5.5) {
        for (const f of featuresOf('roads')) {
          const a = visibleAnchor(f.getGeometry())
          if (a) draw(a, String(f.get('name') ?? ''), `500 10.5px ${FONT}`, 10.5, '#39434e')
        }
      }
    }

    map.on('postrender', render)
    render()
    return () => {
      map.un('postrender', render)
    }
  }, [])

  /* ---------------- 建筑高度筛选：同步矢量层样式并重绘 ---------------- */
  useEffect(() => {
    setBuildingMinHeight(props.buildingMinHeight)
    mapRef.current?.render()
  }, [props.buildingMinHeight])

  /* ---------------- 河道水流动画（放大后显现，独立画布轻量绘制） ---------------- */
  useEffect(() => {
    const map = mapRef.current
    const canvas = flowRef.current
    if (!map || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 河道与排水渠中心线，统一转换到地图投影后缓存
    const lines = props.city.hydro.features.map((f) => ({
      kind: String(f.properties.kind ?? ''),
      pts: (f.geometry.coordinates as number[][]).map((c) => fromLonLat(c)),
    }))

    let raf = 0
    let last = 0

    const render = (now: number) => {
      raf = requestAnimationFrame(render)
      if (now - last < 33) return
      last = now

      const size = map.getSize()
      if (!size) return
      const [w, h] = size
      const dpr = window.devicePixelRatio || 1
      const cw = Math.round(w * dpr)
      const ch = Math.round(h * dpr)
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw
        canvas.height = ch
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const waterLayer = layersRef.current.water
      if (!waterLayer || !waterLayer.getVisible() || !waterLayer.getOpacity()) return

      const zoom = map.getView().getZoom() ?? 0
      const fade = Math.min(1, Math.max(0, (zoom - 15.1) / 0.9))
      if (fade <= 0.02) return

      const offset = (now * 0.05) % 40
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      // 主河道：宽水面上的两股白色水流，模拟顺流而下的水纹
      for (const line of lines) {
        const px: number[][] = []
        for (const c of line.pts) {
          const p = map.getPixelFromCoordinate(c)
          if (p) px.push(p)
        }
        if (px.length < 2) continue
        const isRiver = line.kind === 'river'
        const width = isRiver ? 2.6 : 1.3
        const alpha = fade * waterLayer.getOpacity()

        ctx.beginPath()
        px.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
        ctx.setLineDash(isRiver ? [16, 26] : [9, 20])
        ctx.lineDashOffset = -offset
        ctx.lineWidth = width
        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.62 * alpha).toFixed(3)})`
        ctx.stroke()

        ctx.beginPath()
        px.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
        ctx.setLineDash(isRiver ? [7, 33] : [5, 26])
        ctx.lineDashOffset = -offset * 1.55 - 12
        ctx.lineWidth = width * 0.55
        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.3 * alpha).toFixed(3)})`
        ctx.stroke()
      }
      ctx.setLineDash([])
    }

    raf = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(raf)
      ctx.setLineDash([])
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [props.city])

  /* ---------------- 水位上涨淹没演示（Three.js 水面 + 岸线/HUD） ---------------- */
  useEffect(() => {
    const map = mapRef.current
    const canvas = floodRef.current
    const water = waterOverlayRef.current
    if (!map || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dem = props.city.terrain.dem
    const baseLevel = dem.min + 1.6 // 河道常水位：刚好覆盖河床
    const topLevel = dem.min + 8.2 // 洪水演示上限
    let raf = 0

    if (!props.floodDemo) {
      water?.setLevel(baseLevel)
      const size = map.getSize()
      if (size) {
        const dpr = window.devicePixelRatio || 1
        canvas.width = Math.round(size[0] * dpr)
        canvas.height = Math.round(size[1] * dpr)
        canvas.style.width = `${size[0]}px`
        canvas.style.height = `${size[1]}px`
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
      return
    }

    const render = (now: number) => {
      raf = requestAnimationFrame(render)
      const size = map.getSize()
      if (!size) return
      const [w, h] = size
      const dpr = window.devicePixelRatio || 1
      const cw = Math.round(w * dpr)
      const ch = Math.round(h * dpr)
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw
        canvas.height = ch
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // 13 s 周期：上涨 8 s、回落 5 s
      const cycle = 13000
      const p = (now % cycle) / cycle
      const wave = p < 0.62 ? p / 0.62 : (1 - p) / 0.38
      const level = baseLevel + wave * (topLevel - baseLevel)
      water?.setLevel(level)

      // 岸线：当前水位等值线，虚线流动表示水面推进
      const tl = map.getPixelFromCoordinate(fromLonLat([dem.west, dem.north]))
      const br = map.getPixelFromCoordinate(fromLonLat([dem.east, dem.south]))
      if (tl && br) {
        const spanX = br[0] - tl[0]
        const spanY = br[1] - tl[1]
        const segs = contourSegments(dem, level)
        const mapX = (c: number) => tl[0] + (c / (dem.cols - 1)) * spanX
        const mapY = (r: number) => tl[1] + (r / (dem.rows - 1)) * spanY
        ctx.save()
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.setLineDash([10, 8])
        ctx.lineDashOffset = -(now * 0.04) % 18
        ctx.lineWidth = 1.5
        ctx.strokeStyle = 'rgba(168, 238, 255, 0.88)'
        ctx.beginPath()
        for (const s of segs) {
          ctx.moveTo(mapX(s[0]), mapY(s[1]))
          ctx.lineTo(mapX(s[2]), mapY(s[3]))
        }
        ctx.stroke()
        ctx.restore()
      }

      // 水位读数
      const label = `洪水水位 ${level.toFixed(1)} m`
      ctx.font = `600 12px ${FONT}`
      const tw = ctx.measureText(label).width
      const bx = w / 2 - (tw + 26) / 2
      const by = 58
      ctx.fillStyle = 'rgba(9, 18, 24, 0.78)'
      ctx.fillRect(bx, by, tw + 26, 26)
      ctx.strokeStyle = 'rgba(96, 196, 226, 0.5)'
      ctx.lineWidth = 1
      ctx.strokeRect(bx, by, tw + 26, 26)
      ctx.fillStyle = '#d8f4ff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, w / 2, by + 13)
    }

    raf = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(raf)
      water?.setLevel(baseLevel)
    }
  }, [props.city, props.floodDemo])

  /* ---------------- 栅格数据源（多级重采样 · 分帧生成 · 按级别缓存） ---------------- */
  // 地形底图已由真实卫星影像瓦片承载，不再生成程序化地形栅格
  useEffect(() => {
    if (!mapRef.current) return
    let cancelled = false
    const level = rasterLevel
    const rainKey = `rainfall|${level.key}`
    const depthKey = `depth|${level.key}`
    const riskKey = `risk|${level.key}`

    void (async () => {
      const rainCached = getRaster(rainKey, props.model)
      const rainUrl =
        rainCached ?? (await createRainDataUrl(props.model.rain, level.scale))
      if (cancelled) return
      if (!rainCached) putRaster(rainKey, props.model, rainUrl)
      setImageSource('rainfall', rainUrl, true)

      const depthCached = getRaster(depthKey, props.model)
      const depthUrl =
        depthCached ??
        (await createDepthDataUrl(props.model.depth, level.scale, level.smoothDepth))
      if (cancelled) return
      if (!depthCached) putRaster(depthKey, props.model, depthUrl)
      setImageSource('depth', depthUrl, false)

      const riskCached = getRaster(riskKey, props.model)
      const riskUrl =
        riskCached ??
        (await createRiskDataUrl(
          props.model.risk,
          props.model.depth.cols,
          props.model.depth.rows,
          level.scale,
          level.smoothDepth,
        ))
      if (cancelled) return
      if (!riskCached) putRaster(riskKey, props.model, riskUrl)
      setImageSource('risk', riskUrl, false)
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.model, rasterLevel])

  // 基准情景变化时失效差异图层缓存
  useEffect(() => {
    for (const key of [...rasterCacheRef.current.keys()]) {
      if (key.startsWith('diff|')) rasterCacheRef.current.delete(key)
    }
  }, [props.baselineModel])

  /* ---------------- 图层显隐与透明度 ---------------- */
  useEffect(() => {
    for (const [id, state] of Object.entries(props.layerStates)) {
      const layer = layersRef.current[id]
      if (!layer) continue
      layer.setVisible(state.visible)
      layer.setOpacity(state.opacity)
    }
  }, [props.layerStates])

  /* ---------------- 情景差异图层 ---------------- */
  useEffect(() => {
    const layer = layersRef.current.diff
    if (!layer || !mapRef.current) return
    const baseline = props.baselineModel
    if (!props.diffVisible || !baseline) {
      layer.setVisible(false)
      return
    }
    const cacheKey = `diff|${rasterLevel.key}|${props.diffMode}`
    const cached = getRaster(cacheKey, props.model)
    if (cached) {
      setImageSource('diff', cached, false)
      layer.setVisible(true)
      return
    }
    let cancelled = false
    void createDiffDataUrl(props.model, baseline, props.diffMode, rasterLevel.scale).then(
      (url) => {
        if (cancelled) return
        putRaster(cacheKey, props.model, url)
        setImageSource('diff', url, false)
        layer.setVisible(true)
      },
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.diffVisible, props.diffMode, props.baselineModel, props.model, rasterLevel])

  /* ---------------- 选中要素 / 查询区域 / 定位 ---------------- */
  useEffect(() => {
    const layer = layersRef.current.selection as VectorLayer<VectorSource> | undefined
    const source = layer?.getSource()
    if (!source) return
    source.clear()
    if (!props.selection) return
    const geometry = new GeoJSON().readGeometry(props.selection.geometry, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857',
    })
    if (geometry) source.addFeature(new Feature(geometry))
  }, [props.selection])

  useEffect(() => {
    const layer = layersRef.current.query as VectorLayer<VectorSource> | undefined
    const source = layer?.getSource()
    if (!source) return
    source.clear()
    if (!props.queryRing) return
    const ring = props.queryRing
    const closed = ring.length > 2 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
      ? [...ring, ring[0]]
      : ring
    const coords = closed.map((p) => fromLonLat(p))
    source.addFeature(new Feature(new Polygon([coords])))
  }, [props.queryRing])

  useEffect(() => {
    const layer = layersRef.current.focus as VectorLayer<VectorSource> | undefined
    const source = layer?.getSource()
    const map = mapRef.current
    if (!source || !map) return
    source.clear()
    if (!props.focusPoint) return
    const { point } = props.focusPoint
    source.addFeature(new Feature(new Point(fromLonLat(point))))
    const v = map.getView()
    const targetZoom = Math.max(v.getZoom() ?? 15, 16)
    v.animate({ center: fromLonLat(point), zoom: targetZoom, duration: 600 })
  }, [props.focusPoint])

  /* ---------------- 复位 ---------------- */
  useEffect(() => {
    const map = mapRef.current
    const extent = mapExtentRef.current
    if (!map || !extent) return
    map.getView().fit(extent, { padding: FIT_PADDING, duration: 350 })
  }, [props.resetKey])

  /* ---------------- 清除测量 ---------------- */
  useEffect(() => {
    clearMeasure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.clearKey])

  /* ---------------- 绘图 / 测量工具 ---------------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const mapEl = map.getTargetElement()
    if (mapEl) mapEl.classList.toggle('gis-crosshair', props.tool !== 'select')
    if (props.tool === 'select') return

    const measureLayer = layersRef.current.measure as VectorLayer<VectorSource> | undefined
    const source = measureLayer?.getSource()
    if (!source) return

    const type: 'Polygon' | 'LineString' =
      props.tool === 'measure-distance' ? 'LineString' : 'Polygon'
    const draw = new Draw({
      source,
      type,
      stopClick: true,
      style: props.tool === 'measure-distance' ? measureLineStyle : measurePolygonStyle,
    })

    draw.on('drawstart', () => {
      source.clear()
      setMeasure(null)
    })

    draw.on('drawend', (evt: DrawEvent) => {
      const geom = evt.feature.getGeometry() as LineString | Polygon
      if (props.tool === 'query-polygon') {
        const ring = (geom as Polygon).getCoordinates()[0].map((c) => toLonLat(c) as LonLat)
        source.clear()
        propsRef.current.onRingDrawn(ring)
      } else if (props.tool === 'measure-distance') {
        setMeasure(`测距结果 ${fmtLength(getLength(geom))}`)
      } else {
        setMeasure(`测面积结果 ${fmtArea(getArea(geom))}`)
      }
    })

    map.addInteraction(draw)
    return () => {
      map.removeInteraction(draw)
    }
  }, [props.tool])

  return (
    <div className="map-host">
      <div className="map-canvas" ref={containerRef} />
      <canvas className="river-flow-canvas" ref={flowRef} aria-hidden="true" />
      <canvas className="flood-canvas" ref={floodRef} aria-hidden="true" />
      <canvas className="building-3d-canvas" ref={b3dRef} aria-hidden="true" />
      <canvas className="map-label-canvas" ref={labelRef} aria-hidden="true" />
      <div className="map-tooltip" ref={tooltipRef}>
        <span className="map-tooltip-title" ref={tipTitleRef} />
        <span className="map-tooltip-sub" ref={tipSubRef} />
      </div>
      {measure && (
        <div className="map-measure-card">
          <span className="map-measure-text">{measure}</span>
          <button type="button" className="map-measure-clear" onClick={clearMeasure}>
            清除
          </button>
        </div>
      )}
    </div>
  )
}
