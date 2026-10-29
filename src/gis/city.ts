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
  ParkProps,
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
import { mulberry32, valueNoise } from './rng'

// 宽矩形城市范围（约 15.4 km × 8.9 km），接近 16:9，适配电脑屏幕
const BOUNDS: [number, number, number, number] = [120.0, 30.0, 120.16, 30.08]
const COLS = 168
const ROWS = 90

/** 澜江：自北向南穿城，河道平缓弯曲，下游略向东偏移 */
const RIVER: LonLat[] = [
  [120.081, 30.08],
  [120.0845, 30.073],
  [120.083, 30.066],
  [120.0845, 30.059],
  [120.086, 30.052],
  [120.088, 30.045],
  [120.0905, 30.038],
  [120.0935, 30.031],
  [120.0965, 30.024],
  [120.1005, 30.017],
  [120.1045, 30.01],
  [120.11, 30.0],
]

const CANALS: { id: string; name: string; widthM: number; coords: LonLat[]; capacity: number }[] = [
  {
    id: 'C01',
    name: '北岭排洪渠',
    widthM: 20,
    capacity: 30,
    coords: [
      [120.046, 30.074],
      [120.052, 30.068],
      [120.062, 30.062],
      [120.076, 30.058],
      [120.0845, 30.056],
    ],
  },
  {
    id: 'C02',
    name: '西溪排涝渠',
    widthM: 16,
    capacity: 18,
    coords: [
      [120.014, 30.05],
      [120.03, 30.048],
      [120.05, 30.046],
      [120.07, 30.044],
      [120.089, 30.041],
    ],
  },
  {
    id: 'C03',
    name: '中区泵排干渠',
    widthM: 22,
    capacity: 34,
    coords: [
      [120.062, 30.034],
      [120.074, 30.032],
      [120.086, 30.03],
      [120.096, 30.026],
      [120.0985, 30.022],
    ],
  },
  {
    id: 'C04',
    name: '东港排水渠',
    widthM: 18,
    capacity: 24,
    coords: [
      [120.132, 30.06],
      [120.134, 30.048],
      [120.132, 30.036],
      [120.128, 30.026],
      [120.124, 30.02],
    ],
  },
]

const PUMPS: { id: string; name: string; lon: number; lat: number; capacity: number; district: string }[] = [
  { id: 'P01', name: '北岭入河泵站', lon: 120.0815, lat: 30.057, capacity: 6.0, district: '澜汀主城区' },
  { id: 'P02', name: '中区一号泵站', lon: 120.07, lat: 30.033, capacity: 5.4, district: '澜汀主城区' },
  { id: 'P03', name: '中区二号泵站', lon: 120.092, lat: 30.029, capacity: 4.8, district: '澜汀主城区' },
  { id: 'P04', name: '南塘湿地排涝泵站', lon: 120.107, lat: 30.018, capacity: 3.6, district: '南塘湿地滞洪区' },
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
  { id: 'L01', name: '南塘湿地滞洪区', lon: 120.1, lat: 30.012, rx: 0.042, ry: 0.0095, rot: 0, amp: 3.0, district: '南塘湿地滞洪区' },
  { id: 'L02', name: '中区西南洼地', lon: 120.058, lat: 30.028, rx: 0.0075, ry: 0.0048, rot: -12, amp: 2.2, district: '澜汀主城区' },
  { id: 'L03', name: '东港低洼带', lon: 120.132, lat: 30.032, rx: 0.007, ry: 0.005, rot: 18, amp: 2.0, district: '东港智造物流区' },
  { id: 'L04', name: '北岭山前洼地', lon: 120.07, lat: 30.062, rx: 0.006, ry: 0.0035, rot: 8, amp: 1.6, district: '北岭生态屏障' },
]

interface DistrictDef {
  id: string
  name: string
  ring: LonLat[]
}

/** 五类功能分区：边界不规则，贴合河谷、山前与湿地，而非规整矩形 */
const DISTRICTS: DistrictDef[] = [
  {
    id: 'D1',
    name: '北岭生态屏障',
    ring: [
      [120.0, 30.08],
      [120.16, 30.08],
      [120.16, 30.062],
      [120.146, 30.06],
      [120.134, 30.064],
      [120.122, 30.058],
      [120.108, 30.062],
      [120.094, 30.057],
      [120.08, 30.061],
      [120.064, 30.056],
      [120.048, 30.061],
      [120.03, 30.058],
      [120.014, 30.062],
      [120.0, 30.06],
    ],
  },
  {
    id: 'D2',
    name: '西溪科教居住区',
    ring: [
      [120.0, 30.06],
      [120.014, 30.062],
      [120.03, 30.058],
      [120.048, 30.061],
      [120.058, 30.056],
      [120.054, 30.044],
      [120.05, 30.034],
      [120.052, 30.024],
      [120.044, 30.012],
      [120.028, 30.004],
      [120.008, 30.004],
      [120.0, 30.01],
    ],
  },
  {
    id: 'D3',
    name: '澜汀主城区',
    ring: [
      [120.058, 30.056],
      [120.08, 30.061],
      [120.094, 30.057],
      [120.108, 30.062],
      [120.122, 30.058],
      [120.128, 30.048],
      [120.124, 30.036],
      [120.112, 30.026],
      [120.098, 30.024],
      [120.084, 30.028],
      [120.07, 30.026],
      [120.058, 30.03],
      [120.052, 30.04],
      [120.054, 30.048],
    ],
  },
  {
    id: 'D4',
    name: '东港智造物流区',
    ring: [
      [120.122, 30.058],
      [120.134, 30.064],
      [120.146, 30.06],
      [120.16, 30.062],
      [120.16, 30.008],
      [120.14, 30.006],
      [120.124, 30.012],
      [120.118, 30.022],
      [120.124, 30.036],
      [120.128, 30.048],
    ],
  },
  {
    id: 'D5',
    name: '南塘湿地滞洪区',
    ring: [
      [120.028, 30.004],
      [120.044, 30.012],
      [120.052, 30.024],
      [120.07, 30.026],
      [120.084, 30.028],
      [120.098, 30.024],
      [120.112, 30.026],
      [120.118, 30.022],
      [120.124, 30.012],
      [120.14, 30.006],
      [120.118, 30.0],
      [120.06, 30.0],
      [120.04, 30.002],
    ],
  },
]

interface RoadDef {
  id: string
  name: string
  roadClass: RoadProps['roadClass']
  lanes: number
  a: LonLat
  b: LonLat
  amp: number
  axis: 'ew' | 'ns' | 'ring'
  surface: string
  /** 环线或避让型道路的显式折线 */
  path?: LonLat[]
}

/** 三横三纵一环：横线横贯东西，纵线贯通南北，环线围合主城区 */
const ROAD_DEFS: RoadDef[] = [
  { id: 'R01', name: '北岭路', roadClass: '主干道', lanes: 6, a: [120.004, 30.058], b: [120.156, 30.058], amp: 0.0007, axis: 'ew', surface: '沥青' },
  { id: 'R02', name: '中央大道', roadClass: '主干道', lanes: 8, a: [120.004, 30.042], b: [120.156, 30.042], amp: 0.0006, axis: 'ew', surface: '沥青' },
  {
    id: 'R03',
    name: '南环路',
    roadClass: '主干道',
    lanes: 6,
    a: [120.004, 30.026],
    b: [120.156, 30.026],
    amp: 0.0004,
    axis: 'ew',
    surface: '沥青',
    // 主干路避让南塘湿地核心区，向南绕行于湿地北缘
    path: [
      [120.004, 30.026],
      [120.03, 30.025],
      [120.052, 30.0245],
      [120.068, 30.0245],
      [120.08, 30.0255],
      [120.092, 30.0265],
      [120.104, 30.026],
      [120.112, 30.0245],
      [120.12, 30.0225],
      [120.132, 30.021],
      [120.144, 30.022],
      [120.156, 30.026],
    ],
  },
  { id: 'R04', name: '西溪路', roadClass: '主干道', lanes: 6, a: [120.03, 30.004], b: [120.03, 30.064], amp: 0.0008, axis: 'ns', surface: '沥青' },
  { id: 'R05', name: '澜汀大道', roadClass: '主干道', lanes: 8, a: [120.1, 30.027], b: [120.1, 30.06], amp: 0.0005, axis: 'ns', surface: '沥青' },
  { id: 'R06', name: '东港大道', roadClass: '主干道', lanes: 8, a: [120.14, 30.008], b: [120.14, 30.062], amp: 0.0005, axis: 'ns', surface: '沥青' },
  {
    id: 'R07',
    name: '澜汀一环',
    roadClass: '主干道',
    lanes: 6,
    a: [120.042, 30.052],
    b: [120.116, 30.03],
    amp: 0.0003,
    axis: 'ring',
    surface: '沥青',
    path: [
      [120.042, 30.052],
      [120.056, 30.056],
      [120.07, 30.058],
      [120.086, 30.0565],
      [120.1, 30.055],
      [120.112, 30.051],
      [120.118, 30.045],
      [120.116, 30.036],
      [120.11, 30.03],
      [120.098, 30.028],
      [120.086, 30.029],
      [120.074, 30.03],
      [120.062, 30.032],
      [120.052, 30.036],
      [120.046, 30.044],
      [120.042, 30.05],
      [120.042, 30.052],
    ],
  },
  { id: 'R08', name: '滨江路', roadClass: '次干道', lanes: 4, a: [120.076, 30.0245], b: [120.076, 30.06], amp: 0.0007, axis: 'ns', surface: '沥青' },
  { id: 'R09', name: '学府路', roadClass: '次干道', lanes: 4, a: [120.006, 30.05], b: [120.056, 30.05], amp: 0.0006, axis: 'ew', surface: '沥青' },
  { id: 'R10', name: '文澜路', roadClass: '次干道', lanes: 4, a: [120.04, 30.034], b: [120.116, 30.034], amp: 0.0006, axis: 'ew', surface: '沥青' },
  { id: 'R11', name: '科创路', roadClass: '次干道', lanes: 4, a: [120.048, 30.008], b: [120.048, 30.058], amp: 0.0007, axis: 'ns', surface: '混凝土' },
  { id: 'R12', name: '临港路', roadClass: '次干道', lanes: 4, a: [120.104, 30.048], b: [120.156, 30.048], amp: 0.0006, axis: 'ew', surface: '混凝土' },
  { id: 'R13', name: '港前路', roadClass: '次干道', lanes: 4, a: [120.122, 30.012], b: [120.158, 30.012], amp: 0.0006, axis: 'ew', surface: '混凝土' },
]

/** 局部街巷：加密路网，把主路围合的大地块细分为接近真实尺度的街区 */
const LOCAL_ROAD_DEFS: RoadDef[] = [
  { id: 'S01', name: '北岭林道', roadClass: '支路', lanes: 2, a: [120.024, 30.068], b: [120.146, 30.068], amp: 0.0008, axis: 'ew', surface: '沥青' },
  { id: 'S02', name: '学府支路', roadClass: '支路', lanes: 2, a: [120.008, 30.046], b: [120.054, 30.046], amp: 0.0006, axis: 'ew', surface: '混凝土' },
  { id: 'S03', name: '西溪南街', roadClass: '支路', lanes: 2, a: [120.016, 30.006], b: [120.016, 30.05], amp: 0.0007, axis: 'ns', surface: '沥青' },
  { id: 'S04', name: '科创一支路', roadClass: '支路', lanes: 2, a: [120.008, 30.055], b: [120.05, 30.055], amp: 0.0006, axis: 'ew', surface: '混凝土' },
  { id: 'S05', name: '云栖街', roadClass: '支路', lanes: 2, a: [120.062, 30.026], b: [120.062, 30.056], amp: 0.0006, axis: 'ns', surface: '沥青' },
  { id: 'S06', name: '云栖南街', roadClass: '支路', lanes: 2, a: [120.07, 30.028], b: [120.07, 30.04], amp: 0.0006, axis: 'ns', surface: '混凝土' },
  { id: 'S07', name: '南塘支路', roadClass: '支路', lanes: 2, a: [120.062, 30.03], b: [120.116, 30.03], amp: 0.0006, axis: 'ew', surface: '沥青' },
  { id: 'S08', name: '青岚街', roadClass: '支路', lanes: 2, a: [120.118, 30.026], b: [120.118, 30.056], amp: 0.0006, axis: 'ns', surface: '沥青' },
  { id: 'S09', name: '文澜南街', roadClass: '支路', lanes: 2, a: [120.108, 30.028], b: [120.108, 30.04], amp: 0.0005, axis: 'ns', surface: '混凝土' },
  { id: 'S10', name: '工业一支路', roadClass: '支路', lanes: 2, a: [120.12, 30.038], b: [120.156, 30.038], amp: 0.0006, axis: 'ew', surface: '混凝土' },
  { id: 'S11', name: '物流支路', roadClass: '支路', lanes: 2, a: [120.128, 30.026], b: [120.158, 30.026], amp: 0.0006, axis: 'ew', surface: '混凝土' },
  { id: 'S12', name: '东港一支路', roadClass: '支路', lanes: 2, a: [120.126, 30.016], b: [120.126, 30.054], amp: 0.0006, axis: 'ns', surface: '沥青' },
  { id: 'S13', name: '东港二支路', roadClass: '支路', lanes: 2, a: [120.15, 30.012], b: [120.15, 30.056], amp: 0.0006, axis: 'ns', surface: '沥青' },
  { id: 'S14', name: '南塘堤路', roadClass: '支路', lanes: 2, a: [120.064, 30.02], b: [120.12, 30.02], amp: 0.0005, axis: 'ew', surface: '混凝土' },
]

/** 生态绿地：北部森林公园、南部湿地公园、沿江缓冲带与主城区公园 */
interface ParkDef {
  id: string
  name: string
  parkType: string
  ring: LonLat[]
}

const PARK_DEFS: ParkDef[] = [
  {
    id: 'G01',
    name: '北岭森林公园',
    parkType: '森林公园',
    ring: [
      [120.012, 30.074],
      [120.022, 30.07],
      [120.034, 30.073],
      [120.046, 30.069],
      [120.058, 30.072],
      [120.072, 30.068],
      [120.086, 30.071],
      [120.098, 30.067],
      [120.112, 30.07],
      [120.124, 30.066],
      [120.136, 30.069],
      [120.148, 30.065],
      [120.152, 30.078],
      [120.012, 30.078],
    ],
  },
  {
    id: 'G02',
    name: '南塘湿地公园',
    parkType: '湿地公园',
    ring: [
      [120.062, 30.02],
      [120.072, 30.023],
      [120.086, 30.021],
      [120.098, 30.023],
      [120.11, 30.02],
      [120.12, 30.017],
      [120.122, 30.01],
      [120.114, 30.005],
      [120.1, 30.003],
      [120.086, 30.004],
      [120.072, 30.003],
      [120.06, 30.008],
      [120.058, 30.014],
    ],
  },
  {
    id: 'G03',
    name: '澜汀中央公园',
    parkType: '城市公园',
    ring: blob(120.071, 30.0475, 0.0055, 0.0035, 15, 771),
  },
]

/** 中部高地的城市生命线设施，以及西溪科教园区的成组校园建筑 */
const KEY_FACILITIES: {
  name: string
  type: BuildingProps['buildingType']
  lon: number
  lat: number
  wM: number
  dM: number
  floors: number
  shape: BuildingShape
}[] = [
  { name: '澜汀市中心医院', type: '医院', lon: 120.104, lat: 30.0465, wM: 190, dM: 130, floors: 14, shape: 'T' },
  { name: '澜汀市应急指挥中心', type: '公共', lon: 120.0995, lat: 30.0505, wM: 130, dM: 95, floors: 7, shape: 'U' },
  { name: '澜汀 220kV 变电站', type: '工业', lon: 120.1085, lat: 30.0425, wM: 120, dM: 100, floors: 2, shape: 'rect' },
  { name: '澜汀大学图书馆', type: '学校', lon: 120.027, lat: 30.046, wM: 150, dM: 110, floors: 6, shape: 'U' },
  { name: '澜汀大学实验楼', type: '学校', lon: 120.032, lat: 30.0415, wM: 130, dM: 85, floors: 5, shape: 'L' },
  { name: '澜汀科技大学教学楼', type: '学校', lon: 120.0215, lat: 30.0405, wM: 140, dM: 90, floors: 5, shape: 'rect' },
]

function closeRing(ring: LonLat[]): LonLat[] {
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) return ring
  return [...ring, first]
}

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

type BuildingShape = 'rect' | 'strip' | 'L' | 'U' | 'T'

/** 归一化建筑轮廓（局部坐标，范围 -0.5~0.5），用于生成接近真实街区的多样基底 */
const SHAPE_OUTLINES: Record<BuildingShape, [number, number][]> = {
  rect: [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ],
  strip: [
    [-0.5, -0.24],
    [0.5, -0.24],
    [0.5, 0.24],
    [-0.5, 0.24],
  ],
  L: [
    [-0.5, -0.5],
    [0.14, -0.5],
    [0.14, -0.02],
    [0.5, -0.02],
    [0.5, 0.5],
    [-0.5, 0.5],
  ],
  U: [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [0.16, 0.5],
    [0.16, -0.08],
    [-0.16, -0.08],
    [-0.16, 0.5],
    [-0.5, 0.5],
  ],
  T: [
    [-0.5, 0.5],
    [0.5, 0.5],
    [0.5, 0.08],
    [0.16, 0.08],
    [0.16, -0.5],
    [-0.16, -0.5],
    [-0.16, 0.08],
    [-0.5, 0.08],
  ],
}

function shapeBuilding(
  lon: number,
  lat: number,
  wM: number,
  dM: number,
  rotDeg: number,
  shape: BuildingShape,
): LonLat[] {
  const rot = (rotDeg * Math.PI) / 180
  const mPerLat = 111132
  const mPerLon = 111320 * Math.cos((lat * Math.PI) / 180)
  const corners: LonLat[] = []
  for (const [x, y] of SHAPE_OUTLINES[shape]) {
    const px = x * wM
    const py = y * dM
    const rx = px * Math.cos(rot) - py * Math.sin(rot)
    const ry = px * Math.sin(rot) + py * Math.cos(rot)
    corners.push([lon + rx / mPerLon, lat + ry / mPerLat])
  }
  corners.push(corners[0])
  return corners
}

/** 按建筑类型分配基底形态，住宅多为条形/板式，商业与医院多为 L/T 形 */
const SHAPE_POOLS: Record<string, BuildingShape[]> = {
  住宅: ['rect', 'rect', 'rect', 'strip', 'strip', 'L'],
  商业: ['rect', 'rect', 'L', 'L', 'T'],
  公共: ['rect', 'rect', 'U', 'L'],
  学校: ['U', 'L', 'rect'],
  医院: ['T', 'T', 'rect'],
  工业: ['rect', 'rect', 'L'],
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
    const ring = closeRing(d.ring)
    const center: LonLat = centroid(polygon([ring])).geometry.coordinates as LonLat
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

  /** 点所在功能分区：分区边界不规则，按真实环判断 */
  const districtAt = (lon: number, lat: number): string | null => {
    for (const d of DISTRICTS) {
      if (pointInRing([lon, lat], d.ring)) return d.name
    }
    return null
  }

  const riverLine = lineString(RIVER)
  const riverAreaFeature = buffer(riverLine, 0.075, { units: 'kilometers' })
  if (!riverAreaFeature) throw new Error('river buffer failed')
  const riverAreaGeometry = riverAreaFeature.geometry as unknown as Polygon
  const riverRing = riverAreaGeometry.coordinates[0]
  const hydroAreas: Feature<Polygon, HydroProps>[] = [
    {
      type: 'Feature',
      properties: {
        kind: 'river',
        id: 'W01',
        name: '澜江',
        widthM: 130,
        lengthM: Math.round(polylineLengthMeters(RIVER)),
        capacityM3s: 260,
      },
      geometry: riverAreaGeometry,
    },
  ]

  const hydro: Feature<LineString, HydroProps>[] = [
    lineString(RIVER, {
      kind: 'river' as const,
      id: 'W01',
      name: '澜江',
      widthM: 130,
      lengthM: Math.round(polylineLengthMeters(RIVER)),
      capacityM3s: 260,
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

  const parks: Feature<Polygon, ParkProps>[] = PARK_DEFS.map((p) => {
    const ring = closeRing(p.ring)
    const poly = polygon([ring])
    return {
      type: 'Feature' as const,
      properties: {
        kind: 'park' as const,
        id: p.id,
        name: p.name,
        parkType: p.parkType,
        areaM2: Math.round(turfArea(poly)),
        district: districtAt(p.ring[0][0], p.ring[0][1]) ?? '澜汀主城区',
      },
      geometry: { type: 'Polygon' as const, coordinates: [ring] },
    }
  })
  // 澜江两岸生态缓冲带：沿河道两侧各约 160 m
  const bufferFeature = buffer(riverLine, 0.16, { units: 'kilometers' })
  if (bufferFeature) {
    const geom = bufferFeature.geometry
    const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates]
    polys.forEach((coords, i) => {
      const ring = coords[0] as unknown as LonLat[]
      const poly = polygon([ring])
      const c = centroid(poly).geometry.coordinates as LonLat
      parks.push({
        type: 'Feature' as const,
        properties: {
          kind: 'park' as const,
          id: i === 0 ? 'G04' : `G04-${i + 1}`,
          name: i === 0 ? '澜江滨江生态缓冲带' : `澜江滨江生态缓冲带 ${i + 1}`,
          parkType: '滨江生态缓冲带',
          areaM2: Math.round(turfArea(poly)),
          district: districtAt(c[0], c[1]) ?? '澜汀主城区',
        },
        geometry: { type: 'Polygon' as const, coordinates: [ring] },
      })
    })
  }
  const parkRings = parks.map((f) => f.geometry.coordinates[0] as LonLat[])

  const roads = [...ROAD_DEFS, ...LOCAL_ROAD_DEFS].map((r) => {
    const coords =
      r.path ??
      wiggleLine(r.a, r.b, r.amp, r.axis === 'ring' ? 'ns' : r.axis, Number(r.id.slice(1)) * 1.7)
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
      district: districtAt(mid[0], mid[1]) ?? roadDistrict(mid[0], mid[1], districtCenters),
      surface: r.surface,
      bridge,
    }
    return { type: 'Feature' as const, properties: props, geometry: { type: 'LineString' as const, coordinates: coords } }
  })

  const rnd = mulberry32(20261028)
  const buildings: CityData['buildings']['features'] = []
  const nameCounter: Record<string, number> = {}

  // 街巷网：由主路与局部街巷的经纬线围合成街块，建筑沿街成排布置
  const mPerLon = 111320 * Math.cos((30.04 * Math.PI) / 180)
  const mPerLat = 111132
  const xLines = Array.from(
    new Set([
      west + 0.002,
      ...ROAD_DEFS.filter((r) => r.axis === 'ns').map((r) => r.a[0]),
      ...LOCAL_ROAD_DEFS.filter((r) => r.axis === 'ns').map((r) => r.a[0]),
      east - 0.002,
    ]),
  ).sort((a, b) => a - b)
  const yLines = Array.from(
    new Set([
      south + 0.002,
      ...ROAD_DEFS.filter((r) => r.axis === 'ew').map((r) => r.a[1]),
      ...LOCAL_ROAD_DEFS.filter((r) => r.axis === 'ew').map((r) => r.a[1]),
      north - 0.002,
    ]),
  ).sort((a, b) => a - b)

  interface Placement {
    lon: number
    lat: number
    wM: number
    dM: number
    rot: number
    type: BuildingProps['buildingType']
    floors: number
    name?: string
    shape?: BuildingShape
  }
  const placements: Placement[] = []
  const padLon = 0.0002
  const padLat = 0.00018

  for (let i = 0; i < xLines.length - 1; i++) {
    for (let j = 0; j < yLines.length - 1; j++) {
      const x0 = xLines[i] + padLon
      const x1 = xLines[i + 1] - padLon
      const y0 = yLines[j] + padLat
      const y1 = yLines[j + 1] - padLat
      if (x1 - x0 < 0.0004 || y1 - y0 < 0.0004) continue
      const wM = (x1 - x0) * mPerLon
      const dM = (y1 - y0) * mPerLat
      if (wM < 45 || dM < 45) continue

      const bcx = (x0 + x1) / 2
      const bcy = (y0 + y1) / 2

      // 分区约束：北部生态屏障与南部湿地滞洪区限制开发，绿地内不布置建筑
      const dz = districtAt(bcx, bcy)
      if (!dz || dz === '北岭生态屏障' || dz === '南塘湿地滞洪区') continue
      if (parkRings.some((r) => pointInRing([bcx, bcy], r))) continue

      const dense = dz === '澜汀主城区'
      const edu = dz === '西溪科教居住区'
      const industry = dz === '东港智造物流区'
      const coreDist = distanceMeters([bcx, bcy], [120.1, 30.046])

      // 街区主导功能：主城区核心偏商业、西溪偏科教居住、东港偏工业物流
      let blockUse: BuildingProps['buildingType'] = '住宅'
      if (industry) blockUse = '工业'
      else if (dense && coreDist < 1100) blockUse = '商业'
      if (dense) {
        const r = rnd()
        if (coreDist >= 1100) {
          if (r < 0.2) blockUse = '商业'
          else if (r < 0.26) blockUse = '公共'
          else if (r < 0.28) blockUse = '医院'
        } else if (r > 0.9) {
          blockUse = '公共'
        }
      } else if (edu) {
        const r = rnd()
        if (r < 0.12) blockUse = '学校'
        else if (r < 0.17) blockUse = '公共'
        else if (r < 0.21) blockUse = '商业'
      } else if (industry) {
        const r = rnd()
        if (r > 0.8) blockUse = r > 0.88 ? '住宅' : '公共'
      }

      // 公共/学校/医院独立占地，单栋居中，四周留出场地
      if (blockUse === '学校' || blockUse === '医院' || blockUse === '公共') {
        const lon = bcx
        const lat = bcy
        if (
          lon < west + 0.002 ||
          lon > east - 0.002 ||
          lat < south + 0.002 ||
          lat > north - 0.002
        )
          continue
        const riverDist = Math.min(...RIVER.map((p) => distanceMeters([lon, lat], p)))
        if (riverDist < 170) continue
        let w = 130
        let d = 95
        if (blockUse === '学校') {
          w = Math.min(wM * 0.66, 170)
          d = Math.min(dM * 0.6, 120)
        } else if (blockUse === '医院') {
          w = Math.min(wM * 0.6, 140)
          d = Math.min(dM * 0.55, 100)
        } else {
          w = Math.min(wM * 0.5, 110)
          d = Math.min(dM * 0.45, 80)
        }
        w = Math.max(w, 60)
        d = Math.max(d, 40)
        const floors =
          blockUse === '医院'
            ? 9 + Math.floor(rnd() * 5) + (dense ? 3 : 0)
            : blockUse === '学校'
              ? 3 + Math.floor(rnd() * 3)
              : 4 + Math.floor(rnd() * 5)
        placements.push({ lon, lat, wM: w, dM: d, rot: 0, type: blockUse, floors })
        continue
      }

      // 街块肌理按区位与功能分策略：核心塔楼＋广场、居住围合院落、科教条形板楼、工业大跨度厂房
      const densityNoise = 0.5 + 0.5 * valueNoise(bcx * 120 + 13, bcy * 120 + 7, 91)
      const blockRot = (rnd() - 0.5) * 6 // 同一街区朝向一致，街区之间轻微错动
      const boost = coreDist < 800 ? 8 : coreDist < 1500 ? 4 : 0
      const resFloors = (dense ? 6 + Math.floor(rnd() * 10) : 4 + Math.floor(rnd() * 5)) + boost

      const add = (
        lon: number,
        lat: number,
        w: number,
        d: number,
        rot: number,
        type: BuildingProps['buildingType'],
        floors: number,
      ) => {
        if (
          lon < west + 0.002 ||
          lon > east - 0.002 ||
          lat < south + 0.002 ||
          lat > north - 0.002
        )
          return
        if (parkRings.some((r) => pointInRing([lon, lat], r))) return
        const bdz = districtAt(lon, lat)
        if (!bdz || bdz === '北岭生态屏障' || bdz === '南塘湿地滞洪区') return
        if (Math.min(...RIVER.map((p) => distanceMeters([lon, lat], p))) < 160) return
        if (w < 14 || d < 12) return
        placements.push({ lon, lat, wM: w, dM: d, rot, type, floors })
      }

      // 把主路围合出的大街块再切成 300 m 级地块，接近真实用地与院落尺度
      const lotNx = Math.max(1, Math.round(wM / 300))
      const lotNy = Math.max(1, Math.round(dM / 260))
      const stepX = (x1 - x0) / lotNx
      const stepY = (y1 - y0) / lotNy

      for (let lx = 0; lx < lotNx; lx++) {
        for (let ly = 0; ly < lotNy; ly++) {
          const ax = x0 + stepX * lx
          const ay = y0 + stepY * ly
          const bx = ax + stepX
          const by = ay + stepY
          const lcx = (ax + bx) / 2
          const lcy = (ay + by) / 2
          const lw = (bx - ax) * mPerLon
          const ld = (by - ay) * mPerLat
          if (lw < 42 || ld < 42) continue
          const local = 0.5 + 0.5 * valueNoise(lcx * 260 + 5, lcy * 260 + 9, 37)
          const lotDensity = 0.5 * local + 0.5 * densityNoise
          if (rnd() < 0.2 + (1 - lotDensity) * 0.2) continue // 地块留白：绿地、广场、院落

          if (industry) {
            // 工业地块：1–2 栋大跨度厂房，四周留出装卸与堆场
            const n = ld > 200 ? 2 : 1
            for (let rj = 0; rj < n; rj++) {
              if (rnd() < 0.16) continue
              const lat = ay + (by - ay) * ((rj + 0.5) / n) + (rnd() - 0.5) * (by - ay) * 0.05
              const lon = lcx + (rnd() - 0.5) * (bx - ax) * 0.06
              const w = Math.min(115 + rnd() * 65, lw * 0.82)
              const d = Math.min(60 + rnd() * 34, (ld * 0.66) / n)
              add(lon, lat, w, d, blockRot, '工业', 1 + Math.floor(rnd() * 3))
            }
          } else if (dense && coreDist < 1200) {
            // 主城核心地块：1–3 栋点式塔楼，楼间留出广场与步行空间
            const n = 1 + Math.floor(rnd() * 3)
            for (let k = 0; k < n; k++) {
              if (rnd() < 0.16 + (1 - lotDensity) * 0.2) continue
              const lon = ax + (bx - ax) * (0.2 + rnd() * 0.6)
              const lat = ay + (by - ay) * (0.2 + rnd() * 0.6)
              const w = Math.min(34 + rnd() * 28, lw * 0.5)
              const d = Math.min(26 + rnd() * 20, ld * 0.5)
              add(lon, lat, w, d, blockRot, '商业', 12 + Math.floor(rnd() * 16) + boost)
            }
          } else if (blockUse === '住宅' && lw > 110 && ld > 100 && rnd() < 0.72) {
            // 居住地块：沿四边围合，内部留出院落；个别边留缺口作为出入口
            const ix0 = ax + 14 / mPerLon
            const ix1 = bx - 14 / mPerLon
            const iy0 = ay + 14 / mPerLat
            const iy1 = by - 14 / mPerLat
            const Lx = Math.max(0, (ix1 - ix0) * mPerLon)
            const Ly = Math.max(0, (iy1 - iy0) * mPerLat)
            if (Lx < 40 || Ly < 40) continue
            const edgeH = (yEdge: number, dir: number) => {
              if (rnd() < 0.28) return
              const n = Math.max(1, Math.min(3, Math.round(Lx / 110)))
              const gapM = 9 + rnd() * 12
              const segLen = (Lx - gapM * (n - 1)) / n
              for (let k = 0; k < n; k++) {
                const w = Math.min(segLen, 78)
                const d = 13 + rnd() * 6
                const lon =
                  ix0 + (segLen * (k + 0.5) + gapM * k) / mPerLon + (rnd() - 0.5) * 0.00004
                add(lon, yEdge + (dir * d) / 2 / mPerLat, w, d, blockRot, '住宅', resFloors)
              }
            }
            const edgeV = (xEdge: number, dir: number) => {
              if (rnd() < 0.28) return
              const n = Math.max(1, Math.min(3, Math.round(Ly / 110)))
              const gapM = 9 + rnd() * 12
              const segLen = (Ly - gapM * (n - 1)) / n
              for (let k = 0; k < n; k++) {
                const w = Math.min(segLen, 78)
                const d = 13 + rnd() * 6
                const lat =
                  iy0 + (segLen * (k + 0.5) + gapM * k) / mPerLat + (rnd() - 0.5) * 0.00004
                add(xEdge + (dir * d) / 2 / mPerLon, lat, w, d, 90 + blockRot, '住宅', resFloors)
              }
            }
            edgeH(iy1, -1)
            edgeH(iy0, 1)
            edgeV(ix1, -1)
            edgeV(ix0, 1)
          } else {
            // 条形板楼行列式：沿地块长边成排，排距留出日照通道
            const alongEW = lw >= ld
            const Lm = alongEW ? lw : ld
            const Dm = alongEW ? ld : lw
            const rowsN = Math.max(1, Math.min(3, Math.round(Dm / 85)))
            const segN = Math.max(1, Math.min(3, Math.round(Lm / 120)))
            const segLen = (Lm * 0.86) / segN
            for (let rj = 0; rj < rowsN; rj++) {
              for (let ci = 0; ci < segN; ci++) {
                if (rnd() < 0.12 + (1 - lotDensity) * 0.18) continue
                const crossM = -Dm / 2 + (Dm * (rj + 0.5)) / rowsN + (rnd() - 0.5) * 8
                const alongM = -Lm / 2 + (Lm * (ci + 0.5)) / segN + (rnd() - 0.5) * 10
                const w = Math.min(segLen * (0.52 + rnd() * 0.34), blockUse === '商业' ? 115 : 96)
                const d = blockUse === '商业' ? 20 + rnd() * 12 : 14 + rnd() * 7
                const lon = alongEW ? lcx + alongM / mPerLon : lcx + crossM / mPerLon
                const lat = alongEW ? lcy + crossM / mPerLat : lcy + alongM / mPerLat
                const floors = blockUse === '商业' ? 10 + Math.floor(rnd() * 16) + boost : resFloors
                add(lon, lat, w, d, alongEW ? blockRot : 90 + blockRot, blockUse, floors)
              }
            }
          }
        }
      }
    }
  }

  // 中部高地布置医院、应急指挥中心与变电站，替换场内原有街块建筑
  const kept = placements.filter((p) =>
    KEY_FACILITIES.every((f) => distanceMeters([p.lon, p.lat], [f.lon, f.lat]) > 250),
  )
  placements.length = 0
  placements.push(...kept)
  for (const f of KEY_FACILITIES) {
    placements.push({
      lon: f.lon,
      lat: f.lat,
      wM: f.wM,
      dM: f.dM,
      rot: 0,
      type: f.type,
      floors: f.floors,
      name: f.name,
      shape: f.shape,
    })
  }

  for (const p of placements) {
    const { lon, lat, wM, dM, rot, type, floors } = p
    const shapePool = SHAPE_POOLS[type] ?? ['rect' as BuildingShape]
    const shape = p.shape ?? shapePool[Math.floor(rnd() * shapePool.length)]
    const ring = shapeBuilding(lon, lat, wM, dM, rot, shape)
    const poly = polygon([ring])
    const c = centroid(poly)
    const a = turfArea(poly)
    const cLon = c.geometry.coordinates[0]
    const cLat = c.geometry.coordinates[1]

    let name = p.name ?? ''
    if (!name && type === '住宅') {
      const estateIdx = nameCounter.estateIdx ?? 0
      nameCounter.estateIdx = estateIdx + 1
      const estate = RESIDENTIAL_NAMES[estateIdx % RESIDENTIAL_NAMES.length]
      const bKey = `est_${estateIdx % RESIDENTIAL_NAMES.length}`
      const bIdx = (nameCounter[bKey] ?? 0) + 1
      nameCounter[bKey] = bIdx
      name = `${estate} ${bIdx} 号楼`
    } else if (!name) {
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
      district: districtAt(cLon, cLat) ?? roadDistrict(cLon, cLat, districtCenters),
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
    parks: featureCollection(parks),
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


