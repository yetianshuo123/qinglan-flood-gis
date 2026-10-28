import type { BBox, Grid, LonLat, TerrainGrid } from './types'
import {
  createGrid,
  gaussian,
  pointToLineDistanceMeters,
  refreshGridStats,
} from './grid'
import { fbm } from './rng'

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export interface Depression {
  lon: number
  lat: number
  rx: number
  ry: number
  rot: number
  amp: number
}

export interface TerrainInput {
  bounds: BBox
  cols: number
  rows: number
  riverCoords: LonLat[]
  canalCoords: LonLat[][]
  pumpCoords: LonLat[]
  depressions: Depression[]
}

export const RAIN_STORM = { lon: 120.061, lat: 30.04, sigmaLon: 0.03, sigmaLat: 0.022 }

export function buildTerrain(input: TerrainInput): {
  terrain: TerrainGrid
  rainPattern: Float64Array
} {
  const { bounds, cols, rows, riverCoords, canalCoords, pumpCoords, depressions } = input
  const [west, south, east, north] = bounds
  const dem: Grid = createGrid(cols, rows, bounds, 'm')
  const slope = new Float64Array(cols * rows)
  const urbanity = new Float64Array(cols * rows)
  const riverDistM = new Float64Array(cols * rows)
  const drainDistM = new Float64Array(cols * rows)
  const pumpDistM = new Float64Array(cols * rows)
  const infilRate = new Float64Array(cols * rows)
  const runoffCoef = new Float64Array(cols * rows)
  const rainPattern = new Float64Array(cols * rows)
  const susceptibility = new Float64Array(cols * rows)

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col
      const lon = west + ((col + 0.5) / cols) * (east - west)
      const lat = north - ((row + 0.5) / rows) * (north - south)
      const nx = (lon - west) / (east - west)
      const ny = (lat - south) / (north - south)

      let e = 9.5 + 8.5 * ny - 4.2 * nx
      e += (fbm(lon * 1300, lat * 1300, 3) - 0.5) * 5.4
      e += 21 * gaussian(lon, lat, 120.019, 30.068, 0.02, 0.015)
      e += 12 * gaussian(lon, lat, 120.091, 30.072, 0.016, 0.013)
      e += 6 * gaussian(lon, lat, 120.004, 30.025, 0.012, 0.014)

      for (const d of depressions) {
        e -= d.amp * gaussian(lon, lat, d.lon, d.lat, d.rx, d.ry, d.rot)
      }

      const riverD = pointToLineDistanceMeters(lon, lat, riverCoords)
      riverDistM[i] = riverD
      e -= 9.5 * Math.exp(-(riverD * riverD) / (2 * 300 * 300))
      e -= 3.2 * Math.exp(-(riverD * riverD) / (2 * 1200 * 1200))

      let drainD = Infinity
      for (const canal of canalCoords) {
        drainD = Math.min(drainD, pointToLineDistanceMeters(lon, lat, canal))
      }
      drainDistM[i] = drainD
      let pumpD = Infinity
      for (const p of pumpCoords) {
        pumpD = Math.min(pumpD, Math.hypot((lon - p[0]) * 96000, (lat - p[1]) * 111132))
      }
      pumpDistM[i] = pumpD

      dem.values[i] = Math.max(1.8, e)

      const u = Math.max(
        0.05,
        Math.min(
          0.95,
          0.08 +
            0.78 * gaussian(lon, lat, 120.057, 30.036, 0.03, 0.024) +
            0.24 * gaussian(lon, lat, 120.026, 30.055, 0.016, 0.012) +
            (fbm(lon * 700, lat * 700, 11) - 0.5) * 0.1,
        ),
      )
      urbanity[i] = u
      infilRate[i] = 2.8 + 13.5 * (1 - u)
      runoffCoef[i] = 0.5 + 0.44 * u

      const g = gaussian(lon, lat, RAIN_STORM.lon, RAIN_STORM.lat, RAIN_STORM.sigmaLon, RAIN_STORM.sigmaLat)
      const g2 = gaussian(lon, lat, 120.024, 30.055, 0.018, 0.014)
      rainPattern[i] = 0.72 + 0.36 * g + 0.12 * g2 + (fbm(lon * 900, lat * 900, 19) - 0.5) * 0.12
    }
  }
  refreshGridStats(dem)

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col
      const lat = north - ((row + 0.5) / rows) * (north - south)
      const w = ((east - west) / cols) * 111320 * Math.cos((lat * Math.PI) / 180)
      const h = ((north - south) / rows) * 111132
      const left = dem.values[row * cols + Math.max(0, col - 1)]
      const right = dem.values[row * cols + Math.min(cols - 1, col + 1)]
      const up = dem.values[Math.max(0, row - 1) * cols + col]
      const down = dem.values[Math.min(rows - 1, row + 1) * cols + col]
      slope[i] = Math.hypot((right - left) / (2 * w), (down - up) / (2 * h))
    }
  }

  // D8 汇流（原始地形），用于刻画地形汇流集中程度
  const flowAccum = new Float64Array(cols * rows).fill(1)
  const downstream = new Int32Array(cols * rows).fill(-1)
  const order = Array.from({ length: cols * rows }, (_, i) => i)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col
      let best = dem.values[i]
      let bestJ = -1
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          const rr = row + dr
          const cc = col + dc
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue
          const j = rr * cols + cc
          if (dem.values[j] < best) {
            best = dem.values[j]
            bestJ = j
          }
        }
      }
      downstream[i] = bestJ
    }
  }
  order.sort((a, b) => dem.values[b] - dem.values[a])
  for (const i of order) {
    const d = downstream[i]
    if (d >= 0) flowAccum[d] += flowAccum[i]
  }

  // 地形易涝度：局部低洼 + 平坦 + 汇流集中 + 洼地范围 - 河道/渠道排水折减
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col
      const lon = west + ((col + 0.5) / cols) * (east - west)
      const lat = north - ((row + 0.5) / rows) * (north - south)
      const elev = dem.values[i]

      let sum5 = 0
      let sum15 = 0
      let c5 = 0
      let c15 = 0
      for (let dr = -7; dr <= 7; dr++) {
        const rr = row + dr
        if (rr < 0 || rr >= rows) continue
        for (let dc = -7; dc <= 7; dc++) {
          const cc = col + dc
          if (cc < 0 || cc >= cols) continue
          const v = dem.values[rr * cols + cc]
          sum15 += v
          c15++
          if (Math.abs(dr) <= 2 && Math.abs(dc) <= 2) {
            sum5 += v
            c5++
          }
        }
      }
      const mean5 = sum5 / c5
      const mean15 = sum15 / c15
      const lowIndex = clamp(
        Math.max((mean5 - elev) / 2.2, (mean15 - elev) / 4.5),
        0,
        1,
      )
      const flat = clamp(1 - slope[i] / 0.035, 0, 1)
      const accNorm = clamp(
        (Math.log1p(flowAccum[i]) - Math.log1p(10)) /
          (Math.log1p(120) - Math.log1p(10)),
        0,
        1,
      )
      let lowlandF = 0
      for (const d of depressions) {
        lowlandF = Math.max(
          lowlandF,
          gaussian(lon, lat, d.lon, d.lat, d.rx, d.ry, d.rot),
        )
      }
      const riverPen = 0.4 * Math.exp(-((riverDistM[i] * riverDistM[i]) / (2 * 300 * 300)))
      const canalPen = Number.isFinite(drainDistM[i])
        ? 0.15 * Math.exp(-((drainDistM[i] * drainDistM[i]) / (2 * 220 * 220)))
        : 0
      let s =
        0.46 * lowIndex +
        0.24 * flat +
        0.18 * accNorm +
        0.2 * lowlandF -
        riverPen -
        canalPen
      s = clamp(s, 0, 1)
      susceptibility[i] = Math.pow(clamp((s - 0.03) / 0.62, 0, 1), 1.35)
    }
  }

  return {
    terrain: {
      dem,
      slope,
      urbanity,
      riverDistM,
      drainDistM,
      pumpDistM,
      infilRate,
      runoffCoef,
      susceptibility,
      flowAccum,
    },
    rainPattern,
  }
}
