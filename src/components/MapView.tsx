import { useEffect, useRef, useState } from 'react'
import Feature from 'ol/Feature'
import Map from 'ol/Map'
import View from 'ol/View'
import { defaults as defaultControls, ScaleLine, Zoom } from 'ol/control'
import GeoJSON from 'ol/format/GeoJSON'
import type { Geometry } from 'geojson'
import type BaseLayer from 'ol/layer/Base'
import ImageLayer from 'ol/layer/Image'
import VectorLayer from 'ol/layer/Vector'
import { defaults as defaultInteractions, Draw } from 'ol/interaction'
import type { DrawEvent } from 'ol/interaction/Draw'
import LineString from 'ol/geom/LineString'
import Point from 'ol/geom/Point'
import Polygon from 'ol/geom/Polygon'
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj'
import type { Extent } from 'ol/extent'
import ImageStatic from 'ol/source/ImageStatic'
import VectorSource from 'ol/source/Vector'
import { getArea, getLength } from 'ol/sphere'
import type { CityData, LonLat, ModelResult } from '../gis/types'
import type { DiffMode } from '../gis/rasters'
import {
  createDepthDataUrl,
  createDiffDataUrl,
  createRainDataUrl,
  createRiskDataUrl,
  createTerrainDataUrl,
} from '../gis/rasters'
import {
  buildingStyle,
  districtStyle,
  focusStyle,
  lowlandStyle,
  measureLineStyle,
  measurePolygonStyle,
  queryPolygonStyle,
  roadStyle,
  selectionStyle,
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
  onCursor: (info: CursorInfo | null) => void
  onSelect: (sel: SelectionInfo | null) => void
  onPointQuery: (p: LonLat) => void
  onRingDrawn: (ring: LonLat[]) => void
  onViewChange: (v: { zoom: number; scaleText: string }) => void
}

const FIT_PADDING: [number, number, number, number] = [80, 390, 74, 300]
const VECTOR_IDS = ['districts', 'lowland', 'water', 'roads', 'buildings']

function featureSubtitle(props: Record<string, unknown>): string {
  const kind = String(props.kind ?? '')
  if (kind === 'building') return `${props.buildingType} · ${props.district}`
  if (kind === 'road') return `${props.roadClass} · ${Math.round(Number(props.lengthM))} m`
  if (kind === 'river') return `天然河道 · ${props.capacityM3s} m³/s`
  if (kind === 'canal') return `排水渠 · ${props.capacityM3s} m³/s`
  if (kind === 'pump') return `泵站 · ${props.capacityM3s} m³/s`
  if (kind === 'lowland') return `低洼区 · ${props.district}`
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
  const mapRef = useRef<Map | null>(null)
  const layersRef = useRef<Record<string, BaseLayer>>({})
  const mapExtentRef = useRef<Extent | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  const [measure, setMeasure] = useState<string | null>(null)

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

    const terrainLayer = new ImageLayer({ zIndex: 1 })
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
        bar: true,
        steps: 4,
        minWidth: 96,
        className: 'gis-scale',
      }),
    )
    map.addControl(new Zoom({ className: 'gis-zoom' }))
    mapRef.current = map

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
      map.setTarget(undefined)
      mapRef.current = null
      layersRef.current = {}
    }
  }, [])

  /* ---------------- 栅格数据源 ---------------- */
  useEffect(() => {
    if (!mapRef.current) return
    setImageSource('terrain', createTerrainDataUrl(props.city.terrain), true)
  }, [props.city])

  useEffect(() => {
    if (!mapRef.current) return
    setImageSource('rainfall', createRainDataUrl(props.model.rain), true)
    setImageSource('depth', createDepthDataUrl(props.model.depth), false)
    setImageSource(
      'risk',
      createRiskDataUrl(props.model.risk, props.model.depth.cols, props.model.depth.rows),
      false,
    )
  }, [props.model])

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
    setImageSource(
      'diff',
      createDiffDataUrl(props.model, baseline, props.diffMode),
      false,
    )
    layer.setVisible(true)
  }, [props.diffVisible, props.diffMode, props.baselineModel, props.model])

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
      <div className="map-corner-note">
        青澜市 · 虚拟城市边界 · WGS84 / Web Mercator
      </div>
    </div>
  )
}
