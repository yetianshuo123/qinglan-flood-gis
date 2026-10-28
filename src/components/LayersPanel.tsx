import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  LAYER_GROUPS,
  LAYER_META,
  type LayerId,
  type LayerState,
  type LayerStates,
} from '../uiTypes'
import type { CityData, ModelResult } from '../gis/types'
import type { DiffMode } from '../gis/rasters'
import { DEPTH_CLASSES, RISK_RAMP } from '../gis/rasters'
import {
  BUILDING_COLORS,
  BUILDING_TYPES,
  ROAD_CLASS_STYLE,
} from '../gis/vectorStyles'
import { Icon } from './Icon'

interface LayersPanelProps {
  layerStates: LayerStates
  onChange: (id: LayerId, next: Partial<LayerState>) => void
  onReset: () => void
  city: CityData
  model: ModelResult
  hasBaseline: boolean
  diffVisible: boolean
  diffMode: DiffMode
  onDiffVisible: (v: boolean) => void
  onDiffMode: (m: DiffMode) => void
}

function LegendBlock({
  title,
  off,
  children,
}: {
  title: string
  off: boolean
  children: ReactNode
}) {
  return (
    <div className={`legend-block${off ? ' is-off' : ''}`}>
      <div className="legend-title">{title}</div>
      {children}
    </div>
  )
}

function LayersPanel(props: LayersPanelProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const elevMin = props.city.terrain.dem.min
  const elevMax = props.city.terrain.dem.max
  const rainMin = Math.round(props.model.rain.min)
  const rainMax = Math.round(props.model.rain.max)
  const off = (id: LayerId) => !props.layerStates[id].visible

  return (
    <aside className="side-panel left-panel">
      <div className="panel-head">
        <div>
          <h2>图层管理</h2>
          <p>9 个空间图层 · 虚拟城市数据</p>
        </div>
        <button
          type="button"
          className="icon-btn"
          title="恢复默认图层状态"
          onClick={props.onReset}
        >
          <Icon name="reset" size={15} />
        </button>
      </div>

      <div className="panel-body">
        {LAYER_GROUPS.map((group) => {
          const metas = LAYER_META.filter((m) => m.group === group)
          const open = !collapsed[group]
          return (
            <section className="layer-group" key={group}>
              <button
                type="button"
                className="group-head"
                onClick={() =>
                  setCollapsed((prev) => ({ ...prev, [group]: !prev[group] }))
                }
              >
                <Icon
                  name="chevron"
                  size={13}
                  className={open ? 'chev-open' : ''}
                />
                <span>{group}</span>
                <span className="group-count">{metas.length}</span>
              </button>

              {open &&
                metas.map((meta) => {
                  const state = props.layerStates[meta.id]
                  return (
                    <div
                      className={`layer-item${state.visible ? '' : ' is-off'}`}
                      key={meta.id}
                    >
                      <div className="layer-main">
                        <button
                          type="button"
                          className="layer-eye"
                          title={state.visible ? '隐藏图层' : '显示图层'}
                          onClick={() =>
                            props.onChange(meta.id, { visible: !state.visible })
                          }
                        >
                          <Icon
                            name={state.visible ? 'eye' : 'eye-off'}
                            size={14}
                          />
                        </button>
                        <div className="layer-label">
                          <span className="layer-name">{meta.name}</span>
                          <span className="layer-info">{meta.info}</span>
                        </div>
                        <span
                          className={`layer-kind ${
                            meta.kind === '栅格' ? 'is-raster' : 'is-vector'
                          }`}
                        >
                          {meta.kind}
                        </span>
                      </div>
                      <div className="layer-opacity">
                        <span className="opacity-label">透明度</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={Math.round(state.opacity * 100)}
                          onChange={(e) =>
                            props.onChange(meta.id, {
                              opacity: Number(e.target.value) / 100,
                            })
                          }
                        />
                        <span className="opacity-value">
                          {Math.round(state.opacity * 100)}%
                        </span>
                      </div>
                    </div>
                  )
                })}

              {group === '内涝专题' && props.hasBaseline && (
                <div
                  className={`layer-item diff-item${
                    props.diffVisible ? '' : ' is-off'
                  }`}
                >
                  <div className="layer-main">
                    <button
                      type="button"
                      className="layer-eye"
                      title="显示/隐藏情景差异图层"
                      onClick={() => props.onDiffVisible(!props.diffVisible)}
                    >
                      <Icon
                        name={props.diffVisible ? 'eye' : 'eye-off'}
                        size={14}
                      />
                    </button>
                    <div className="layer-label">
                      <span className="layer-name">情景差异</span>
                      <span className="layer-info">当前情景 vs 已保存基准</span>
                    </div>
                    <span className="layer-kind is-diff">对比</span>
                  </div>
                  <div className="diff-controls">
                    <button
                      type="button"
                      className={props.diffMode === 'depth' ? 'is-active' : ''}
                      onClick={() => props.onDiffMode('depth')}
                    >
                      积水深度
                    </button>
                    <button
                      type="button"
                      className={props.diffMode === 'risk' ? 'is-active' : ''}
                      onClick={() => props.onDiffMode('risk')}
                    >
                      风险等级
                    </button>
                  </div>
                </div>
              )}
            </section>
          )
        })}

        <section className="legend-section">
          <div className="legend-head">
            <span>图例</span>
            <span className="legend-hint">隐藏图层自动淡化</span>
          </div>

          <LegendBlock title="地形高程" off={off('terrain')}>
            <div
              className="legend-gradient"
              style={{
                background:
                  'linear-gradient(90deg,#e9e5d4,#dfe2cc,#cfd9b6,#b7cba1,#96b389,#76966f)',
              }}
            />
            <div className="legend-scale">
              <span>{elevMin.toFixed(1)} m</span>
              <span>{elevMax.toFixed(1)} m</span>
            </div>
          </LegendBlock>

          <LegendBlock title="降雨分布" off={off('rainfall')}>
            <div
              className="legend-gradient"
              style={{
                background:
                  'linear-gradient(90deg,rgba(176,215,238,0.35),rgba(40,96,178,0.9))',
              }}
            />
            <div className="legend-scale">
              <span>{rainMin} mm/h</span>
              <span>{rainMax} mm/h</span>
            </div>
          </LegendBlock>

          <LegendBlock title="积水深度" off={off('depth')}>
            <div className="legend-rows">
              {DEPTH_CLASSES.map((c) => (
                <div className="legend-row" key={c.label}>
                  <i
                    className="swatch"
                    style={{ background: c.color }}
                  />
                  <span>{c.label}</span>
                </div>
              ))}
            </div>
          </LegendBlock>

          <LegendBlock title="内涝风险" off={off('risk')}>
            <div className="legend-rows legend-rows--grid">
              {RISK_RAMP.slice(1).map((r) => (
                <div className="legend-row" key={r.level}>
                  <i className="swatch" style={{ background: r.color }} />
                  <span>{r.label.split(' ')[0]}</span>
                </div>
              ))}
            </div>
          </LegendBlock>

          <LegendBlock title="水系与排水设施" off={off('water')}>
            <div className="legend-rows">
              <div className="legend-row">
                <i className="line-swatch" style={{ height: 4, background: '#4aa0c9' }} />
                <span>河流（受纳水体）</span>
              </div>
              <div className="legend-row">
                <i
                  className="line-swatch"
                  style={{
                    height: 2,
                    background:
                      'repeating-linear-gradient(90deg,#54c3d2 0 5px,transparent 5px 9px)',
                  }}
                />
                <span>排水渠</span>
              </div>
              <div className="legend-row">
                <i className="pump-swatch" />
                <span>泵站</span>
              </div>
            </div>
          </LegendBlock>

          <LegendBlock title="道路" off={off('roads')}>
            <div className="legend-rows">
              {Object.entries(ROAD_CLASS_STYLE).map(([label, cfg]) => (
                <div className="legend-row" key={label}>
                  <i
                    className="line-swatch"
                    style={{ height: cfg.width, background: cfg.color }}
                  />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </LegendBlock>

          <LegendBlock title="建筑物" off={off('buildings')}>
            <div className="legend-rows legend-rows--grid">
              {BUILDING_TYPES.map((t) => (
                <div className="legend-row" key={t}>
                  <i className="swatch" style={{ background: BUILDING_COLORS[t] }} />
                  <span>{t}</span>
                </div>
              ))}
            </div>
          </LegendBlock>

          <LegendBlock title="低洼区域" off={off('lowland')}>
            <div className="legend-row">
              <i className="polygon-swatch lowland-swatch" />
              <span>易涝洼地边界</span>
            </div>
          </LegendBlock>

          <LegendBlock title="行政分区" off={off('districts')}>
            <div className="legend-row">
              <i className="boundary-swatch" />
              <span>虚拟分区边界</span>
            </div>
          </LegendBlock>

          {props.hasBaseline && (
            <LegendBlock title="情景差异" off={!props.diffVisible}>
              {props.diffMode === 'depth' ? (
                <div className="legend-rows">
                  <div className="legend-row">
                    <i className="swatch" style={{ background: 'rgba(190,52,40,0.85)' }} />
                    <span>积水加深</span>
                  </div>
                  <div className="legend-row">
                    <i className="swatch" style={{ background: 'rgba(32,108,146,0.85)' }} />
                    <span>积水变浅</span>
                  </div>
                </div>
              ) : (
                <div className="legend-rows">
                  <div className="legend-row">
                    <i className="swatch" style={{ background: 'rgba(223,90,57,0.85)' }} />
                    <span>风险等级上升</span>
                  </div>
                  <div className="legend-row">
                    <i className="swatch" style={{ background: 'rgba(24,132,124,0.85)' }} />
                    <span>风险等级下降</span>
                  </div>
                </div>
              )}
            </LegendBlock>
          )}
        </section>
      </div>

      <div className="panel-foot">
        <Icon name="info" size={13} />
        <span>所有图层均为虚拟城市模拟数据</span>
      </div>
    </aside>
  )
}

export default LayersPanel
