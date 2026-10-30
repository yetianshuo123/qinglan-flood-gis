import { useMemo, useState } from 'react'
import MapView from './components/MapView'
import Map3D from './components/Map3D'
import Toolbar from './components/Toolbar'
import LayersPanel from './components/LayersPanel'
import InspectorPanel, { type TabId } from './components/InspectorPanel'
import StatusBar from './components/StatusBar'
import { generateCity } from './gis/city'
import { runScenario } from './gis/model'
import type { ScenarioSnapshot } from './gis/analysis'
import {
  analyzeBuildingRisk,
  analyzeLowlandFlooding,
  analyzeRainDepth,
  analyzeRoadFlooding,
  buildFeatureDetail,
  compareScenarios,
  computeAreaStats,
  queryPoint,
  takeSnapshot,
} from './gis/analysis'
import type { DiffMode } from './gis/rasters'
import type { LonLat, ModelResult, Scenario } from './gis/types'
import type { CursorInfo, LayerId, LayerState, PanelMode, SelectionInfo, Tool } from './uiTypes'
import { makeDefaultLayerStates } from './uiTypes'
import './App.css'

const CITY = generateCity()

const INITIAL_DRAFT = { rainMmH: 50, durationH: 1 }
const INITIAL_SCENARIO: Scenario = {
  rainMmH: INITIAL_DRAFT.rainMmH,
  durationH: INITIAL_DRAFT.durationH,
  label: '50 mm/h · 1 h',
}

export default function App() {
  const [layerStates, setLayerStates] = useState(makeDefaultLayerStates)
  const [tool, setTool] = useState<Tool>('select')
  const [model, setModel] = useState<ModelResult>(() => runScenario(CITY, INITIAL_SCENARIO))
  const [draft, setDraft] = useState(INITIAL_DRAFT)
  const [tab, setTab] = useState<TabId>('attrs')
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const [queryRing, setQueryRing] = useState<LonLat[] | null>(null)
  const [pointPick, setPointPick] = useState<LonLat | null>(null)
  const [baseline, setBaseline] = useState<ScenarioSnapshot | null>(null)
  const [diffMode, setDiffMode] = useState<DiffMode>('depth')
  const [diffVisible, setDiffVisible] = useState(false)
  const [cursor, setCursor] = useState<CursorInfo | null>(null)
  const [viewState, setViewState] = useState({ zoom: 13.6, scaleText: '1:38,000' })
  const [focusPoint, setFocusPoint] = useState<{ point: LonLat; key: number } | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [clearKey, setClearKey] = useState(0)
  const [leftMode, setLeftMode] = useState<PanelMode>('open')
  const [rightMode, setRightMode] = useState<PanelMode>('open')
  const [buildingMinHeight, setBuildingMinHeight] = useState(0)
  const [floodDemo, setFloodDemo] = useState(false)
  const [view3d, setView3d] = useState(false)

  const detail = useMemo(
    () =>
      selection
        ? buildFeatureDetail(CITY, model, selection.kind, selection.props, selection.geometry)
        : null,
    [selection, model],
  )
  const areaStats = useMemo(
    () => (queryRing ? computeAreaStats(CITY, model, queryRing) : null),
    [queryRing, model],
  )
  const pointInfo = useMemo(
    () => (pointPick ? queryPoint(CITY, model, pointPick[0], pointPick[1]) : null),
    [pointPick, model],
  )
  const findings = useMemo(
    () => [
      analyzeLowlandFlooding(CITY, model),
      analyzeRoadFlooding(CITY, model),
      analyzeBuildingRisk(CITY, model),
      analyzeRainDepth(CITY, model),
    ],
    [model],
  )
  const comparison = useMemo(
    () => (baseline ? compareScenarios(baseline.model, model) : null),
    [baseline, model],
  )

  const dirty =
    draft.rainMmH !== model.scenario.rainMmH || draft.durationH !== model.scenario.durationH

  const applyScenario = (rainMmH: number, durationH: number) => {
    setModel(
      runScenario(CITY, {
        rainMmH,
        durationH,
        label: `${rainMmH} mm/h · ${durationH} h`,
      }),
    )
    setDraft({ rainMmH, durationH })
  }

  const handleTool = (next: Tool) => {
    setTool(next)
    if (next === 'query-polygon' || next === 'query-point') setTab('stats')
  }

  const handleSelect = (sel: SelectionInfo | null) => {
    setSelection(sel)
    setPointPick(null)
    if (sel) setTab('attrs')
  }

  const handleRing = (ring: LonLat[]) => {
    setQueryRing(ring)
    setPointPick(null)
    setSelection(null)
    setTool('select')
    setTab('stats')
  }

  const handlePoint = (p: LonLat) => {
    setPointPick(p)
    setQueryRing(null)
    setSelection(null)
    setTool('select')
    setTab('stats')
    setFocusPoint({ point: p, key: performance.now() })
  }

  const handleClear = () => {
    setSelection(null)
    setQueryRing(null)
    setPointPick(null)
    setTool('select')
    setClearKey((k) => k + 1)
  }

  const handleLocate = (p: LonLat) => {
    setFocusPoint({ point: p, key: performance.now() })
  }

  const handleLayerChange = (id: LayerId, patch: Partial<LayerState>) => {
    setLayerStates((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }))
  }

  const handleSaveBaseline = () => {
    setBaseline(takeSnapshot(model))
  }

  const handleClearBaseline = () => {
    setBaseline(null)
    setDiffVisible(false)
  }

  return (
    <div
      className={`app-shell panel-left-${leftMode} panel-right-${rightMode}`}
    >
      {view3d ? (
        <Map3D
          city={CITY}
          buildingMinHeight={buildingMinHeight}
          floodDemo={floodDemo}
          onExit={() => setView3d(false)}
          onToggleFlood={setFloodDemo}
        />
      ) : (
        <MapView
          city={CITY}
          model={model}
          layerStates={layerStates}
          tool={tool}
          selection={selection}
          queryRing={queryRing}
          focusPoint={focusPoint}
          resetKey={resetKey}
          clearKey={clearKey}
          diffVisible={diffVisible}
          diffMode={diffMode}
          baselineModel={baseline?.model ?? null}
          buildingMinHeight={buildingMinHeight}
          floodDemo={floodDemo}
          onCursor={setCursor}
          onSelect={handleSelect}
          onPointQuery={handlePoint}
          onRingDrawn={handleRing}
          onViewChange={setViewState}
        />
      )}

      <Toolbar
        tool={tool}
        onTool={handleTool}
        onReset={() => setResetKey((k) => k + 1)}
        onClear={handleClear}
        onOpenTab={setTab}
        scenarioLabel={model.scenario.label}
        hasBaseline={!!baseline}
        dirty={dirty}
        view3d={view3d}
        onView3d={setView3d}
      />

      <LayersPanel
        layerStates={layerStates}
        onChange={handleLayerChange}
        onReset={() => setLayerStates(makeDefaultLayerStates())}
        city={CITY}
        model={model}
        hasBaseline={!!baseline}
        diffVisible={diffVisible}
        diffMode={diffMode}
        onDiffVisible={setDiffVisible}
        onDiffMode={setDiffMode}
        buildingMinHeight={buildingMinHeight}
        onBuildingMinHeight={setBuildingMinHeight}
        floodDemo={floodDemo}
        onFloodDemo={setFloodDemo}
        mode={leftMode}
        onMode={setLeftMode}
      />

      <InspectorPanel
        tab={tab}
        onTab={setTab}
        city={CITY}
        model={model}
        selection={selection}
        detail={detail}
        onClearSelection={() => setSelection(null)}
        pointPick={pointPick}
        pointInfo={pointInfo}
        onPickPoint={() => handleTool('query-point')}
        queryRing={queryRing}
        areaStats={areaStats}
        onDrawRing={() => handleTool('query-polygon')}
        onClearQuery={() => {
          setQueryRing(null)
          setPointPick(null)
        }}
        onLocate={handleLocate}
        findings={findings}
        draft={draft}
        onDraft={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
        onApply={() => applyScenario(draft.rainMmH, draft.durationH)}
        onPreset={(mm) => applyScenario(mm, draft.durationH)}
        dirty={dirty}
        baseline={baseline}
        compare={comparison}
        onSaveBaseline={handleSaveBaseline}
        onClearBaseline={handleClearBaseline}
        diffVisible={diffVisible}
        onDiffVisible={setDiffVisible}
        diffMode={diffMode}
        onDiffMode={setDiffMode}
        mode={rightMode}
        onMode={setRightMode}
      />

      <StatusBar
        cursor={cursor}
        zoom={viewState.zoom}
        scaleText={viewState.scaleText}
        scenario={model.scenario}
      />
    </div>
  )
}
