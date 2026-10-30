import type { Grid, ModelResult, TerrainGrid } from './types'

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
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

function catmullRom(v0: number, v1: number, v2: number, v3: number, t: number): number {
  return (
    0.5 *
    (2 * v1 +
      (-v0 + v2) * t +
      (2 * v0 - 5 * v1 + 4 * v2 - v3) * t * t +
      (-v0 + 3 * v1 - 3 * v2 + v3) * t * t * t)
  )
}

/** 双三次（Catmull-Rom）重采样，用于放大后的地形细节重建 */
function bicubic(grid: Grid, gx: number, gy: number): number {
  const x1 = Math.floor(gx)
  const y1 = Math.floor(gy)
  const fx = gx - x1
  const fy = gy - y1
  const at = (r: number, c: number) =>
    grid.values[
      Math.max(0, Math.min(grid.rows - 1, r)) * grid.cols +
        Math.max(0, Math.min(grid.cols - 1, c))
    ]
  const rows = [0, 1, 2, 3].map((j) =>
    catmullRom(
      at(y1 - 1 + j, x1 - 1),
      at(y1 - 1 + j, x1),
      at(y1 - 1 + j, x1 + 1),
      at(y1 - 1 + j, x1 + 2),
      fx,
    ),
  )
  return catmullRom(rows[0], rows[1], rows[2], rows[3], fy)
}

/** 对附加栅格（开发强度、河距等）做双线性采样 */
function bilinearArr(
  arr: Float64Array,
  cols: number,
  rows: number,
  gx: number,
  gy: number,
): number {
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const fx = gx - x0
  const fy = gy - y0
  const at = (r: number, c: number) =>
    arr[
      Math.max(0, Math.min(rows - 1, r)) * cols +
        Math.max(0, Math.min(cols - 1, c))
    ]
  return (
    at(y0, x0) * (1 - fx) * (1 - fy) +
    at(y0, x0 + 1) * fx * (1 - fy) +
    at(y0 + 1, x0) * (1 - fx) * fy +
    at(y0 + 1, x0 + 1) * fx * fy
  )
}

/** 适合逐像素调用的快速整数哈希噪声，返回 0..1 */
function hash2(x: number, y: number): number {
  let n = (x | 0) * 374761393 + (y | 0) * 668265263
  n = (n ^ (n >> 13)) * 1274126177
  return ((n ^ (n >> 16)) >>> 0) / 4294967295
}

const yieldToUi = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })

/** 将像素行划分为若干批次，避免一次性占用主线程造成缩放卡顿 */
function bands(h: number, count: number): [number, number][] {
  const size = Math.max(1, Math.ceil(h / count))
  const out: [number, number][] = []
  for (let y = 0; y < h; y += size) out.push([y, Math.min(h, y + size)])
  return out
}

export interface RasterLevel {
  key: string
  /** 专题栅格的像素放大倍数 */
  scale: number
  /** 地形晕渲的像素放大倍数 */
  terrainScale: number
  /** 地形高程是否使用双三次重采样 */
  bicubic: boolean
  /** 连续积水场是否先插值再分级 */
  smoothDepth: boolean
}

/** 按缩放级别选择重采样级别（细节层次） */
export function rasterLevelFor(zoom: number): RasterLevel {
  if (zoom >= 16.2) {
    return { key: 'L3', scale: 10, terrainScale: 12, bicubic: true, smoothDepth: true }
  }
  if (zoom >= 14.2) {
    return { key: 'L2', scale: 8, terrainScale: 10, bicubic: true, smoothDepth: true }
  }
  // L1（全局视图）：提高 scale 并开启 smoothDepth，消除方块感，
  // 让积水/风险斑块顺应低洼地与河道分布，而非呈现明显像素网格。
  return { key: 'L1', scale: 6, terrainScale: 8, bicubic: true, smoothDepth: true }
}

/** 为等高线间隔挑选一个"好看"的步长（1/2/5×10^n） */
export function niceStep(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(x)))
  const n = x / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p
}

/** Marching squares：提取指定高程的等值线段（返回网格索引坐标的线段） */
export function contourSegments(
  grid: Grid,
  level: number,
): [number, number, number, number][] {
  const segs: [number, number, number, number][] = []
  const { cols, rows, values } = grid
  const interp = (
    x1: number,
    y1: number,
    v1: number,
    x2: number,
    y2: number,
    v2: number,
  ): [number, number] => {
    const t = (level - v1) / (v2 - v1 || 1e-9)
    return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const v00 = values[r * cols + c]
      const v10 = values[r * cols + c + 1]
      const v11 = values[(r + 1) * cols + c + 1]
      const v01 = values[(r + 1) * cols + c]
      if (
        (v00 < level) === (v10 < level) &&
        (v10 < level) === (v11 < level) &&
        (v11 < level) === (v01 < level)
      )
        continue
      const pts: [number, number][] = []
      if ((v00 < level) !== (v10 < level)) pts.push(interp(c, r, v00, c + 1, r, v10))
      if ((v10 < level) !== (v11 < level)) pts.push(interp(c + 1, r, v10, c + 1, r + 1, v11))
      if ((v11 < level) !== (v01 < level)) pts.push(interp(c + 1, r + 1, v11, c, r + 1, v01))
      if ((v01 < level) !== (v00 < level)) pts.push(interp(c, r + 1, v01, c, r, v00))
      if (pts.length === 2) {
        segs.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]])
      } else if (pts.length === 4) {
        segs.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]])
        segs.push([pts[2][0], pts[2][1], pts[3][0], pts[3][1]])
      }
    }
  }
  return segs
}

export async function createTerrainDataUrl(
  terrain: TerrainGrid,
  scale = 6,
  smooth = false,
): Promise<string> {
  const grid = terrain.dem
  const sample = smooth ? bicubic : bilinear
  const { canvas, ctx, w, h } = makeCanvas(grid.cols, grid.rows, scale)
  const img = ctx.createImageData(w, h)
  const range = grid.max - grid.min || 1
  const lat = (grid.south + grid.north) / 2
  const cellW =
    ((grid.east - grid.west) / grid.cols) * 111320 * Math.cos((lat * Math.PI) / 180)
  const cellH = ((grid.north - grid.south) / grid.rows) * 111132
  const zenith = (45 * Math.PI) / 180
  const azSun = (315 * Math.PI) / 180
  const { cols, rows } = grid
  const urbanArr = terrain.urbanity
  const riverArr = terrain.riverDistM

  // 卫星影像风调色：河谷农田 → 丘陵林地 → 建成区水泥灰
  const VEG_LOW: [number, number, number] = [150, 163, 116]
  const VEG_MID: [number, number, number] = [106, 128, 82]
  const FOREST: [number, number, number] = [62, 82, 52]
  const URBAN: [number, number, number] = [126, 129, 125]

  for (const [y0, y1] of bands(h, 8)) {
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < w; x++) {
        const gx = (x / (w - 1)) * (cols - 1)
        const gy = (y / (h - 1)) * (rows - 1)
        const e = sample(grid, gx, gy)
        const dx = (bilinear(grid, gx + 0.5, gy) - bilinear(grid, gx - 0.5, gy)) / cellW
        const dy = (bilinear(grid, gx, gy + 0.5) - bilinear(grid, gx, gy - 0.5)) / cellH
        const slope = Math.atan(Math.hypot(dx, dy))
        const aspect = Math.atan2(-dx, dy)
        const hs =
          Math.cos(zenith) * Math.cos(slope) +
          Math.sin(zenith) * Math.sin(slope) * Math.cos(azSun - aspect)
        // 卫星影像式侧光：平缓地表接近原色，山脊与河谷立体可读
        const shade = Math.max(0.5, Math.min(1.22, 0.85 + hs * 0.38))

        const urban = Math.max(0, Math.min(1, bilinearArr(urbanArr, cols, rows, gx, gy)))
        const t = Math.max(0, Math.min(1, (e - grid.min) / range))

        let r: number
        let g: number
        let b: number
        if (t < 0.45) {
          const f = t / 0.45
          r = VEG_LOW[0] + (VEG_MID[0] - VEG_LOW[0]) * f
          g = VEG_LOW[1] + (VEG_MID[1] - VEG_LOW[1]) * f
          b = VEG_LOW[2] + (VEG_MID[2] - VEG_LOW[2]) * f
        } else {
          const f = (t - 0.45) / 0.55
          r = VEG_MID[0] + (FOREST[0] - VEG_MID[0]) * f
          g = VEG_MID[1] + (FOREST[1] - VEG_MID[1]) * f
          b = VEG_MID[2] + (FOREST[2] - VEG_MID[2]) * f
        }

        // 平原农田拼块：低频旋转格网，模拟作物地块的颜色差异
        if (urban < 0.5) {
          const ang = 0.42
          const ca = Math.cos(ang)
          const sa = Math.sin(ang)
          const px = (gx * ca + gy * sa) / 5
          const py = (-gx * sa + gy * ca) / 5
          const patch = hash2(Math.floor(px), Math.floor(py)) - 0.5
          const amt = patch * 24 * (1 - urban / 0.5)
          r += amt * 0.6
          g += amt * 0.85
          b += amt * 0.35
        }

        // 林地树冠斑块：成簇深绿散点，避免山体呈均匀色块
        const treeW = Math.max(0, Math.min(1, (t - 0.22) / 0.55)) * (1 - urban)
        const clump = hash2(Math.floor(gx * 1.7), Math.floor(gy * 1.7))
        if (treeW > 0.08 && clump > 0.44) {
          const k = treeW * (0.3 + Math.min(1, (clump - 0.44) * 1.6))
          r -= 30 * k
          g -= 22 * k
          b -= 16 * k
        }

        // 建成区：混入水泥灰并叠加街区尺度明暗起伏
        const urbanW = Math.max(0, Math.min(0.9, urban * 1.3 - 0.12))
        if (urbanW > 0.02) {
          const block = hash2(Math.floor(gx / 2.2), Math.floor(gy / 2.2))
          const tone = (block - 0.5) * 14
          r = r * (1 - urbanW) + (URBAN[0] + tone) * urbanW
          g = g * (1 - urbanW) + (URBAN[1] + tone) * urbanW
          b = b * (1 - urbanW) + (URBAN[2] + tone) * urbanW
        }

        // 湿岸压暗：河道走廊保持湿润的深色植被
        const rd = bilinearArr(riverArr, cols, rows, gx, gy)
        const wet = rd < 900 ? Math.exp(-(rd * rd) / (2 * 230 * 230)) : 0
        r -= 12 * wet
        g -= 5 * wet
        b -= 2 * wet

        // 高频颗粒：近似影像传感器的细微噪点
        const grain = (hash2(Math.floor(gx * 7), Math.floor(gy * 7)) - 0.5) * 6

        const idx = (y * w + x) * 4
        img.data[idx] = Math.max(0, Math.min(255, Math.round((r + grain) * shade)))
        img.data[idx + 1] = Math.max(0, Math.min(255, Math.round((g + grain) * shade)))
        img.data[idx + 2] = Math.max(0, Math.min(255, Math.round((b + grain) * shade)))
        img.data[idx + 3] = 255
      }
    }
    if (y1 < h) await yieldToUi()
  }
  ctx.putImageData(img, 0, 0)

  // 等高线：让丘陵、台地、河谷与洼地的起伏可读
  const interval = niceStep(range / 13)
  const toX = (c: number) => (c / (grid.cols - 1)) * (w - 1)
  const toY = (r: number) => (r / (grid.rows - 1)) * (h - 1)
  const baseLine = Math.max(0.8, scale * 0.1)
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const lineFont = `600 ${Math.max(9, Math.round(9 * Math.max(1, scale / 6)))}px "Noto Sans SC", system-ui, sans-serif`
  const start = Math.ceil(grid.min / interval) * interval
  for (let level = start; level <= grid.max; level += interval) {
    const segs = contourSegments(grid, level)
    if (!segs.length) continue
    // 每 5 条设为首曲线（计曲线），加粗加深，便于快速判读高差
    const index = Math.abs(level % (interval * 5)) < 1e-6
    ctx.strokeStyle = index ? 'rgba(233, 239, 222, 0.64)' : 'rgba(214, 224, 200, 0.3)'
    ctx.lineWidth = index ? baseLine * 2.1 : baseLine
    ctx.beginPath()
    for (const s of segs) {
      ctx.moveTo(toX(s[0]), toY(s[1]))
      ctx.lineTo(toX(s[2]), toY(s[3]))
    }
    ctx.stroke()
    // 计曲线标注高程数值（每条曲线取两处，避开画布边缘）
    if (index) {
      const label = `${Math.round(level)}`
      const step = Math.max(1, Math.floor(segs.length / 2))
      ctx.font = lineFont
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = Math.max(2.6, scale * 0.32)
      ctx.strokeStyle = 'rgba(16, 22, 16, 0.9)'
      ctx.fillStyle = 'rgba(240, 245, 232, 0.96)'
      for (let i = step; i < segs.length; i += step) {
        const s = segs[i]
        const mx = (toX(s[0]) + toX(s[2])) / 2
        const my = (toY(s[1]) + toY(s[3])) / 2
        if (mx < 22 || mx > w - 22 || my < 16 || my > h - 16) continue
        ctx.strokeText(label, mx, my)
        ctx.fillText(label, mx, my)
      }
    }
  }
  ctx.restore()
  return canvas.toDataURL('image/png')
}

export function rainRange(rain: Grid): { min: number; max: number } {
  return { min: rain.min, max: rain.max }
}

export async function createRainDataUrl(rain: Grid, scale = 4): Promise<string> {
  const { canvas, ctx, w, h } = makeCanvas(rain.cols, rain.rows, scale)
  const img = ctx.createImageData(w, h)
  const span = rain.max - rain.min || 1
  for (const [y0, y1] of bands(h, 6)) {
    for (let y = y0; y < y1; y++) {
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
    if (y1 < h) await yieldToUi()
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

export async function createDepthDataUrl(
  depth: Grid,
  scale = 4,
  smooth = false,
): Promise<string> {
  const { canvas, ctx, w, h } = makeCanvas(depth.cols, depth.rows, scale)
  const img = ctx.createImageData(w, h)
  for (const [y0, y1] of bands(h, 6)) {
    for (let y = y0; y < y1; y++) {
      const gy = (y / (h - 1)) * (depth.rows - 1)
      const row = Math.min(depth.rows - 1, Math.floor((y / h) * depth.rows))
      for (let x = 0; x < w; x++) {
        const col = Math.min(depth.cols - 1, Math.floor((x / w) * depth.cols))
        const d = smooth
          ? bilinear(depth, (x / (w - 1)) * (depth.cols - 1), gy)
          : depth.values[row * depth.cols + col]
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
    if (y1 < h) await yieldToUi()
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

export async function createRiskDataUrl(
  risk: Uint8Array,
  cols: number,
  rows: number,
  scale = 4,
  smooth = false,
): Promise<string> {
  const { canvas, ctx, w, h } = makeCanvas(cols, rows, scale)
  const img = ctx.createImageData(w, h)
  const at = (r: number, c: number) =>
    risk[Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c))]
  for (const [y0, y1] of bands(h, 6)) {
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < w; x++) {
        let level: number
        if (smooth) {
          // 对离散风险等级做双线性插值后取整，消除全局视图下的方块感
          const gx = (x / (w - 1)) * (cols - 1)
          const gy = (y / (h - 1)) * (rows - 1)
          const x0 = Math.floor(gx)
          const y0 = Math.floor(gy)
          const fx = gx - x0
          const fy = gy - y0
          const v =
            at(y0, x0) * (1 - fx) * (1 - fy) +
            at(y0, x0 + 1) * fx * (1 - fy) +
            at(y0 + 1, x0) * (1 - fx) * fy +
            at(y0 + 1, x0 + 1) * fx * fy
          level = Math.round(v)
        } else {
          const row = Math.min(rows - 1, Math.floor((y / h) * rows))
          const col = Math.min(cols - 1, Math.floor((x / w) * cols))
          level = risk[row * cols + col]
        }
        const c = RISK_RGB[level]
        const idx = (y * w + x) * 4
        img.data[idx] = c[0]
        img.data[idx + 1] = c[1]
        img.data[idx + 2] = c[2]
        img.data[idx + 3] = c[3]
      }
    }
    if (y1 < h) await yieldToUi()
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

export type DiffMode = 'depth' | 'risk'

export async function createDiffDataUrl(
  current: ModelResult,
  baseline: ModelResult,
  mode: DiffMode,
  scale = 4,
): Promise<string> {
  const grid = current.depth
  const { canvas, ctx, w, h } = makeCanvas(grid.cols, grid.rows, scale)
  const img = ctx.createImageData(w, h)
  for (const [y0, y1] of bands(h, 6)) {
    for (let y = y0; y < y1; y++) {
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
    if (y1 < h) await yieldToUi()
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}
