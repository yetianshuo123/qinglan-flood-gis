import type { Geometry } from 'geojson'

export type LayerId =
  | 'terrain'
  | 'rainfall'
  | 'water'
  | 'parks'
  | 'roads'
  | 'buildings'
  | 'lowland'
  | 'depth'
  | 'risk'
  | 'districts'

export type Tool =
  | 'select'
  | 'measure-distance'
  | 'measure-area'
  | 'query-polygon'
  | 'query-point'

export type PanelMode = 'open' | 'collapsed' | 'closed'

export interface LayerMeta {
  id: LayerId
  name: string
  group: string
  kind: '栅格' | '矢量'
  info: string
  defaultVisible: boolean
  defaultOpacity: number
}

export interface LayerState {
  visible: boolean
  opacity: number
}

export type LayerStates = Record<LayerId, LayerState>

export const LAYER_GROUPS = [
  '底图与边界',
  '地形与降雨',
  '水系与排水',
  '城市设施',
  '内涝专题',
] as const

export const LAYER_META: LayerMeta[] = [
  {
    id: 'districts',
    name: '行政分区',
    group: '底图与边界',
    kind: '矢量',
    info: '5 个功能分区 · 边界与标注',
    defaultVisible: true,
    defaultOpacity: 1,
  },
  {
    id: 'terrain',
    name: '地形高程',
    group: '地形与降雨',
    kind: '栅格',
    info: '168×90 网格 · 丘陵—主城—湿地',
    defaultVisible: true,
    defaultOpacity: 1,
  },
  {
    id: 'rainfall',
    name: '降雨分布',
    group: '地形与降雨',
    kind: '栅格',
    info: '空间降雨系数 · 随情景重算',
    defaultVisible: false,
    defaultOpacity: 0.65,
  },
  {
    id: 'water',
    name: '河流与排水设施',
    group: '水系与排水',
    kind: '矢量',
    info: '1 条河道 · 4 条排水渠 · 4 座泵站',
    defaultVisible: true,
    defaultOpacity: 1,
  },
  {
    id: 'parks',
    name: '生态绿地',
    group: '城市设施',
    kind: '矢量',
    info: '森林公园 · 湿地公园 · 滨江缓冲带',
    defaultVisible: true,
    defaultOpacity: 1,
  },
  {
    id: 'roads',
    name: '道路网络',
    group: '城市设施',
    kind: '矢量',
    info: '三横三纵一环 · 含等级与长度',
    defaultVisible: true,
    defaultOpacity: 1,
  },
  {
    id: 'buildings',
    name: '建筑物',
    group: '城市设施',
    kind: '矢量',
    info: '215 栋建筑 · 含类型与高程',
    defaultVisible: true,
    defaultOpacity: 1,
  },
  {
    id: 'lowland',
    name: '低洼区域',
    group: '内涝专题',
    kind: '矢量',
    info: '4 处洼地 · 含滞蓄属性',
    defaultVisible: true,
    defaultOpacity: 1,
  },
  {
    id: 'depth',
    name: '积水深度',
    group: '内涝专题',
    kind: '栅格',
    info: '模型输出 · 4 级深度分带',
    defaultVisible: true,
    defaultOpacity: 0.85,
  },
  {
    id: 'risk',
    name: '内涝风险',
    group: '内涝专题',
    kind: '栅格',
    info: '模型输出 · 低/中/高/极高',
    defaultVisible: true,
    defaultOpacity: 0.55,
  },
]

export function makeDefaultLayerStates(): LayerStates {
  return LAYER_META.reduce((acc, m) => {
    acc[m.id] = { visible: m.defaultVisible, opacity: m.defaultOpacity }
    return acc
  }, {} as LayerStates)
}

export interface CursorInfo {
  lon: number
  lat: number
  elevation: number
  depth: number
  risk: number
  rain: number
}

export interface SelectionInfo {
  kind: string
  id: string
  props: Record<string, unknown>
  geometry: Geometry
}
