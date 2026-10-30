import { useEffect, useRef, useState } from 'react'
import type { CityData } from '../gis/types'
import { Scene3D, webglAvailable } from '../gis/scene3d'
import { Icon } from './Icon'

interface Map3DProps {
  city: CityData
  buildingMinHeight: number
  floodDemo: boolean
  onExit: () => void
  onToggleFlood: (on: boolean) => void
}

export default function Map3D(props: Map3DProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<Scene3D | null>(null)
  const [error, setError] = useState<string | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (!webglAvailable()) {
      setError('当前浏览器/环境不支持 WebGL，无法渲染三维地图。请切换到二维视图。')
      return
    }
    try {
      const scene = new Scene3D(host, props.city)
      sceneRef.current = scene
      scene.setBuildingMinHeight(propsRef.current.buildingMinHeight)
      scene.setFloodDemo(propsRef.current.floodDemo)
    } catch (e) {
      setError(`三维场景初始化失败：${e instanceof Error ? e.message : String(e)}`)
      sceneRef.current = null
    }
    return () => {
      sceneRef.current?.dispose()
      sceneRef.current = null
    }
  }, [props.city])

  useEffect(() => {
    sceneRef.current?.setBuildingMinHeight(props.buildingMinHeight)
  }, [props.buildingMinHeight])

  useEffect(() => {
    sceneRef.current?.setFloodDemo(props.floodDemo)
  }, [props.floodDemo])

  return (
    <div className="map3d-host" ref={hostRef}>
      {error && (
        <div className="map3d-fallback">
          <span>{error}</span>
          <button type="button" onClick={props.onExit}>
            返回二维地图
          </button>
        </div>
      )}
      {!error && (
        <div className="map3d-hud">
          <div className="map3d-hud-title">
            <Icon name="layers" size={14} />
            <span>三维城市地图</span>
            <span className="map3d-hud-sub">DEM 地形 · 建筑体块 · 淹没水面</span>
          </div>
          <div className="map3d-hud-actions">
            <button type="button" onClick={() => props.onToggleFlood(!props.floodDemo)}>
              <Icon name={props.floodDemo ? 'pause' : 'play'} size={12} />
              <span>{props.floodDemo ? '暂停水位演示' : '播放水位演示'}</span>
            </button>
            <button type="button" onClick={() => sceneRef.current?.resetView()}>
              <Icon name="reset" size={12} />
              <span>复位视角</span>
            </button>
            <button type="button" onClick={props.onExit}>
              <Icon name="chevron" size={12} />
              <span>返回二维</span>
            </button>
          </div>
          <div className="map3d-hud-tip">左键旋转 · 滚轮缩放 · 右键平移</div>
        </div>
      )}
    </div>
  )
}
