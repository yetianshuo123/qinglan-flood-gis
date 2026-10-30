import * as THREE from 'three'
import type Map from 'ol/Map'
import { transformExtent } from 'ol/proj'
import type { Grid } from './types'

/**
 * 基于 Three.js 的实时水面覆盖层。
 *
 * 用一张铺满城市范围的平面 + 自定义 ShaderMaterial 实现：
 *  - 由 DEM 栅格决定当前水位下的淹没范围（DEM < 水位 的单元格被渲染为水）
 *  - 片元内多向正弦波叠加产生波纹与高光，模拟水面质感
 *  - 水位（uLevel）由外部驱动：常态为河道常水位，洪水演示时连续上涨
 *
 * 相机为正交相机，每一帧与 OpenLayers 当前视口范围（EPSG:3857 米）对齐，
 * 保证水面几何位置与底图严格重合。
 */
export class WaterOverlay {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.OrthographicCamera
  private mesh: THREE.Mesh
  private demTexture: THREE.DataTexture
  private uniforms: {
    uLevel: { value: number }
    uTime: { value: number }
    uMin: { value: number }
    uRange: { value: number }
    uDem: { value: THREE.DataTexture }
    uOpacity: { value: number }
  }

  private cityCenterX: number
  private cityCenterY: number
  private raf = 0
  private running = false
  private lastT = 0

  constructor(container: HTMLElement, dem: Grid) {
    const extent = transformExtent(
      [dem.west, dem.south, dem.east, dem.north],
      'EPSG:4326',
      'EPSG:3857',
    )
    const minX = extent[0]
    const minY = extent[1]
    const maxX = extent[2]
    const maxY = extent[3]
    this.cityCenterX = (minX + maxX) / 2
    this.cityCenterY = (minY + maxY) / 2

    const width = maxX - minX
    const height = maxY - minY

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    const canvas = this.renderer.domElement
    canvas.className = 'water-overlay-canvas'
    canvas.style.position = 'absolute'
    canvas.style.inset = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.pointerEvents = 'none'
    canvas.style.zIndex = '4'
    container.appendChild(canvas)

    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
    this.camera.up.set(0, 0, 1)
    this.camera.position.set(this.cityCenterX, 100, this.cityCenterY)
    this.camera.lookAt(this.cityCenterX, 0, this.cityCenterY)

    // DEM 作为红色浮点纹理上传，片元按 UV 采样得到地表高程（米）
    const { cols, rows, values, min, max } = dem
    const demFloats = new Float32Array(values.length)
    for (let i = 0; i < values.length; i++) demFloats[i] = values[i]
    this.demTexture = new THREE.DataTexture(demFloats, cols, rows, THREE.RedFormat, THREE.FloatType)
    this.demTexture.needsUpdate = true
    this.demTexture.minFilter = THREE.LinearFilter
    this.demTexture.magFilter = THREE.LinearFilter

    const geo = new THREE.PlaneGeometry(width, height, 1, 1)
    geo.rotateX(-Math.PI / 2)
    // PlaneGeometry 默认 +Y 为法向；旋转后平面落在 XZ 平面，UV (0,0)→西南角
    this.mesh = new THREE.Mesh(geo)
    this.mesh.position.set(this.cityCenterX, 0, this.cityCenterY)
    this.scene.add(this.mesh)

    this.uniforms = {
      uLevel: { value: min + 1.5 },
      uTime: { value: 0 },
      uMin: { value: min },
      uRange: { value: max - min || 1 },
      uDem: { value: this.demTexture },
      uOpacity: { value: 0.92 },
    }

    this.mesh.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uLevel;
        uniform float uTime;
        uniform float uMin;
        uniform float uRange;
        uniform sampler2D uDem;
        uniform float uOpacity;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        void main() {
          float dem = texture2D(uDem, vUv).r;
          float depth = uLevel - dem;
          if (depth <= 0.0) discard;

          // 三组不同方向/频率的行波叠加，形成碎散高光与流动波纹
          float w1 = sin(vWorldPos.x * 0.018 + uTime * 1.3);
          float w2 = sin(vWorldPos.z * 0.014 - uTime * 1.0) * 0.6;
          float w3 = sin((vWorldPos.x + vWorldPos.z) * 0.009 + uTime * 0.6) * 0.35;
          float wave = (w1 + w2 + w3) * 0.5 + 0.5;

          // 水深着色：浅水偏青、深水偏蓝
          float k = clamp(depth / 2.6, 0.0, 1.0);
          vec3 shallow = vec3(0.46, 0.83, 0.92);
          vec3 deep = vec3(0.04, 0.22, 0.40);
          vec3 col = mix(shallow, deep, k);

          // 高光：波峰处的镜面反射感
          float spec = pow(wave, 9.0) * 0.55;
          col += vec3(0.72, 0.92, 1.0) * spec;

          // 岸边消隐：避免硬边
          float edge = smoothstep(0.0, 0.35, depth);
          gl_FragColor = vec4(col, uOpacity * edge);
        }
      `,
    })

    this.resize()
  }

  /** 与 OpenLayers 视口同步：把正交相机的可视范围设为当前地图范围（EPSG:3857 米） */
  syncView(map: Map) {
    const size = map.getSize()
    if (!size) return
    const extent = map.getView().calculateExtent(size)
    const cx = (extent[0] + extent[2]) / 2
    const cy = (extent[1] + extent[3]) / 2
    const halfW = (extent[2] - extent[0]) / 2
    const halfH = (extent[3] - extent[1]) / 2
    this.camera.left = -halfW
    this.camera.right = halfW
    this.camera.top = halfH
    this.camera.bottom = -halfH
    this.camera.position.set(cx, 100, cy)
    this.camera.lookAt(cx, 0, cy)
    this.camera.updateProjectionMatrix()
  }

  resize() {
    const canvas = this.renderer.domElement
    const parent = canvas.parentElement
    if (!parent) return
    const w = parent.clientWidth
    const h = parent.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setSize(w, h, false)
  }

  setLevel(level: number) {
    this.uniforms.uLevel.value = level
  }

  setOpacity(o: number) {
    this.uniforms.uOpacity.value = Math.max(0, Math.min(1, o))
  }

  start() {
    if (this.running) return
    this.running = true
    this.lastT = performance.now()
    const loop = (now: number) => {
      if (!this.running) return
      this.raf = requestAnimationFrame(loop)
      const dt = (now - this.lastT) / 1000
      this.lastT = now
      this.uniforms.uTime.value += dt
      this.renderer.render(this.scene, this.camera)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop() {
    this.running = false
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  renderOnce() {
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.stop()
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.demTexture.dispose()
    this.renderer.dispose()
    const canvas = this.renderer.domElement
    if (canvas.parentElement) canvas.parentElement.removeChild(canvas)
  }
}
