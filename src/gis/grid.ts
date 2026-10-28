import type { BBox, Grid, LonLat } from './types'

export const METERS_PER_DEG_LAT = 111132
export const METERS_PER_DEG_LON = 111320

export function createGrid(
  cols: number,
  rows: number,
  bounds: BBox,
  unit: string,
): Grid {
  const [west, south, east, north] = bounds
  return {
    cols,
    rows,
    west,
    south,
    east,
    north,
    values: new Float64Array(cols * rows),
    min: 0,
    max: 0,
    unit,
  }
}

export function refreshGridStats(grid: Grid): Grid {
  let min = Infinity
  let max = -Infinity
  for (const v of grid.values) {
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  grid.min = Number.isFinite(min) ? min : 0
  grid.max = Number.isFinite(max) ? max : 0
  return grid
}

export function cellSizeMeters(grid: Grid, row: number): { w: number; h: number } {
  const lat = grid.north - ((row + 0.5) * (grid.north - grid.south)) / grid.rows
  const h = ((grid.north - grid.south) / grid.rows) * METERS_PER_DEG_LAT
  const w =
    ((grid.east - grid.west) / grid.cols) *
    METERS_PER_DEG_LON *
    Math.cos((lat * Math.PI) / 180)
  return { w, h }
}

export function cellAreaAtRow(grid: Grid, row: number): number {
  const { w, h } = cellSizeMeters(grid, row)
  return w * h
}

export function cellCenter(grid: Grid, row: number, col: number): LonLat {
  const lon = grid.west + ((col + 0.5) / grid.cols) * (grid.east - grid.west)
  const lat = grid.north - ((row + 0.5) / grid.rows) * (grid.north - grid.south)
  return [lon, lat]
}

export function cellIndex(grid: Grid, row: number, col: number): number {
  return row * grid.cols + col
}

export function lonLatToCell(
  grid: Grid,
  lon: number,
  lat: number,
): { row: number; col: number; inside: boolean } {
  const col = Math.floor(((lon - grid.west) / (grid.east - grid.west)) * grid.cols)
  const row = Math.floor(((grid.north - lat) / (grid.north - grid.south)) * grid.rows)
  const inside = col >= 0 && col < grid.cols && row >= 0 && row < grid.rows
  return {
    row: Math.max(0, Math.min(grid.rows - 1, row)),
    col: Math.max(0, Math.min(grid.cols - 1, col)),
    inside,
  }
}

/** 双线性采样；网格第 0 行在北侧 */
export function sampleGrid(grid: Grid, lon: number, lat: number): number {
  const gx = ((lon - grid.west) / (grid.east - grid.west)) * grid.cols - 0.5
  const gy = ((grid.north - lat) / (grid.north - grid.south)) * grid.rows - 0.5
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const fx = gx - x0
  const fy = gy - y0
  const at = (r: number, c: number) => {
    const rr = Math.max(0, Math.min(grid.rows - 1, r))
    const cc = Math.max(0, Math.min(grid.cols - 1, c))
    return grid.values[rr * grid.cols + cc]
  }
  const v00 = at(y0, x0)
  const v10 = at(y0, x0 + 1)
  const v01 = at(y0 + 1, x0)
  const v11 = at(y0 + 1, x0 + 1)
  return (
    v00 * (1 - fx) * (1 - fy) +
    v10 * fx * (1 - fy) +
    v01 * (1 - fx) * fy +
    v11 * fx * fy
  )
}

export function gaussian(
  lon: number,
  lat: number,
  clon: number,
  clat: number,
  sx: number,
  sy: number,
  rotationDeg = 0,
): number {
  const rad = (rotationDeg * Math.PI) / 180
  const dx = lon - clon
  const dy = lat - clat
  const rx = dx * Math.cos(rad) + dy * Math.sin(rad)
  const ry = -dx * Math.sin(rad) + dy * Math.cos(rad)
  return Math.exp(-(rx * rx) / (2 * sx * sx) - (ry * ry) / (2 * sy * sy))
}

export function gridBBox(grid: Grid): BBox {
  return [grid.west, grid.south, grid.east, grid.north]
}

/** 用于在局部平面内估算距离（米） */
export function metersPerDegree(lat: number): { x: number; y: number } {
  return {
    x: METERS_PER_DEG_LON * Math.cos((lat * Math.PI) / 180),
    y: METERS_PER_DEG_LAT,
  }
}

export function distanceMeters(a: LonLat, b: LonLat): number {
  const lat = (a[1] + b[1]) / 2
  const m = metersPerDegree(lat)
  const dx = (a[0] - b[0]) * m.x
  const dy = (a[1] - b[1]) * m.y
  return Math.hypot(dx, dy)
}

/** 点到折线的最短距离（米，局部平面近似） */
export function pointToLineDistanceMeters(
  lon: number,
  lat: number,
  coords: LonLat[],
): number {
  if (coords.length === 0) return Infinity
  const m = metersPerDegree(lat)
  const px = lon * m.x
  const py = lat * m.y
  let best = Infinity
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = coords[i][0] * m.x
    const ay = coords[i][1] * m.y
    const bx = coords[i + 1][0] * m.x
    const by = coords[i + 1][1] * m.y
    const dx = bx - ax
    const dy = by - ay
    const lenSq = dx * dx + dy * dy
    let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))
    const dist = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
    if (dist < best) best = dist
  }
  return best
}

export function polylineLengthMeters(coords: LonLat[]): number {
  let total = 0
  for (let i = 0; i < coords.length - 1; i++) {
    total += distanceMeters(coords[i], coords[i + 1])
  }
  return total
}

/** 局部平面内沿线取样，返回点与累计距离 */
export function sampleLine(
  coords: LonLat[],
  stepMeters: number,
): { point: LonLat; distance: number }[] {
  if (coords.length < 2) return []
  const total = polylineLengthMeters(coords)
  const result: { point: LonLat; distance: number }[] = []
  for (let d = 0; d <= total; d += stepMeters) {
    result.push({ point: pointAlong(coords, d), distance: d })
  }
  const last = coords[coords.length - 1]
  if (result.length === 0 || result[result.length - 1].distance < total - 1) {
    result.push({ point: last, distance: total })
  }
  return result
}

function pointAlong(coords: LonLat[], distance: number): LonLat {
  let remaining = distance
  for (let i = 0; i < coords.length - 1; i++) {
    const seg = distanceMeters(coords[i], coords[i + 1])
    if (remaining <= seg || i === coords.length - 2) {
      const t = seg === 0 ? 0 : Math.max(0, Math.min(1, remaining / seg))
      return [
        coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
        coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
      ]
    }
    remaining -= seg
  }
  return coords[coords.length - 1]
}
