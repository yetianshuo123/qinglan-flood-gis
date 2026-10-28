import type { Grid, ModelResult, TerrainGrid } from './types'

const TERRAIN_STOPS: [number, [number, number, number]][] = [
  [0, [233, 229, 212]],
  [0.18, [223, 226, 204]],
  [0.38, [207, 217, 182]],
  [0.58, [183, 203, 161]],
  [0.78, [150, 179, 137]],
  [1, [118, 150, 111]],
]

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function rampColor(t: number, stops: [number, [number, number, number]][]): [number, number, number] {
  const v = Math.max(0, Math.min(1, t))
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i]
    const [p1, c1] = stops[i + 1]
    if (v <= p1) {
      const f = (v - p0) / (p1 - p0 || 1)
      return [
        Math.round(lerp(c0[0], c1[0], f)),
        Math.round(lerp(c0[1], c1[1], f)),
        Math.round(lerp(c0[2], c1[2], f)),
      ]
    }
  }
  return stops[stops.length - 1][1]
}

function makeCanvas(cols: number, rows: number, scale: number) {
  const canvas = document.createElement('canvas')
  canvas.width = cols * scale
  canvas.height = rows * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  return { canvas, ctx, w: canvas.width, h: canvas.height }
}

function bilinear(grid: Grid, gx: number, gy: number): number {
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const fx = gx - x0
  const fy = gy - y0
  const at = (r: number, c: number) =>
    grid.values[
      Math.max(0, Math.min(grid.rows - 1, r)) * grid.cols +
        Math.max(0, Math.min(grid.cols - 1, c))
    ]
  return (
    at(y0, x0) * (1 - fx) * (1 - fy) +
    at(y0, x0 + 1) * fx * (1 - fy) +
    at(y0 + 1, x0) * (1 - fx) * fy +
    at(y0 + 1, x0 + 1) * fx * fy
  )
}

export function createTerrainDataUrl(terrain: TerrainGrid): string {
  const grid = terrain.dem
  const scale = 6
  const { canvas, ctx, w, h } = makeCanvas(grid.cols, grid.rows, scale)
  const img = ctx.createImageData(w, h)
  const range = grid.max - grid.min || 1
  const lat = (grid.south + grid.north) / 2
  const cellW =
    ((grid.east - grid.west) / grid.cols) * 111320 * Math.cos((lat * Math.PI) / 180)
  const cellH = ((grid.north - grid.south) / grid.rows) * 111132
  const zenith = (45 * Math.PI) / 180
  const azSun = (315 * Math.PI) / 180

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = (x / (w - 1)) * (grid.cols - 1)
      const gy = (y / (h - 1)) * (grid.rows - 1)
      const e = bilinear(grid, gx, gy)
      const dx = (bilinear(grid, gx + 0.5, gy) - bilinear(grid, gx - 0.5, gy)) / cellW
      const dy = (bilinear(grid, gx, gy + 0.5) - bilinear(grid, gx, gy - 0.5)) / cellH
      const slope = Math.atan(Math.hypot(dx, dy))
      const aspect = Math.atan2(-dx, dy)
      const hs =
        Math.cos(zenith) * Math.cos(slope) +
        Math.sin(zenith) * Math.sin(slope) * Math.cos(azSun - aspect)
      const shade = Math.max(0.55, Math.min(1.28, 0.72 + hs * 0.55))
      const [r, g, b] = rampColor((e - grid.min) / range, TERRAIN_STOPS)
      const idx = (y * w + x) * 4
      img.data[idx] = Math.min(255, Math.round(r * shade))
      img.data[idx + 1] = Math.min(255, Math.round(g * shade))
      img.data[idx + 2] = Math.min(255, Math.round(b * shade))
      img.data[idx + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

export function rainRange(rain: Grid): { min: number; max: number } {
  return { min: rain.min, max: rain.max }
}

export function createRainDataUrl(rain: Grid): string {
  const scale = 4
  const { canvas, ctx, w, h } = makeCanvas(rain.cols, rain.rows, scale)
  const img = ctx.createImageData(w, h)
  const span = rain.max - rain.min || 1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = (x / (w - 1)) * (rain.cols - 1)
      const gy = (y / (h - 1)) * (rain.rows - 1)
      const t = (bilinear(rain, gx, gy) - rain.min) / span
      const r = Math.round(lerp(176, 40, t))
      const g = Math.round(lerp(215, 96, t))
      const b = Math.round(lerp(238, 178, t))
      const a = Math.round(lerp(28, 150, t))
      const idx = (y * w + x) * 4
      img.data[idx] = r
      img.data[idx + 1] = g
      img.data[idx + 2] = b
      img.data[idx + 3] = a
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

export const DEPTH_CLASSES = [
  { min: 0.03, max: 0.08, label: '3–8 cm', color: 'rgba(129,205,235,0.5)', rgb: [129, 205, 235, 128] },
  { min: 0.08, max: 0.18, label: '8–18 cm', color: 'rgba(64,149,213,0.62)', rgb: [64, 149, 213, 158] },
  { min: 0.18, max: 0.35, label: '18–35 cm', color: 'rgba(23,96,176,0.72)', rgb: [23, 96, 176, 184] },
  { min: 0.35, max: 99, label: '≥35 cm', color: 'rgba(7,45,108,0.84)', rgb: [7, 45, 108, 214] },
]

export function createDepthDataUrl(depth: Grid): string {
  const scale = 4
  const { canvas, ctx, w, h } = makeCanvas(depth.cols, depth.rows, scale)
  const img = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    const row = Math.min(depth.rows - 1, Math.floor((y / h) * depth.rows))
    for (let x = 0; x < w; x++) {
      const col = Math.min(depth.cols - 1, Math.floor((x / w) * depth.cols))
      const d = depth.values[row * depth.cols + col]
      const idx = (y * w + x) * 4
      if (d < DEPTH_CLASSES[0].min) {
        img.data[idx + 3] = 0
        continue
      }
      const c =
        d < 0.08 ? DEPTH_CLASSES[0] : d < 0.18 ? DEPTH_CLASSES[1] : d < 0.35 ? DEPTH_CLASSES[2] : DEPTH_CLASSES[3]
      img.data[idx] = c.rgb[0]
      img.data[idx + 1] = c.rgb[1]
      img.data[idx + 2] = c.rgb[2]
      img.data[idx + 3] = c.rgb[3]
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

export const RISK_RAMP = [
  { level: 0, label: '无风险', color: 'transparent' },
  { level: 1, label: '低风险 (3–8 cm)', color: '#f2d15c' },
  { level: 2, label: '中风险 (8–18 cm)', color: '#ee9f4a' },
  { level: 3, label: '高风险 (18–35 cm)', color: '#df5a39' },
  { level: 4, label: '极高风险 (≥35 cm)', color: '#9f1b2d' },
]

const RISK_RGB: [number, number, number, number][] = [
  [0, 0, 0, 0],
  [242, 209, 92, 145],
  [238, 159, 74, 160],
  [223, 90, 57, 175],
  [159, 27, 45, 195],
]

export function createRiskDataUrl(risk: Uint8Array, cols: number, rows: number): string {
  const scale = 4
  const { canvas, ctx, w, h } = makeCanvas(cols, rows, scale)
  const img = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    const row = Math.min(rows - 1, Math.floor((y / h) * rows))
    for (let x = 0; x < w; x++) {
      const col = Math.min(cols - 1, Math.floor((x / w) * cols))
      const level = risk[row * cols + col]
      const c = RISK_RGB[level]
      const idx = (y * w + x) * 4
      img.data[idx] = c[0]
      img.data[idx + 1] = c[1]
      img.data[idx + 2] = c[2]
      img.data[idx + 3] = c[3]
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

export type DiffMode = 'depth' | 'risk'

export function createDiffDataUrl(
  current: ModelResult,
  baseline: ModelResult,
  mode: DiffMode,
): string {
  const grid = current.depth
  const scale = 4
  const { canvas, ctx, w, h } = makeCanvas(grid.cols, grid.rows, scale)
  const img = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    const row = Math.min(grid.rows - 1, Math.floor((y / h) * grid.rows))
    for (let x = 0; x < w; x++) {
      const col = Math.min(grid.cols - 1, Math.floor((x / w) * grid.cols))
      const i = row * grid.cols + col
      const idx = (y * w + x) * 4
      if (mode === 'depth') {
        const delta = grid.values[i] - baseline.depth.values[i]
        if (delta > 0.01) {
          img.data[idx] = 190
          img.data[idx + 1] = 52
          img.data[idx + 2] = 40
          img.data[idx + 3] = Math.min(215, 60 + Math.round(delta * 420))
        } else if (delta < -0.01) {
          img.data[idx] = 32
          img.data[idx + 1] = 108
          img.data[idx + 2] = 146
          img.data[idx + 3] = Math.min(215, 60 + Math.round(-delta * 420))
        }
      } else {
        const delta = current.risk[i] - baseline.risk[i]
        if (delta >= 1) {
          const strong = delta >= 2
          img.data[idx] = strong ? 150 : 223
          img.data[idx + 1] = strong ? 18 : 90
          img.data[idx + 2] = strong ? 42 : 57
          img.data[idx + 3] = strong ? 205 : 170
        } else if (delta <= -1) {
          img.data[idx] = 24
          img.data[idx + 1] = 132
          img.data[idx + 2] = 124
          img.data[idx + 3] = 160
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}
