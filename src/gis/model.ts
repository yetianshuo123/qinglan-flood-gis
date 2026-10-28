import type {
  BuildingImpact,
  CityData,
  Grid,
  ModelResult,
  RoadImpact,
  Scenario,
  ScenarioMetrics,
} from './types'
import {
  cellAreaAtRow,
  createGrid,
  refreshGridStats,
  sampleGrid,
} from './grid'

export const FLOOD_THRESHOLD_M = 0.03
export const RISK_THRESHOLDS = [0.03, 0.08, 0.18, 0.35]
export const RISK_LABELS = ['无风险', '低风险', '中风险', '高风险', '极高风险']
export const RISK_COLORS = ['#00000000', '#f2d15c', '#ee9f4a', '#df5a39', '#9f1b2d']

function riskLevel(depth: number): number {
  if (depth < RISK_THRESHOLDS[0]) return 0
  if (depth < RISK_THRESHOLDS[1]) return 1
  if (depth < RISK_THRESHOLDS[2]) return 2
  if (depth < RISK_THRESHOLDS[3]) return 3
  return 4
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * 简化城市内涝模型（非水动力模型，仅用于空间分析演示）
 * 1. 产流：净雨 = max(0, 降雨 - 下渗) × 径流系数，并减去按河道/渠道/泵站/坡度计算的排水能力
 * 2. 地形易涝度：局部低洼程度、坡度、D8 汇流集中度、洼地范围加权，河道与渠道附近排水折减
 * 3. 积水深度：净雨超过初损后，与地形易涝度做非线性放大（经验系数），并限制最大深度
 * 4. 风险等级：按积水深度分级
 */
export function runScenario(city: CityData, scenario: Scenario): ModelResult {
  const { infilRate, runoffCoef, susceptibility, flowAccum } = city.terrain
  const { cols, rows } = city.terrain.dem
  const n = cols * rows
  const duration = scenario.durationH

  const rain = createGrid(cols, rows, city.bounds, 'mm/h')
  const netMm = new Float64Array(n)

  for (let i = 0; i < n; i++) {
    const intensity = scenario.rainMmH * city.rainPattern[i]
    rain.values[i] = intensity
    const rainDepth = intensity * duration
    const infil = Math.min(infilRate[i] * duration, rainDepth * 0.9)
    const runoff = Math.max(0, rainDepth - infil) * runoffCoef[i]

    const riverProx = Math.exp(
      -((city.terrain.riverDistM[i] * city.terrain.riverDistM[i]) / (2 * 600 * 600)),
    )
    const drainProx = Number.isFinite(city.terrain.drainDistM[i])
      ? Math.exp(
          -((city.terrain.drainDistM[i] * city.terrain.drainDistM[i]) / (2 * 380 * 380)),
        )
      : 0
    const pumpProx = Math.exp(
      -((city.terrain.pumpDistM[i] * city.terrain.pumpDistM[i]) / (2 * 650 * 650)),
    )
    const slopeNorm = clamp(city.terrain.slope[i] / 0.05, 0, 1)
    const drainRate =
      2 + 26 * riverProx + 6 * drainProx + 5 * pumpProx + 10 * slopeNorm
    const drainage = drainRate * duration
    netMm[i] = Math.max(0, runoff - drainage)
  }
  refreshGridStats(rain)

  const depth = createGrid(cols, rows, city.bounds, 'm')
  const risk = new Uint8Array(n)

  for (let i = 0; i < n; i++) {
    const excess = Math.max(0, netMm[i] - 3)
    const s = susceptibility[i]
    const dMm = 4.6 * Math.pow(excess, 1.15) * Math.pow(s, 2.83)
    const d = Math.min(2.5, dMm / 1000)
    depth.values[i] = d
    risk[i] = riskLevel(d)
  }
  refreshGridStats(depth)

  const metrics = computeMetrics(city, scenario, rain, depth, risk)
  return { scenario, rain, depth, risk, flowAccum, metrics }
}

function computeMetrics(
  city: CityData,
  scenario: Scenario,
  rain: Grid,
  depth: Grid,
  risk: Uint8Array,
): ScenarioMetrics {
  const { cols, rows } = depth
  const riskAreaM2: [number, number, number, number, number] = [0, 0, 0, 0, 0]
  let floodedAreaM2 = 0
  let cityAreaM2 = 0
  let maxDepth = 0
  let depthSum = 0
  let floodedCount = 0
  let rainSum = 0

  for (let row = 0; row < rows; row++) {
    const cellArea = cellAreaAtRow(depth, row)
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col
      cityAreaM2 += cellArea
      rainSum += rain.values[i]
      const d = depth.values[i]
      riskAreaM2[risk[i]] += cellArea
      if (d >= FLOOD_THRESHOLD_M) {
        floodedAreaM2 += cellArea
        floodedCount++
        depthSum += d
        if (d > maxDepth) maxDepth = d
      }
    }
  }

  const affectedRoads: RoadImpact[] = []
  for (const f of city.roads.features) {
    const coords = f.geometry.coordinates as [number, number][]
    const lengthM = f.properties.lengthM
    const step = 25
    const samples = Math.max(1, Math.floor(lengthM / step))
    let flooded = 0
    let roadMax = 0
    let worstDepth = 0
    let worstPoint = coords[0]
    for (let s = 0; s <= samples; s++) {
      const t = s / samples
      const pos = pointAlong(coords, t)
      const d = sampleGrid(depth, pos[0], pos[1])
      if (d > roadMax) roadMax = d
      if (d > worstDepth) {
        worstDepth = d
        worstPoint = pos
      }
      if (d >= FLOOD_THRESHOLD_M) flooded++
    }
    const floodedLengthM = Math.round((flooded / (samples + 1)) * lengthM)
    if (floodedLengthM >= 30) {
      affectedRoads.push({
        id: f.properties.id,
        name: f.properties.name,
        floodedLengthM,
        floodedPct: Math.round((floodedLengthM / lengthM) * 1000) / 10,
        maxDepth: Math.round(roadMax * 1000) / 1000,
        lengthM,
        point: worstPoint,
      })
    }
  }
  affectedRoads.sort((a, b) => b.floodedLengthM - a.floodedLengthM)

  const affectedBuildings: BuildingImpact[] = []
  for (const f of city.buildings.features) {
    const ring = f.geometry.coordinates[0] as [number, number][]
    let cx = 0
    let cy = 0
    for (const p of ring) {
      cx += p[0]
      cy += p[1]
    }
    cx /= ring.length
    cy /= ring.length
    const d = sampleGrid(depth, cx, cy)
    if (d >= 0.05) {
      affectedBuildings.push({
        id: f.properties.id,
        name: f.properties.name,
        buildingType: f.properties.buildingType,
        district: f.properties.district,
        depth: Math.round(d * 1000) / 1000,
        risk: riskLevel(d),
        point: [cx, cy],
      })
    }
  }
  affectedBuildings.sort((a, b) => b.depth - a.depth)

  const meanRain = rainSum / (cols * rows)
  return {
    rainMmH: scenario.rainMmH,
    durationH: scenario.durationH,
    totalRainMm: Math.round(meanRain * scenario.durationH * 10) / 10,
    floodedAreaM2: Math.round(floodedAreaM2),
    floodedPct: Math.round((floodedAreaM2 / cityAreaM2) * 1000) / 10,
    riskAreaM2: riskAreaM2.map((v) => Math.round(v)) as [
      number,
      number,
      number,
      number,
      number,
    ],
    highRiskAreaM2: Math.round(riskAreaM2[3] + riskAreaM2[4]),
    maxDepth: Math.round(maxDepth * 1000) / 1000,
    meanDepthFlooded: floodedCount ? Math.round((depthSum / floodedCount) * 1000) / 1000 : 0,
    affectedRoads,
    affectedBuildings,
  }
}

function pointAlong(coords: [number, number][], t: number): [number, number] {
  if (coords.length === 1) return coords[0]
  const segments: number[] = []
  let total = 0
  for (let i = 0; i < coords.length - 1; i++) {
    const d = Math.hypot(
      (coords[i + 1][0] - coords[i][0]) * 96000,
      (coords[i + 1][1] - coords[i][1]) * 111132,
    )
    segments.push(d)
    total += d
  }
  let target = t * total
  for (let i = 0; i < segments.length; i++) {
    if (target <= segments[i] || i === segments.length - 1) {
      const f = segments[i] === 0 ? 0 : target / segments[i]
      return [
        coords[i][0] + (coords[i + 1][0] - coords[i][0]) * f,
        coords[i][1] + (coords[i + 1][1] - coords[i][1]) * f,
      ]
    }
    target -= segments[i]
  }
  return coords[coords.length - 1]
}

/** 供调试/校验：返回各降雨情景的核心指标 */
export function scenarioSummary(city: CityData, scenario: Scenario) {
  const m = runScenario(city, scenario).metrics
  return {
    降雨: scenario.rainMmH,
    历时: scenario.durationH,
    积水面积ha: Math.round(m.floodedAreaM2 / 100) / 100,
    积水占比: m.floodedPct,
    高风险ha: Math.round(m.highRiskAreaM2 / 100) / 100,
    最大水深: m.maxDepth,
    受影响道路: m.affectedRoads.length,
    受影响建筑: m.affectedBuildings.length,
  }
}
