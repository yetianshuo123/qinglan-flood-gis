import {
  Circle as CircleStyle,
  Fill,
  RegularShape,
  Stroke,
  Style,
  Text,
} from 'ol/style'
import type { FeatureLike } from 'ol/Feature'

const FONT = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'

export const BUILDING_COLORS: Record<string, string> = {
  住宅: '#8fa7c2',
  商业: '#cfa75d',
  公共: '#7fb3a2',
  学校: '#819fd6',
  医院: '#cd8b8b',
  工业: '#a294b8',
}

export const BUILDING_TYPES = ['住宅', '商业', '公共', '学校', '医院', '工业']

export const ROAD_CLASS_STYLE = {
  主干道: { color: '#f1e7d3', casing: 'rgba(6, 11, 16, 0.8)', width: 3.6 },
  次干道: { color: '#c4d1d8', casing: 'rgba(6, 11, 16, 0.7)', width: 2.5 },
  支路: { color: '#96a7b4', casing: 'rgba(6, 11, 16, 0.58)', width: 1.6 },
} as const

export type RoadClassKey = keyof typeof ROAD_CLASS_STYLE

const LABEL_HALO = 'rgba(5, 10, 14, 0.92)'

const LOWLAND_FILL = new Fill({ color: 'rgba(224, 155, 70, 0.14)' })
const LOWLAND_STROKE = new Stroke({
  color: 'rgba(240, 178, 90, 0.9)',
  width: 1.6,
  lineDash: [8, 5],
})

export function lowlandStyle(feature: FeatureLike, resolution: number): Style[] {
  const styles: Style[] = [
    new Style({ fill: LOWLAND_FILL, stroke: LOWLAND_STROKE }),
  ]
  if (resolution < 6) {
    styles.push(
      new Style({
        text: new Text({
          text: String(feature.get('name') ?? ''),
          font: `600 11px ${FONT}`,
          fill: new Fill({ color: '#f6c98a' }),
          stroke: new Stroke({ color: LABEL_HALO, width: 3 }),
          offsetY: -2,
        }),
      }),
    )
  }
  return styles
}

export const PARK_COLORS: Record<string, { fill: string; stroke: string; label: string }> = {
  森林公园: {
    fill: 'rgba(84, 118, 76, 0.34)',
    stroke: 'rgba(126, 168, 116, 0.55)',
    label: '#d3e8c6',
  },
  湿地公园: {
    fill: 'rgba(52, 126, 160, 0.26)',
    stroke: 'rgba(96, 172, 210, 0.5)',
    label: '#bfe6f2',
  },
  滨江生态缓冲带: {
    fill: 'rgba(96, 138, 100, 0.22)',
    stroke: 'rgba(132, 174, 120, 0.45)',
    label: '#cfe6c2',
  },
  城市公园: {
    fill: 'rgba(92, 132, 84, 0.28)',
    stroke: 'rgba(128, 170, 112, 0.5)',
    label: '#d5e9c8',
  },
}

export function parkStyle(feature: FeatureLike, resolution: number): Style[] {
  const parkType = String(feature.get('parkType') ?? '城市公园')
  const cfg = PARK_COLORS[parkType] ?? PARK_COLORS['城市公园']
  const styles: Style[] = [
    new Style({
      fill: new Fill({ color: cfg.fill }),
      stroke: new Stroke({ color: cfg.stroke, width: 1, lineDash: [7, 5] }),
    }),
  ]
  if (resolution < 18) {
    styles.push(
      new Style({
        text: new Text({
          text: String(feature.get('name') ?? ''),
          font: `600 10.5px ${FONT}`,
          fill: new Fill({ color: cfg.label }),
          stroke: new Stroke({ color: LABEL_HALO, width: 3 }),
        }),
      }),
    )
  }
  return styles
}

export function districtStyle(feature: FeatureLike, resolution: number): Style {
  const style = new Style({
    fill: new Fill({ color: 'rgba(255, 255, 255, 0.015)' }),
    stroke: new Stroke({
      color: 'rgba(150, 176, 192, 0.42)',
      width: 1.3,
      lineDash: [9, 7],
    }),
  })
  if (resolution < 40) {
    style.setText(
      new Text({
        text: String(feature.get('name') ?? ''),
        font: `600 13px ${FONT}`,
        fill: new Fill({ color: 'rgba(219, 232, 240, 0.88)' }),
        stroke: new Stroke({ color: LABEL_HALO, width: 3.5 }),
        textAlign: 'center',
        padding: [2, 4, 2, 4],
      }),
    )
  }
  return style
}

const buildingStyleCache = new globalThis.Map<string, Style>()

export function buildingStyle(feature: FeatureLike): Style {
  const type = String(feature.get('buildingType') ?? '住宅')
  const key = BUILDING_COLORS[type] ? type : '住宅'
  const cached = buildingStyleCache.get(key)
  if (cached) return cached
  const style = new Style({
    fill: new Fill({ color: BUILDING_COLORS[key] }),
    stroke: new Stroke({ color: 'rgba(8, 14, 20, 0.75)', width: 0.7 }),
  })
  buildingStyleCache.set(key, style)
  return style
}

export function roadStyle(feature: FeatureLike, resolution: number): Style[] {
  const cls = String(feature.get('roadClass') ?? '支路') as RoadClassKey
  const cfg = ROAD_CLASS_STYLE[cls] ?? ROAD_CLASS_STYLE['支路']
  const styles: Style[] = [
    new Style({
      stroke: new Stroke({
        color: cfg.casing,
        width: cfg.width + 1.9,
        lineCap: 'round',
        lineJoin: 'round',
      }),
    }),
    new Style({
      stroke: new Stroke({
        color: cfg.color,
        width: cfg.width,
        lineCap: 'round',
        lineJoin: 'round',
      }),
    }),
  ]
  if (resolution < 5.5) {
    styles.push(
      new Style({
        text: new Text({
          text: String(feature.get('name') ?? ''),
          font: `500 10.5px ${FONT}`,
          placement: 'line',
          fill: new Fill({ color: '#eef4f8' }),
          stroke: new Stroke({ color: LABEL_HALO, width: 3 }),
          overflow: true,
          maxAngle: 0.55,
        }),
      }),
    )
  }
  return styles
}

export function waterStyle(feature: FeatureLike, resolution: number): Style | Style[] {
  const kind = String(feature.get('kind') ?? '')
  const geomType = feature.getGeometry()?.getType()

  if (geomType === 'Point') {
    const styles: Style[] = [
      new Style({
        image: new RegularShape({
          points: 4,
          radius: 7,
          angle: Math.PI / 4,
          fill: new Fill({ color: '#0d3a49' }),
          stroke: new Stroke({ color: '#7ed6e4', width: 1.8 }),
        }),
      }),
    ]
    if (resolution < 5.5) {
      styles.push(
        new Style({
          text: new Text({
            text: String(feature.get('name') ?? ''),
            font: `500 10px ${FONT}`,
            offsetY: -14,
            fill: new Fill({ color: '#bdeaf2' }),
            stroke: new Stroke({ color: LABEL_HALO, width: 3 }),
          }),
        }),
      )
    }
    return styles
  }

  if (geomType === 'Polygon') {
    return new Style({
      fill: new Fill({ color: 'rgba(58, 139, 184, 0.28)' }),
      stroke: new Stroke({ color: 'rgba(96, 172, 210, 0.55)', width: 1 }),
    })
  }

  if (kind === 'river') {
    return new Style({
      stroke: new Stroke({
        color: 'rgba(74, 160, 201, 0.95)',
        width: 5.2,
        lineCap: 'round',
      }),
    })
  }

  return new Style({
    stroke: new Stroke({
      color: 'rgba(84, 195, 210, 0.95)',
      width: 2.1,
      lineDash: [7, 4],
      lineCap: 'round',
    }),
  })
}

export const selectionStyle = new Style({
  fill: new Fill({ color: 'rgba(56, 189, 248, 0.24)' }),
  stroke: new Stroke({ color: '#67d6ff', width: 2.4 }),
  image: new CircleStyle({
    radius: 8,
    fill: new Fill({ color: 'rgba(56, 189, 248, 0.3)' }),
    stroke: new Stroke({ color: '#67d6ff', width: 2.2 }),
  }),
})

export const queryPolygonStyle = new Style({
  fill: new Fill({ color: 'rgba(34, 211, 238, 0.10)' }),
  stroke: new Stroke({
    color: '#22d3ee',
    width: 1.8,
    lineDash: [8, 4],
  }),
})

export const measureLineStyle = new Style({
  stroke: new Stroke({
    color: '#f7c45c',
    width: 2.4,
    lineDash: [9, 5],
    lineCap: 'round',
  }),
})

export const measurePolygonStyle = new Style({
  fill: new Fill({ color: 'rgba(247, 196, 92, 0.14)' }),
  stroke: new Stroke({
    color: '#f7c45c',
    width: 2,
    lineDash: [8, 4],
  }),
})

export const focusStyle = new Style({
  image: new CircleStyle({
    radius: 10,
    fill: new Fill({ color: 'rgba(34, 211, 238, 0.18)' }),
    stroke: new Stroke({ color: '#67e8f9', width: 2.4 }),
  }),
})
