import type { Tool } from '../uiTypes'
import { Icon, type IconName } from './Icon'

interface ToolbarProps {
  tool: Tool
  onTool: (t: Tool) => void
  onReset: () => void
  onClear: () => void
  onOpenTab: (tab: 'scenario' | 'compare') => void
  scenarioLabel: string
  hasBaseline: boolean
  dirty: boolean
  /** 当前是否处于三维地图视图 */
  view3d: boolean
  onView3d: (on: boolean) => void
}

const TOOLS: { id: Tool; label: string; icon: IconName; hint: string }[] = [
  { id: 'select', label: '选择', icon: 'cursor', hint: '点选空间要素并查看属性' },
  { id: 'measure-distance', label: '测距', icon: 'ruler', hint: '在地图上绘制折线测量距离' },
  { id: 'measure-area', label: '测面积', icon: 'area', hint: '在地图上绘制多边形测量面积' },
  { id: 'query-polygon', label: '区域查询', icon: 'query-polygon', hint: '绘制多边形并统计区域内空间数据' },
  { id: 'query-point', label: '点查询', icon: 'query-point', hint: '点击任意位置采样栅格与邻近要素' },
]

export default function Toolbar(props: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="brand">
        <div className="brand-mark">
          <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path
              d="M16 4c5 6 8 9.6 8 13a8 8 0 11-16 0c0-3.4 3-7 8-13z"
              fill="rgba(56,189,248,0.18)"
              stroke="#4cc3e8"
              strokeWidth="1.6"
            />
            <path d="M9 15h14M12 11h8M12 19h8M16 15v8" stroke="rgba(148,214,238,0.75)" strokeWidth="1" />
          </svg>
        </div>
        <div className="brand-text">
          <h1>澜汀市城市内涝防治地理信息系统</h1>
          <p>
            <span className="badge-vritual">模拟数据</span>
          </p>
        </div>
      </div>

      <nav className="tool-group" aria-label="地图工具">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tool-btn${props.tool === t.id ? ' is-active' : ''}`}
            title={t.hint}
            onClick={() => props.onTool(t.id)}
          >
            <Icon name={t.icon} size={16} />
            <span>{t.label}</span>
          </button>
        ))}
        <span className="tool-divider" />
        <button
          type="button"
          className={`tool-btn${props.view3d ? ' is-active' : ''}`}
          title="切换三维城市地图视图"
          onClick={() => props.onView3d(!props.view3d)}
        >
          <Icon name="layers" size={16} />
          <span>3D 地图</span>
        </button>
        <button type="button" className="tool-btn tool-btn--ghost" title="清除选择与查询结果" onClick={props.onClear}>
          <Icon name="trash" size={15} />
          <span>清除</span>
        </button>
        <button type="button" className="tool-btn tool-btn--ghost" title="复位地图视图" onClick={props.onReset}>
          <Icon name="reset" size={15} />
          <span>复位</span>
        </button>
      </nav>

      <div className="toolbar-actions">
        <button
          type="button"
          className={`scenario-chip${props.dirty ? ' is-dirty' : ''}`}
          title="打开降雨情景模拟"
          onClick={() => props.onOpenTab('scenario')}
        >
          <Icon name="sliders" size={15} />
          <span className="scenario-chip-label">情景</span>
          <strong>{props.scenarioLabel}</strong>
          {props.dirty && <i className="dirty-dot" title="参数已修改，尚未运行" />}
        </button>
        <button
          type="button"
          className="scenario-chip scenario-chip--compare"
          title="打开情景对比"
          onClick={() => props.onOpenTab('compare')}
        >
          <Icon name="compare" size={15} />
          <span className="scenario-chip-label">对比</span>
          <strong>{props.hasBaseline ? '已有基准' : '未设基准'}</strong>
        </button>
      </div>
    </header>
  )
}
