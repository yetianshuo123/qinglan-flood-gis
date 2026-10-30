import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { CityData, Grid } from './types'
import { sampleGrid } from './grid'

/** 地形垂直夸张倍数：真实高差 ~54 m，放大后丘陵与河谷才可辨 */
const TERRAIN_EXAGG = 14
/** 建筑垂直夸张倍数：略小于地形，避免高楼像尖塔 */
const BUILDING_EXAGG = 6

/** 建筑类型配色（与二维图层保持同一套色相，3D 下略提亮） */
const TYPE_COLOR: Record<string, [number, number, number]> = {
  住宅: [0.62, 0.71, 0.8],
  商业: [0.85, 0.7, 0.42],
  公共: [0.55, 0.77, 0.69],
  学校: [0.58, 0.69, 0.88],
  医院: [0.86, 0.6, 0.6],
  工业: [0.69, 0.64, 0.78],
}

/** 高程分段配色：河谷平原 → 丘陵林地 → 山脊 */
const TERRAIN_STOPS: [number, [number, number, number]][] = [
  [0.0, [0.62, 0.68, 0.44]],
  [0.28, [0.46, 0.58, 0.35]],
  [0.62, [0.31, 0.42, 0.27]],
  [1.0, [0.24, 0.3, 0.22]],
]

function terrainColor(t: number, urban: number): [number, number, number] {
  const k = Math.max(0, Math.min(1, t))
  let a = TERRAIN_STOPS[0]
  let b = TERRAIN_STOPS[TERRAIN_STOPS.length - 1]
  for (let i = 0; i < TERRAIN_STOPS.length - 1; i++) {
    if (k >= TERRAIN_STOPS[i][0] && k <= TERRAIN_STOPS[i + 1][0]) {
      a = TERRAIN_STOPS[i]
      b = TERRAIN_STOPS[i + 1]
      break
    }
  }
  const span = b[0] - a[0] || 1
  const f = (k - a[0]) / span
  const c0 = a[1]
  const c1 = b[1]
  const r = c0[0] + (c1[0] - c0[0]) * f
  const g = c0[1] + (c1[1] - c0[1]) * f
  const bl = c0[2] + (c1[2] - c0[2]) * f
  // 建成区混入水泥灰
  const u = Math.max(0, Math.min(0.85, urban * 1.25 - 0.1))
  return [r * (1 - u) + 0.55 * u, g * (1 - u) + 0.56 * u, bl * (1 - u) + 0.55 * u]
}

export interface Scene3DOptions {
  onReady?: () => void
}

/**
 * 程序化三维地图场景：
 *  - DEM 三角网地形（顶点色 + 侧光），真实呈现丘陵、河谷与建成区
 *  - 建筑按高度分桶挤出为三维体块，可按阈值隐藏低层建筑
 *  - 水系用 DEM 淹没掩膜 + 波光着色器，支持水位上涨动画
 *  - 道路贴地绘制为细线
 */
export class Scene3D {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private host: HTMLElement
  private raf = 0
  private running = false
  private lastT = 0

  private buildingBuckets: { mesh: THREE.Mesh; minH: number }[] = []

  private water: THREE.Mesh
  private waterUniforms: {
    uDem: { value: THREE.DataTexture }
    uMin: { value: number }
    uRange: { value: number }
    uLevel: { value: number }
    uTime: { value: number }
  }

  private dem: Grid
  private baseLevel: number
  private topLevel: number
  private floodDemo = false
  private floodPhase = 0

  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = []

  constructor(host: HTMLElement, city: CityData, opts: Scene3DOptions = {}) {
    this.host = host
    this.dem = city.terrain.dem
    const { cols, rows, values, west, south, east, north, min, max } = this.dem
    const latMid = (south + north) / 2
    const widthM = (east - west) * 111320 * Math.cos((latMid * Math.PI) / 180)
    const depthM = (north - south) * 111132
    this.baseLevel = min + 1.6
    this.topLevel = min + 8.4

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(host.clientWidth, host.clientHeight, false)
    this.renderer.shadowMap.enabled = false
    const canvas = this.renderer.domElement
    canvas.className = 'scene3d-canvas'
    host.appendChild(canvas)

    this.scene.background = new THREE.Color(0x070d12)
    this.scene.fog = new THREE.Fog(0x0a141c, depthM * 3, depthM * 7)

    this.camera = new THREE.PerspectiveCamera(45, 1, 20, widthM * 6)
    this.camera.position.set(0, depthM * 1.9, depthM * 2.1)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.maxPolarAngle = Math.PI / 2 - 0.12
    this.controls.minDistance = Math.max(400, widthM * 0.05)
    this.controls.maxDistance = widthM * 3
    this.controls.target.set(0, (max - min) * TERRAIN_EXAGG * 0.12, 0)

    /* ---------- 光照：低角度侧光 + 环境光，突出地形起伏 ---------- */
    const sun = new THREE.DirectionalLight(0xfff3dd, 2.1)
    sun.position.set(-widthM * 0.6, depthM * 1.1, -depthM * 0.5)
    this.scene.add(sun)
    this.scene.add(new THREE.AmbientLight(0x9fbcd4, 1.15))
    const hemi = new THREE.HemisphereLight(0x8fc6e8, 0x2b3326, 0.85)
    this.scene.add(hemi)

    const toX = (lon: number) => ((lon - west) / (east - west) - 0.5) * widthM
    const toZ = (lat: number) => ((north - lat) / (north - south) - 0.5) * depthM

    /* ---------- 地形：DEM 三角网 + 顶点色 ---------- */
    const pos = new Float32Array(cols * rows * 3)
    const col = new Float32Array(cols * rows * 3)
    const uv = new Float32Array(cols * rows * 2)
    const range = max - min || 1
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        const o = i * 3
        pos[o] = (c / (cols - 1) - 0.5) * widthM
        pos[o + 1] = (values[i] - min) * TERRAIN_EXAGG
        pos[o + 2] = (r / (rows - 1) - 0.5) * depthM
        const [cr, cg, cb] = terrainColor((values[i] - min) / range, city.terrain.urbanity[i])
        col[o] = cr
        col[o + 1] = cg
        col[o + 2] = cb
        uv[i * 2] = c / (cols - 1)
        uv[i * 2 + 1] = 1 - r / (rows - 1)
      }
    }
    const idx = new Uint32Array((cols - 1) * (rows - 1) * 6)
    let k = 0
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c
        const b = a + 1
        const d = (r + 1) * cols + c
        const e = d + 1
        idx[k++] = a
        idx[k++] = d
        idx[k++] = b
        idx[k++] = b
        idx[k++] = d
        idx[k++] = e
      }
    }
    const terrainGeo = new THREE.BufferGeometry()
    terrainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    terrainGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    terrainGeo.setIndex(new THREE.BufferAttribute(idx, 1))
    terrainGeo.computeVertexNormals()
    const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
    this.disposables.push(terrainGeo, terrainMat)
    this.scene.add(new THREE.Mesh(terrainGeo, terrainMat))

    /* ---------- 道路：贴地细线 ---------- */
    const roadPts: number[] = []
    for (const f of city.roads.features) {
      const coords = f.geometry.coordinates as [number, number][]
      for (let i = 0; i < coords.length - 1; i++) {
        for (const [lon, la] of [coords[i], coords[i + 1]]) {
          roadPts.push(toX(lon), (sampleGrid(this.dem, lon, la) - min) * TERRAIN_EXAGG + 6, toZ(la))
        }
      }
    }
    const roadGeo = new THREE.BufferGeometry()
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPts, 3))
    const roadMat = new THREE.LineBasicMaterial({
      color: 0xdfe7dd,
      transparent: true,
      opacity: 0.5,
    })
    this.disposables.push(roadGeo, roadMat)
    this.scene.add(new THREE.LineSegments(roadGeo, roadMat))

    /* ---------- 建筑：按高度分桶合并挤出 ---------- */
    const buckets: THREE.BufferGeometry[][] = [[], [], [], []]
    for (const f of city.buildings.features) {
      const props = f.properties
      const h = Number(props.heightM ?? 12)
      const bi = h < 15 ? 0 : h < 20 ? 1 : h < 30 ? 2 : 3
      const ring = (f.geometry.coordinates as [number, number][][]).find((r) => r.length >= 4)
      if (!ring) continue
      const shape = new THREE.Shape()
      ring.forEach(([lon, la], i) => {
        const x = toX(lon)
        const y = -toZ(la)
        if (i === 0) shape.moveTo(x, y)
        else shape.lineTo(x, y)
      })
      const elev = Number(props.elevation ?? sampleGrid(this.dem, ring[0][0], ring[0][1]))
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(4, Number(props.heightM ?? 12)) * BUILDING_EXAGG,
        bevelEnabled: false,
        steps: 1,
      })
      geo.rotateX(-Math.PI / 2)
      geo.translate(0, (elev - min) * TERRAIN_EXAGG, 0)

      // 顶点色：同一类型统一色，屋面略亮
      const c = TYPE_COLOR[props.buildingType] ?? TYPE_COLOR.住宅
      const count = geo.getAttribute('position').count
      const colors = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        colors[i * 3] = c[0]
        colors[i * 3 + 1] = c[1]
        colors[i * 3 + 2] = c[2]
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      buckets[bi].push(geo)
    }

    const buildingMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    })
    this.disposables.push(buildingMat)
    const ranges = [
      [0, 15],
      [15, 20],
      [20, 30],
      [30, Infinity],
    ]
    buckets.forEach((list, i) => {
      if (!list.length) return
      const merged = mergeGeometries(list, false)
      list.forEach((g) => g.dispose())
      if (!merged) return
      merged.computeVertexNormals()
      this.disposables.push(merged)
      const mesh = new THREE.Mesh(merged, buildingMat)
      this.scene.add(mesh)
      this.buildingBuckets.push({ mesh, minH: ranges[i][0] })
    })

    /* ---------- 水系：DEM 淹没掩膜 + 波光着色器 ---------- */
    const demData = new Uint8Array(cols * rows * 4)
    for (let i = 0; i < cols * rows; i++) {
      demData[i * 4] = Math.round(((values[i] - min) / range) * 255)
      demData[i * 4 + 3] = 255
    }
    const demTex = new THREE.DataTexture(demData, cols, rows, THREE.RGBAFormat)
    demTex.minFilter = THREE.LinearFilter
    demTex.magFilter = THREE.LinearFilter
    demTex.needsUpdate = true
    this.disposables.push(demTex)

    this.waterUniforms = {
      uDem: { value: demTex },
      uMin: { value: min },
      uRange: { value: range },
      uLevel: { value: this.baseLevel },
      uTime: { value: 0 },
    }
    const waterGeo = new THREE.PlaneGeometry(widthM, depthM, 1, 1)
    waterGeo.rotateX(-Math.PI / 2)
    const waterMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: this.waterUniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uDem;
        uniform float uMin;
        uniform float uRange;
        uniform float uLevel;
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          float dem = uMin + texture2D(uDem, vec2(vUv.x, 1.0 - vUv.y)).r * uRange;
          float depth = uLevel - dem;
          if (depth <= 0.0) discard;
          float k = clamp(depth / 2.6, 0.0, 1.0);
          vec3 col = mix(vec3(0.24, 0.66, 0.82), vec3(0.03, 0.16, 0.33), k);
          float w = sin(vWorld.x * 0.05 + uTime * 1.4)
                  + sin(vWorld.z * 0.042 - uTime * 1.05) * 0.7
                  + sin((vWorld.x + vWorld.z) * 0.02 + uTime * 0.6) * 0.4;
          col += vec3(0.7, 0.9, 1.0) * pow(max(0.0, w * 0.5 + 0.5), 8.0) * 0.45;
          gl_FragColor = vec4(col, 0.93 * smoothstep(0.0, 0.4, depth));
        }
      `,
    })
    this.disposables.push(waterGeo, waterMat)
    this.water = new THREE.Mesh(waterGeo, waterMat)
    this.water.position.y = (this.baseLevel - min) * TERRAIN_EXAGG
    this.scene.add(this.water)

    this.resize()
    const ro = new ResizeObserver(() => this.resize())
    ro.observe(host)
    this.disposeHooks.push(() => ro.disconnect())

    opts.onReady?.()
    this.start()
  }

  private disposeHooks: (() => void)[] = []

  /** 按高度阈值显示建筑分桶（0 = 全部显示） */
  setBuildingMinHeight(h: number) {
    for (const b of this.buildingBuckets) {
      b.mesh.visible = h === 0 || b.minH >= h
    }
  }

  setFloodDemo(on: boolean) {
    this.floodDemo = on
    if (!on) {
      this.waterUniforms.uLevel.value = this.baseLevel
      this.water.position.y = (this.baseLevel - this.dem.min) * TERRAIN_EXAGG
    }
  }

  /** 重置相机到初始俯瞰视角 */
  resetView() {
    this.controls.target.set(0, 0, 0)
    const depthM = (this.dem.north - this.dem.south) * 111132
    this.camera.position.set(0, depthM * 1.9, depthM * 2.1)
    this.controls.update()
  }

  resize() {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    if (!w || !h) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
  }

  private start() {
    if (this.running) return
    this.running = true
    this.lastT = performance.now()
    const loop = (now: number) => {
      if (!this.running) return
      this.raf = requestAnimationFrame(loop)
      const dt = Math.min(0.1, (now - this.lastT) / 1000)
      this.lastT = now
      this.waterUniforms.uTime.value += dt

      if (this.floodDemo) {
        this.floodPhase += dt
        const cycle = 13
        const p = (this.floodPhase % cycle) / cycle
        const rise = p < 0.62 ? p / 0.62 : (1 - p) / 0.38
        const level = this.baseLevel + rise * (this.topLevel - this.baseLevel)
        this.waterUniforms.uLevel.value = level
        this.water.position.y = (level - this.dem.min) * TERRAIN_EXAGG
      }

      this.controls.update()
      this.renderer.render(this.scene, this.camera)
    }
    this.raf = requestAnimationFrame(loop)
  }

  dispose() {
    this.running = false
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    for (const fn of this.disposeHooks) fn()
    this.controls.dispose()
    for (const d of this.disposables) d.dispose()
    this.scene.clear()
    this.renderer.dispose()
    const canvas = this.renderer.domElement
    if (canvas.parentElement) canvas.parentElement.removeChild(canvas)
  }
}

/** 检测当前环境是否可用 WebGL */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')
    )
  } catch {
    return false
  }
}
