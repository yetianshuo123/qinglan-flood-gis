import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
  Polygon,
} from 'geojson'

export type BBox = [number, number, number, number]
export type LonLat = [number, number]

/** 规则栅格：values 为行主序，第 0 行对应最北侧 */
export interface Grid {
  cols: number
  rows: number
  west: number
  south: number
  east: number
  north: number
  values: Float64Array
  min: number
  max: number
  unit: string
}

export interface TerrainGrid {
  dem: Grid
  slope: Float64Array // m/m
  urbanity: Float64Array // 0..1
  riverDistM: Float64Array
  drainDistM: Float64Array
  pumpDistM: Float64Array
  infilRate: Float64Array // mm/h
  runoffCoef: Float64Array
  susceptibility: Float64Array // 0..1 地形易涝度
  flowAccum: Float64Array
}

export interface RoadProps {
  kind: 'road'
  id: string
  name: string
  roadClass: '主干道' | '次干道' | '支路'
  lanes: number
  lengthM: number
  district: string
  surface: string
  bridge: boolean
}

export interface BuildingProps {
  kind: 'building'
  id: string
  name: string
  buildingType: '住宅' | '商业' | '公共' | '学校' | '医院' | '工业'
  district: string
  floors: number
  heightM: number
  footprintM2: number
  elevation: number
}

export interface HydroProps {
  kind: 'river' | 'canal'
  id: string
  name: string
  widthM: number
  lengthM: number
  capacityM3s: number
}

export interface PumpProps {
  kind: 'pump'
  id: string
  name: string
  capacityM3s: number
  district: string
}

export interface LowlandProps {
  kind: 'lowland'
  id: string
  name: string
  areaM2: number
  meanElev: number
  minElev: number
  storageM3: number
  district: string
}

export interface ParkProps {
  kind: 'park'
  id: string
  name: string
  parkType: string
  areaM2: number
  district: string
}

export interface DistrictProps {
  kind: 'district'
  id: string
  name: string
  areaM2: number
  code: string
}

export interface CityData {
  bounds: BBox
  districts: FeatureCollection<Polygon, DistrictProps>
  roads: FeatureCollection<LineString, RoadProps>
  buildings: FeatureCollection<Polygon, BuildingProps>
  hydro: FeatureCollection<LineString, HydroProps>
  hydroAreas: FeatureCollection<Polygon, HydroProps>
  pumps: FeatureCollection<Point, PumpProps>
  lowlands: FeatureCollection<Polygon, LowlandProps>
  parks: FeatureCollection<Polygon, ParkProps>
  river: Feature<LineString>
  terrain: TerrainGrid
  rainPattern: Float64Array
  districtCenters: Record<string, LonLat>
}

export interface Scenario {
  rainMmH: number
  durationH: number
  label: string
}

export interface RoadImpact {
  id: string
  name: string
  floodedLengthM: number
  floodedPct: number
  maxDepth: number
  lengthM: number
  point: LonLat
}

export interface BuildingImpact {
  id: string
  name: string
  buildingType: string
  district: string
  depth: number
  risk: number
  point: LonLat
}

export interface ScenarioMetrics {
  rainMmH: number
  durationH: number
  totalRainMm: number
  floodedAreaM2: number
  floodedPct: number
  riskAreaM2: [number, number, number, number, number]
  highRiskAreaM2: number
  maxDepth: number
  meanDepthFlooded: number
  affectedRoads: RoadImpact[]
  affectedBuildings: BuildingImpact[]
}

export interface ModelResult {
  scenario: Scenario
  rain: Grid
  depth: Grid
  risk: Uint8Array
  flowAccum: Float64Array
  metrics: ScenarioMetrics
}

export interface DetailRow {
  label: string
  value: string
  tone?: 'warn' | 'danger' | 'ok'
}

export interface FeatureDetail {
  kind: string
  id: string
  title: string
  subtitle: string
  sections: { title: string; rows: DetailRow[] }[]
  note?: string
}

export interface AreaStats {
  areaM2: number
  cellCount: number
  avgElev: number | null
  minElev: number | null
  maxElev: number | null
  meanRainMmH: number | null
  totalRainMm: number | null
  avgDepth: number | null
  maxDepth: number | null
  floodedAreaM2: number
  riskAreaM2: [number, number, number, number, number]
  roads: { id: string; name: string; floodedLengthM: number; lengthInAreaM: number }[]
  roadLengthInAreaM: number
  floodedRoadLengthM: number
  buildings: { id: string; name: string; buildingType: string; depth: number; risk: number }[]
  floodedBuildings: number
  deepestPoint: LonLat | null
}
