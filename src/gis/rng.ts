export function mulberry32(seed: number) {
  let a = seed >>> 0
  return function random(): number {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash2(x: number, y: number, seed: number): number {
  const v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123
  return v - Math.floor(v)
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const a = hash2(xi, yi, seed)
  const b = hash2(xi + 1, yi, seed)
  const c = hash2(xi, yi + 1, seed)
  const d = hash2(xi + 1, yi + 1, seed)
  const u = smoothstep(xf)
  const v = smoothstep(yf)
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

/** 0..1 的多尺度噪声 */
export function fbm(x: number, y: number, seed = 1): number {
  let sum = 0
  let amp = 0.55
  let freq = 1
  let norm = 0
  for (let i = 0; i < 4; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 13) * amp
    norm += amp
    amp *= 0.5
    freq *= 2.1
  }
  return sum / norm
}

export function randomNormal(random: () => number): number {
  const u = Math.max(1e-9, random())
  const v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function pick<T>(random: () => number, arr: T[]): T {
  return arr[Math.floor(random() * arr.length)]
}
