import type { CursorInfo } from '../uiTypes'
import type { Scenario } from '../gis/types'
import { formatDepth, riskName } from '../gis/analysis'
import { RISK_RAMP } from '../gis/rasters'
import { Icon } from './Icon'

interface StatusBarProps {
  cursor: CursorInfo | null
  zoom: number
  scaleText: string
  scenario: Scenario
}

export default function StatusBar(props: StatusBarProps) {
  const { cursor } = props
  const risk = cursor?.risk ?? 0
  const color = RISK_RAMP[risk]?.level === 0 ? '#7d8f9b' : RISK_RAMP[risk]?.color ?? '#7d8f9b'

  return (
    <footer className="status-bar">
      <span className="status-coord" title="光标经纬度">
        {cursor
          ? `${cursor.lon.toFixed(5)}°E  ${cursor.lat.toFixed(5)}°N`
          : '光标移出分析区'}
      </span>
      <span className="status-sep" />
      <span className="status-item" title="地形高程">
        <span className="status-key">高程</span>
        {cursor ? `${cursor.elevation.toFixed(1)} m` : '—'}
      </span>
      <span className="status-item" title="当前情景积水深度">
        <span className="status-key">积水</span>
        {cursor ? formatDepth(cursor.depth) : '—'}
      </span>
      <span className="status-item" title="当前情景风险等级">
        <span className="status-key">风险</span>
        <i className="status-dot" style={{ background: color }} />
        {cursor ? riskName(risk) : '—'}
      </span>
      <span className="status-item" title="当前情景雨强">
        <span className="status-key">雨强</span>
        {cursor ? `${cursor.rain.toFixed(0)} mm/h` : '—'}
      </span>
      <span className="status-sep" />
      <span className="status-item" title="地图缩放级别">
        <span className="status-key">Z</span>
        {props.zoom.toFixed(1)}
      </span>
      <span className="status-item" title="地图比例尺（近似）">
        <span className="status-key">比例尺</span>
        {props.scaleText}
      </span>

      <span className="status-spacer" />

      <span className="status-item status-scenario">
        <Icon name="sliders" size={12} />
        {props.scenario.label}
      </span>
      <span className="status-item status-model" title="简化内涝模型，非水动力模型">
        <Icon name="info" size={12} />
        简化模型 · 非水动力
      </span>
    </footer>
  )
}
