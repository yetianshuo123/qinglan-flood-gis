import type {
  AreaStats,
  CityData,
  FeatureDetail,
  LonLat,
  ModelResult,
  Scenario,
} from '../gis/types'
import type {
  CompareResult,
  OverlayFinding,
  PointQuery,
  ScenarioSnapshot,
} from '../gis/analysis'
import {
  formatArea,
  formatDepth,
  formatLength,
  riskName,
} from '../gis/analysis'
import type { DiffMode } from '../gis/rasters'
import { RISK_RAMP } from '../gis/rasters'
import { RISK_LABELS } from '../gis/model'
import type { SelectionInfo, PanelMode } from '../uiTypes'
import { Icon, type IconName } from './Icon'

export type TabId = 'attrs' | 'stats' | 'overlay' | 'scenario' | 'compare'

interface InspectorPanelProps {
  tab: TabId
  onTab: (t: TabId) => void
  city: CityData
  model: ModelResult
  selection: SelectionInfo | null
  detail: FeatureDetail | null
  onClearSelection: () => void
  pointPick: LonLat | null
  pointInfo: PointQuery | null
  onPickPoint: () => void
  queryRing: LonLat[] | null
  areaStats: AreaStats | null
  onDrawRing: () => void
  onClearQuery: () => void
  onLocate: (p: LonLat) => void
  findings: OverlayFinding[]
  draft: { rainMmH: number; durationH: number }
  onDraft: (patch: Partial<{ rainMmH: number; durationH: number }>) => void
  onApply: () => void
  onPreset: (mm: number) => void
  dirty: boolean
  baseline: ScenarioSnapshot | null
  compare: CompareResult | null
  onSaveBaseline: () => void
  onClearBaseline: () => void
  diffVisible: boolean
  onDiffVisible: (v: boolean) => void
  diffMode: DiffMode
  onDiffMode: (m: DiffMode) => void
  mode: PanelMode
  onMode: (m: PanelMode) => void
}

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'attrs', label: '属性', icon: 'cursor' },
  { id: 'stats', label: '统计', icon: 'chart' },
  { id: 'overlay', label: '叠加', icon: 'layers' },
  { id: 'scenario', label: '情景', icon: 'sliders' },
  { id: 'compare', label: '对比', icon: 'compare' },
]

const TAB_META: Record<TabId, { title: string; desc: string }> = {
  attrs: { title: '要素属性', desc: '点选空间要素查看属性与空间关系' },
  stats: { title: '空间查询与统计', desc: '点查询或绘制区域，统计结果由栅格与矢量实时计算' },
  overlay: { title: '图层叠加分析', desc: '低洼 / 积水 / 道路 / 建筑 / 降雨的空间关系' },
  scenario: { title: '降雨情景模拟', desc: '调整降雨参数，重新运行简化内涝模型' },
  compare: { title: '情景对比', desc: '与已保存基准情景比较空间响应差异' },
}

export default function InspectorPanel(props: InspectorPanelProps) {
  const meta = TAB_META[props.tab]

  if (props.mode === 'closed') {
    return (
      <button
        type="button"
        className="panel-reopen panel-reopen--right"
        title="展开分析面板"
        onClick={() => props.onMode('open')}
      >
        <Icon name="chevron" size={12} className="chevron-flip" />
        分析面板
      </button>
    )
  }

  if (props.mode === 'collapsed') {
    return (
      <aside className="side-panel right-panel is-collapsed">
        <div className="panel-rail">
          <button
            type="button"
            className="icon-btn"
            title="展开分析面板"
            onClick={() => props.onMode('open')}
          >
            <Icon name="chevron" size={14} className="chevron-flip" />
          </button>
          <span className="panel-rail-label">分析面板</span>
          <button
            type="button"
            className="icon-btn"
            title="关闭分析面板"
            onClick={() => props.onMode('closed')}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="side-panel right-panel">
      <div className="panel-head">
        <div>
          <h2>{meta.title}</h2>
          <p>{meta.desc}</p>
        </div>
        <div className="panel-actions">
          <button
            type="button"
            className="icon-btn"
            title="折叠面板"
            onClick={() => props.onMode('collapsed')}
          >
            <Icon name="chevron" size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="关闭面板"
            onClick={() => props.onMode('closed')}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={props.tab === t.id}
            className={`tab-btn${props.tab === t.id ? ' is-active' : ''}`}
            onClick={() => props.onTab(t.id)}
          >
            <Icon name={t.icon} size={14} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="panel-body inspector-body">
        {props.tab === 'attrs' && <AttrsTab {...props} />}
        {props.tab === 'stats' && <StatsTab {...props} />}
        {props.tab === 'overlay' && <OverlayTab {...props} />}
        {props.tab === 'scenario' && <ScenarioTab {...props} />}
        {props.tab === 'compare' && <CompareTab {...props} />}
      </div>

      <div className="panel-foot">
        <Icon name="info" size={13} />
        <span>简化城市内涝模型 · 非水动力模型 · 不可用于真实灾害预测</span>
      </div>
    </aside>
  )
}

/* ------------------------------ 属性 ------------------------------ */

function AttrsTab(props: InspectorPanelProps) {
  if (!props.detail) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <Icon name="cursor" size={26} />
        </div>
        <h3>在地图上点选空间要素</h3>
        <p>点击建筑、道路、河流、排水渠、泵站、绿地、低洼区或行政分区，右侧将显示该要素的真实属性与当前情景下的空间关系。</p>
        <div className="stat-grid stat-grid--2">
          <Metric label="建筑物" value={`${props.city.buildings.features.length} 栋`} />
          <Metric label="道路" value={`${props.city.roads.features.length} 条`} />
          <Metric label="低洼区" value={`${props.city.lowlands.features.length} 处`} />
          <Metric
            label="水系设施"
            value={`${props.city.hydro.features.length + props.city.pumps.features.length} 处`}
          />
        </div>
      </div>
    )
  }

  const d = props.detail
  return (
    <div className="detail">
      <div className="detail-head">
        <div className="detail-tag-row">
          <span className="kind-tag">{d.kind}</span>
          <span className="detail-id">{d.id}</span>
          <button type="button" className="text-btn" onClick={props.onClearSelection}>
            <Icon name="close" size={12} />
            清除选择
          </button>
        </div>
        <h3>{d.title}</h3>
        <p className="detail-sub">{d.subtitle}</p>
      </div>

      {d.sections.map((section) => (
        <div className="detail-section" key={section.title}>
          <h4>{section.title}</h4>
          <dl className="kv-list">
            {section.rows.map((r) => (
              <div className="kv" key={r.label}>
                <dt>{r.label}</dt>
                <dd className={r.tone ? `tone-${r.tone}` : ''}>{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {d.note && <p className="note">{d.note}</p>}
    </div>
  )
}

/* ------------------------------ 统计 ------------------------------ */

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'warn' | 'danger' | 'ok'
}) {
  return (
    <div className={`metric${tone ? ` tone-border-${tone}` : ''}`}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {sub && <span className="metric-sub">{sub}</span>}
    </div>
  )
}

function StatsTab(props: InspectorPanelProps) {
  const stats = props.areaStats
  const point = props.pointInfo

  return (
    <div className="stats-tab">
      <div className="action-row">
        <button
          type="button"
          className={`action-btn${props.pointPick ? ' is-active' : ''}`}
          onClick={props.onPickPoint}
        >
          <Icon name="query-point" size={14} />
          点查询
        </button>
        <button
          type="button"
          className={`action-btn${props.queryRing ? ' is-active' : ''}`}
          onClick={props.onDrawRing}
        >
          <Icon name="query-polygon" size={14} />
          {props.queryRing ? '重新绘制区域' : '绘制查询区域'}
        </button>
        {(props.queryRing || props.pointPick) && (
          <button type="button" className="action-btn is-ghost" onClick={props.onClearQuery}>
            <Icon name="trash" size={13} />
            清除
          </button>
        )}
      </div>

      {point && (
        <div className="detail-section">
          <div className="section-title-row">
            <h4>点查询结果</h4>
            <span className="coord-tag">
              {point.lon.toFixed(5)}°E {point.lat.toFixed(5)}°N
            </span>
          </div>
          <dl className="kv-list">
            <div className="kv">
              <dt>地形高程</dt>
              <dd>{point.elevation.toFixed(2)} m</dd>
            </div>
            <div className="kv">
              <dt>模拟降雨强度</dt>
              <dd>{point.rainMmH.toFixed(1)} mm/h</dd>
            </div>
            <div className="kv">
              <dt>积水深度</dt>
              <dd className={point.depth >= 0.18 ? 'tone-danger' : point.depth >= 0.03 ? 'tone-warn' : 'tone-ok'}>
                {formatDepth(point.depth)}
              </dd>
            </div>
            <div className="kv">
              <dt>内涝风险</dt>
              <dd className={point.risk >= 3 ? 'tone-danger' : point.risk >= 2 ? 'tone-warn' : ''}>
                {riskName(point.risk)}
              </dd>
            </div>
            <div className="kv">
              <dt>所在分区</dt>
              <dd>{point.district ?? '—'}</dd>
            </div>
            <div className="kv">
              <dt>所在低洼区</dt>
              <dd className={point.lowlands.length ? 'tone-warn' : ''}>
                {point.lowlands.length ? point.lowlands.join('、') : '不在低洼区内'}
              </dd>
            </div>
            <div className="kv">
              <dt>距最近积水网格</dt>
              <dd>
                {!Number.isFinite(point.floodedDistanceM)
                  ? '全城无积水'
                  : point.floodedDistanceM === 0
                    ? '位于积水区内'
                    : formatLength(point.floodedDistanceM)}
              </dd>
            </div>
            <div className="kv">
              <dt>最近道路</dt>
              <dd>
                {point.nearestRoad
                  ? `${point.nearestRoad.name} · ${formatLength(point.nearestRoad.distance)}`
                  : '—'}
              </dd>
            </div>
            <div className="kv">
              <dt>最近水系</dt>
              <dd>
                {point.nearestHydro
                  ? `${point.nearestHydro.name} · ${formatLength(point.nearestHydro.distance)}`
                  : '—'}
              </dd>
            </div>
            <div className="kv">
              <dt>最近建筑</dt>
              <dd>
                {point.nearestBuilding
                  ? `${point.nearestBuilding.name}（${point.nearestBuilding.buildingType}）· ${formatLength(point.nearestBuilding.distance)}`
                  : '—'}
              </dd>
            </div>
          </dl>
          <p className="note">点查询直接采样当前情景的高程、降雨、积水与风险栅格，并计算邻近矢量要素距离。</p>
        </div>
      )}

      {stats ? (
        <AreaStatsView stats={stats} scenario={props.model.scenario} onLocate={props.onLocate} />
      ) : (
        !point && (
          <div className="empty-state">
            <div className="empty-icon">
              <Icon name="query-polygon" size={26} />
            </div>
            <h3>在地图上定义查询区域</h3>
            <p>使用「绘制查询区域」在地图上勾画多边形，或使用「点查询」采样任意位置。统计结果全部由已加载的高程、降雨、积水栅格与道路、建筑矢量实时计算。</p>
          </div>
        )
      )}
    </div>
  )
}

function AreaStatsView({
  stats,
  scenario,
  onLocate,
}: {
  stats: AreaStats
  scenario: Scenario
  onLocate: (p: LonLat) => void
}) {
  const total = stats.areaM2 || 1
  const floodedPct = (stats.floodedAreaM2 / total) * 100
  const affectedRoads = stats.roads.filter((r) => r.floodedLengthM > 0).length
  return (
    <div className="area-stats">
      <div className="section-title-row">
        <h4>区域统计</h4>
        <span className="coord-tag">{scenario.label}</span>
      </div>

      <div className="stat-grid stat-grid--2">
        <Metric label="区域面积" value={formatArea(stats.areaM2)} sub={`${stats.cellCount} 个栅格中心落区`} />
        <Metric
          label="平均高程"
          value={stats.avgElev == null ? '—' : `${stats.avgElev.toFixed(2)} m`}
          sub={stats.minElev == null ? '' : `最低 ${stats.minElev.toFixed(2)} m`}
        />
        <Metric
          label="最高高程"
          value={stats.maxElev == null ? '—' : `${stats.maxElev.toFixed(2)} m`}
          sub={stats.maxElev != null && stats.minElev != null ? `高差 ${(stats.maxElev - stats.minElev).toFixed(2)} m` : ''}
        />
        <Metric
          label="平均雨强"
          value={stats.meanRainMmH == null ? '—' : `${stats.meanRainMmH.toFixed(1)} mm/h`}
          sub={stats.totalRainMm == null ? '' : `总雨量 ${stats.totalRainMm.toFixed(1)} mm`}
        />
        <Metric
          label="平均积水"
          value={stats.avgDepth == null ? '—' : formatDepth(stats.avgDepth)}
          sub={stats.maxDepth == null ? '' : `最大 ${formatDepth(stats.maxDepth)}`}
        />
        <Metric
          label="积水面积"
          value={formatArea(stats.floodedAreaM2)}
          sub={`占区域 ${floodedPct.toFixed(1)}%`}
          tone={floodedPct > 20 ? 'danger' : floodedPct > 5 ? 'warn' : 'ok'}
        />
        <Metric label="涉及道路" value={`${stats.roads.length} 条`} sub={`受影响 ${affectedRoads} 条`} />
        <Metric
          label="涉及建筑"
          value={`${stats.buildings.length} 栋`}
          sub={`受影响 ${stats.floodedBuildings} 栋`}
        />
      </div>

      <div className="detail-section">
        <h4>风险等级面积分布</h4>
        <div className="risk-bars">
          {[1, 2, 3, 4].map((level) => {
            const area = stats.riskAreaM2[level] ?? 0
            const pct = (area / total) * 100
            return (
              <div className="risk-bar-row" key={level}>
                <span className="risk-bar-label">
                  <i className="swatch" style={{ background: RISK_RAMP[level].color }} />
                  {RISK_LABELS[level]}
                </span>
                <span className="risk-bar-track">
                  <i
                    className="risk-bar-fill"
                    style={{
                      width: `${Math.max(pct > 0 ? 2 : 0, Math.min(100, pct))}%`,
                      background: RISK_RAMP[level].color,
                    }}
                  />
                </span>
                <span className="risk-bar-value">
                  {formatArea(area)} <em>{pct.toFixed(1)}%</em>
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="detail-section">
        <h4>道路与路段统计</h4>
        <dl className="kv-list">
          <div className="kv">
            <dt>区域内道路总长</dt>
            <dd>{formatLength(stats.roadLengthInAreaM)}</dd>
          </div>
          <div className="kv">
            <dt>积水路段长度</dt>
            <dd className={stats.floodedRoadLengthM > 0 ? 'tone-warn' : ''}>
              {formatLength(stats.floodedRoadLengthM)}
            </dd>
          </div>
          <div className="kv">
            <dt>受影响道路</dt>
            <dd>
              {stats.roads
                .filter((r) => r.floodedLengthM > 0)
                .map((r) => r.name)
                .join('、') || '无'}
            </dd>
          </div>
        </dl>
      </div>

      {stats.deepestPoint && (
        <button
          type="button"
          className="locate-btn"
          onClick={() => onLocate(stats.deepestPoint as LonLat)}
        >
          <Icon name="locate" size={14} />
          定位最深积水点（{formatDepth(stats.maxDepth ?? 0)}）
        </button>
      )}

      <p className="note">
        区域统计以栅格中心落入多边形为准，按每个网格的实际面积加权；道路按 30 m 采样、建筑按基底中心判定。
      </p>
    </div>
  )
}

/* ------------------------------ 叠加分析 ------------------------------ */

function OverlayTab(props: InspectorPanelProps) {
  return (
    <div className="overlay-tab">
      {props.findings.map((f, i) => (
        <article className="finding" key={f.id}>
          <header className="finding-head">
            <span className="finding-index">{String(i + 1).padStart(2, '0')}</span>
            <h3>{f.title}</h3>
          </header>
          <p className="finding-summary">{f.summary}</p>
          <div className="metric-pills">
            {f.metrics.map((m) => (
              <span className={`pill${m.tone ? ` pill-${m.tone}` : ''}`} key={m.label}>
                <em>{m.label}</em>
                {m.value}
              </span>
            ))}
          </div>
          {f.locate && (
            <button type="button" className="locate-btn" onClick={() => props.onLocate(f.locate as LonLat)}>
              <Icon name="locate" size={14} />
              定位到地图
            </button>
          )}
          <details className="finding-detail">
            <summary>分析方法与明细</summary>
            <p className="finding-method">{f.method}</p>
            <ul className="locate-list">
              {f.details.map((d) => (
                <li key={d.label}>
                  <button type="button" onClick={() => props.onLocate(d.point)}>
                    <span>{d.label}</span>
                    <span className="locate-value">{d.value}</span>
                    <Icon name="locate" size={11} />
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </article>
      ))}
    </div>
  )
}

/* ------------------------------ 情景模拟 ------------------------------ */

const PRESETS = [
  { label: '低降雨', mm: 25 },
  { label: '中降雨', mm: 50 },
  { label: '高降雨', mm: 85 },
]

function ScenarioTab(props: InspectorPanelProps) {
  const m = props.model.metrics
  const active = props.model.scenario
  return (
    <div className="scenario-tab">
      <div className="scenario-presets">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={`preset-btn${active.rainMmH === p.mm ? ' is-active' : ''}`}
            onClick={() => props.onPreset(p.mm)}
          >
            <strong>{p.label}</strong>
            <span>{p.mm} mm/h</span>
          </button>
        ))}
      </div>

      <div className="slider-field">
        <div className="slider-head">
          <label htmlFor="rain-slider">降雨强度</label>
          <span className="slider-value">{props.draft.rainMmH} mm/h</span>
        </div>
        <input
          id="rain-slider"
          type="range"
          min={10}
          max={120}
          step={5}
          value={props.draft.rainMmH}
          onChange={(e) => props.onDraft({ rainMmH: Number(e.target.value) })}
        />
        <div className="slider-scale">
          <span>10</span>
          <span>50</span>
          <span>85</span>
          <span>120</span>
        </div>
      </div>

      <div className="slider-field">
        <div className="slider-head">
          <label htmlFor="duration-slider">降雨历时</label>
          <span className="slider-value">{props.draft.durationH.toFixed(1)} h</span>
        </div>
        <input
          id="duration-slider"
          type="range"
          min={0.5}
          max={6}
          step={0.5}
          value={props.draft.durationH}
          onChange={(e) => props.onDraft({ durationH: Number(e.target.value) })}
        />
        <div className="slider-scale">
          <span>0.5 h</span>
          <span>3 h</span>
          <span>6 h</span>
        </div>
      </div>

      <button
        type="button"
        className={`run-btn${props.dirty ? ' is-dirty' : ''}`}
        disabled={!props.dirty}
        onClick={props.onApply}
      >
        <Icon name={props.dirty ? 'play' : 'info'} size={15} />
        {props.dirty ? `运行情景模拟（${props.draft.rainMmH} mm/h · ${props.draft.durationH} h）` : '当前参数已应用'}
      </button>

      <div className="section-title-row">
        <h4>当前情景结果</h4>
        <span className="coord-tag">{active.label}</span>
      </div>

      <div className="stat-grid stat-grid--2">
        <Metric
          label="积水面积"
          value={`${(m.floodedAreaM2 / 10000).toFixed(1)} ha`}
          sub={`占全城 ${m.floodedPct}%`}
          tone={m.floodedPct > 12 ? 'danger' : m.floodedPct > 4 ? 'warn' : 'ok'}
        />
        <Metric
          label="高风险及以上"
          value={`${(m.highRiskAreaM2 / 10000).toFixed(1)} ha`}
          sub="水深 ≥ 18 cm"
        />
        <Metric label="最大积水深度" value={`${m.maxDepth.toFixed(2)} m`} />
        <Metric label="积水区平均水深" value={formatDepth(m.meanDepthFlooded)} />
        <Metric
          label="受影响道路"
          value={`${m.affectedRoads.length} 条`}
          sub={`共 ${props.city.roads.features.length} 条道路`}
        />
        <Metric
          label="受影响建筑"
          value={`${m.affectedBuildings.length} 栋`}
          sub={`共 ${props.city.buildings.features.length} 栋`}
        />
      </div>

      {m.affectedRoads.length > 0 && (
        <div className="detail-section">
          <h4>积水最严重的道路</h4>
          <div className="impact-list">
            {m.affectedRoads.slice(0, 5).map((r) => (
              <button type="button" className="impact-row" key={r.id} onClick={() => props.onLocate(r.point)}>
                <span className="impact-name">{r.name}</span>
                <span className="impact-meta">
                  {formatLength(r.floodedLengthM)} 积水 · 最深 {formatDepth(r.maxDepth)}
                </span>
                <Icon name="locate" size={12} />
              </button>
            ))}
          </div>
        </div>
      )}

      {m.affectedBuildings.length > 0 && (
        <div className="detail-section">
          <h4>受影响的建筑</h4>
          <div className="impact-list">
            {m.affectedBuildings.slice(0, 5).map((b) => (
              <button type="button" className="impact-row" key={b.id} onClick={() => props.onLocate(b.point)}>
                <span className="impact-name">{b.name}</span>
                <span className="impact-meta">
                  {b.buildingType} · {formatDepth(b.depth)} · {riskName(b.risk)}
                </span>
                <Icon name="locate" size={12} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="model-note">
        <h4>
          <Icon name="info" size={13} />
          简化模型假设
        </h4>
        <ul>
          <li>净雨 = max(0, 降雨强度 × 历时 − 下渗量) × 径流系数，并按河道、排水渠、泵站与坡度的距离衰减扣除排水能力。</li>
          <li>积水深度由净雨余量与地形易涝度（局部低洼、坡度、D8 汇流集中度、洼地范围）非线性放大，并限制最大深度。</li>
          <li>风险等级按积水深度阈值 3 / 8 / 18 / 35 cm 划分。</li>
          <li>模型不含水动力演进、管网水力与二维漫流，仅用于虚拟城市的空间关系演示，<strong>不能用于真实内涝灾害预测</strong>。</li>
        </ul>
      </div>
    </div>
  )
}

/* ------------------------------ 情景对比 ------------------------------ */

function CompareTab(props: InspectorPanelProps) {
  if (!props.baseline || !props.compare) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <Icon name="compare" size={26} />
        </div>
        <h3>尚未保存基准情景</h3>
        <p>将当前降雨情景保存为基准，再运行新的降雨情景，即可比较积水面积、高风险区域、受影响道路与建筑的变化，并在地图上叠加差异图层。</p>
        <button type="button" className="run-btn" onClick={props.onSaveBaseline}>
          <Icon name="save" size={15} />
          保存当前情景为基准
        </button>
      </div>
    )
  }

  const rows = props.compare.rows
  const allSame = rows.every((r) => Math.abs(r.delta) < 1e-9)
  return (
    <div className="compare-tab">
      <div className="baseline-card">
        <div className="baseline-info">
          <span className="baseline-label">基准情景</span>
          <strong>{props.baseline.model.scenario.label}</strong>
          <span className="baseline-time">保存于 {formatTime(props.baseline.savedAt)}</span>
        </div>
        <div className="baseline-actions">
          <button type="button" className="text-btn" onClick={props.onSaveBaseline}>
            <Icon name="save" size={12} />
            更新基准
          </button>
          <button type="button" className="text-btn" onClick={props.onClearBaseline}>
            <Icon name="close" size={12} />
            清除
          </button>
        </div>
      </div>

      <div className="diff-panel">
        <label className="switch-row">
          <input
            type="checkbox"
            checked={props.diffVisible}
            onChange={(e) => props.onDiffVisible(e.target.checked)}
          />
          <span>在地图上显示差异图层</span>
        </label>
        <div className="segmented">
          <button
            type="button"
            className={props.diffMode === 'depth' ? 'is-active' : ''}
            onClick={() => props.onDiffMode('depth')}
          >
            积水深度差异
          </button>
          <button
            type="button"
            className={props.diffMode === 'risk' ? 'is-active' : ''}
            onClick={() => props.onDiffMode('risk')}
          >
            风险等级差异
          </button>
        </div>
        <div className="diff-legend">
          {props.diffMode === 'depth' ? (
            <>
              <span><i style={{ background: '#be3428' }} />积水加深</span>
              <span><i style={{ background: '#206c92' }} />积水变浅</span>
            </>
          ) : (
            <>
              <span><i style={{ background: '#df5a39' }} />风险上升</span>
              <span><i style={{ background: '#18847c' }} />风险下降</span>
            </>
          )}
        </div>
      </div>

      {allSame && <p className="note">当前已应用情景与基准一致，差异图层无变化。调整降雨参数并运行模拟后再观察对比结果。</p>}

      <table className="compare-table">
        <thead>
          <tr>
            <th>指标</th>
            <th>基准</th>
            <th>当前</th>
            <th>变化</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.format(row.before)}</td>
              <td>{row.format(row.after)}</td>
              <td className={deltaClass(row.delta)}>
                {deltaText(row.delta, row.format)}
                {row.before > 0 && Math.abs(row.delta) > 1e-9 && (
                  <em>{row.deltaPct > 0 ? '+' : ''}{row.deltaPct.toFixed(1)}%</em>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="detail-section">
        <h4>新增受影响道路（{props.compare.newRoads.length}）</h4>
        {props.compare.newRoads.length ? (
          <div className="impact-list">
            {props.compare.newRoads.map((r) => (
              <button type="button" className="impact-row" key={r.id} onClick={() => props.onLocate(r.point)}>
                <span className="impact-name">{r.name}</span>
                <span className="impact-meta">
                  {formatLength(r.floodedLengthM)} · 最深 {formatDepth(r.maxDepth)}
                </span>
                <Icon name="locate" size={12} />
              </button>
            ))}
          </div>
        ) : (
          <p className="small-empty">无新增受影响道路</p>
        )}
      </div>

      <div className="detail-section">
        <h4>新增受影响建筑（{props.compare.newBuildings.length}）</h4>
        {props.compare.newBuildings.length ? (
          <div className="impact-list">
            {props.compare.newBuildings.slice(0, 12).map((b) => (
              <button type="button" className="impact-row" key={b.id} onClick={() => props.onLocate(b.point)}>
                <span className="impact-name">{b.name}</span>
                <span className="impact-meta">
                  {b.buildingType} · {formatDepth(b.depth)} · {riskName(b.risk)}
                </span>
                <Icon name="locate" size={12} />
              </button>
            ))}
          </div>
        ) : (
          <p className="small-empty">无新增受影响建筑</p>
        )}
      </div>

      {props.compare.removedRoads.length > 0 && (
        <p className="note">
          较基准情景减少受影响道路 {props.compare.removedRoads.length} 条：
          {props.compare.removedRoads.map((r) => r.name).join('、')}
        </p>
      )}
    </div>
  )
}

function deltaClass(delta: number): string {
  if (Math.abs(delta) < 1e-9) return 'delta-flat'
  return delta > 0 ? 'delta-bad' : 'delta-good'
}

function deltaText(delta: number, format: (v: number) => string): string {
  if (Math.abs(delta) < 1e-9) return '无变化'
  return `${delta > 0 ? '+' : '−'}${format(Math.abs(delta))}`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds(),
  ).padStart(2, '0')}`
}
