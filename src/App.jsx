import React, { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Download,
  RotateCcw,
  Save,
  ShieldAlert,
  Thermometer,
  Wind,
  Gauge,
  ClipboardCheck,
  Trash2
} from 'lucide-react'

const STORAGE_KEY = 'commissioning_engine_v1_final'
const DRAFT_KEY = 'commissioning_engine_v1_draft'

const emptyPoint = (i) => ({
  pointId: `N${String(i).padStart(2, '0')}`,
  temperature: '',
  deltaP: '',
  staticPressure: '',
  hydraulicDiameter: ''
})

const initialForm = {
  measurementId: '',
  date: new Date().toISOString().slice(0, 10),
  startTime: '',
  equipmentZone: '',
  operator: '',
  externalHumidity: '',
  externalTemp: '',
  notes: '',
  checklist: {
    vibration: false,
    burnerNoise: false,
    doorSeal: false,
    nozzleAlignment: false
  },
  points: Array.from({ length: 10 }, (_, i) => emptyPoint(i + 1))
}

const computeThermo = (point) => {
  const tC = Number(point.temperature)
  const dp = Number(point.deltaP)
  const dh = Number(point.hydraulicDiameter)
  const pStatic = Number(point.staticPressure)

  if (![tC, dp, dh, pStatic].every(Number.isFinite)) {
    return null
  }

  const tK = tC + 273.15
  const rho = Math.max(0.1, pStatic / (287.05 * tK))
  const mu = 1.716e-5 * Math.pow(tK / 273.15, 1.5) * (383.55 / (tK + 110.4))
  const velocity = Math.sqrt(Math.max(0, (2 * dp) / rho))
  const reynolds = (rho * velocity * dh) / mu

  let regime = 'LAMINAR'
  if (reynolds >= 4000) regime = 'TURBULENT'
  else if (reynolds >= 2300) regime = 'TRANSITIONAL'

  return { tK, rho, mu, velocity, reynolds, regime, isoValid: reynolds >= 4000 }
}

const failureMatrix = [
  {
    when: (r) => r.reynolds < 2300,
    severity: 'FAIL',
    title: 'Laminar flow detected',
    symptom: 'ISO 3966 log-linear method is not valid below Re 2300.',
    cause: 'Velocity is too low or a restriction is present in the duct.',
    action: 'Stop the measurement, verify fan speed, and inspect duct obstruction.'
  },
  {
    when: (r) => r.reynolds >= 2300 && r.reynolds < 4000,
    severity: 'WARN',
    title: 'Transitional flow',
    symptom: 'The flow regime is marginal for final acceptance.',
    cause: 'Possible under-speed fan condition or partial nozzle blockage.',
    action: 'Repeat the scan after confirming VFD setpoint and nozzle condition.'
  },
  {
    when: (r) => r.rho < 0.72,
    severity: 'WARN',
    title: 'Low air density',
    symptom: 'Air density is below the nominal commissioning range.',
    cause: 'High temperature process or temperature sensor drift.',
    action: 'Check sensor calibration and confirm process temperature.'
  },
  {
    when: (r) => r.velocity > 25,
    severity: 'WARN',
    title: 'High velocity / probe risk',
    symptom: 'Pitot alignment or unit entry may be incorrect.',
    cause: 'Probe angle error or pressure value entered in the wrong unit.',
    action: 'Re-zero the manometer and confirm ΔP is entered in Pascal.'
  }
]

function useThermodynamics(points) {
  return useMemo(() => {
    return points
      .filter((p) => p.pointId.trim())
      .map((point) => {
        const result = computeThermo(point)
        return {
          ...point,
          result,
          issues: result ? failureMatrix.filter((rule) => rule.when(result)) : []
        }
      })
  }, [points])
}

function safeJSONParse(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function downloadBlob(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportCSV(rows) {
  const headers = ['pointId', 'temperature', 'deltaP', 'staticPressure', 'hydraulicDiameter', 'tK', 'rho', 'mu', 'velocity', 'reynolds', 'regime']
  const csvRows = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => {
      const value = row.result && ['tK','rho','mu','velocity','reynolds','regime'].includes(h)
        ? row.result[h]
        : row[h]
      return `"${String(value ?? '').replaceAll('"', '""')}"`
    }).join(','))
  ]
  return csvRows.join('\n')
}

export default function App() {
  const [form, setForm] = useState(initialForm)
  const [records, setRecords] = useState([])
  const [activeTab, setActiveTab] = useState('entry')
  const thermoRows = useThermodynamics(form.points)

  useEffect(() => {
    const saved = safeJSONParse(localStorage.getItem(STORAGE_KEY), null)
    const draft = safeJSONParse(localStorage.getItem(DRAFT_KEY), null)
    if (saved?.records) setRecords(saved.records)
    if (draft?.form) setForm(draft.form)
  }, [])

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ form }))
  }, [form])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ records }))
  }, [records])

  const summary = useMemo(() => {
    const firstResult = thermoRows.find((r) => r.result)?.result ?? null
    return {
      pointsMeasured: thermoRows.filter((r) => r.result).length,
      valid: firstResult?.isoValid ?? false,
      regime: firstResult?.regime ?? '—'
    }
  }, [thermoRows])

  const updateField = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))
  const updatePoint = (index, field, value) => {
    setForm((prev) => {
      const points = [...prev.points]
      points[index] = { ...points[index], [field]: value }
      return { ...prev, points }
    })
  }

  const toggleChecklist = (field) => {
    setForm((prev) => ({
      ...prev,
      checklist: { ...prev.checklist, [field]: !prev.checklist[field] }
    }))
  }

  const saveRecord = () => {
    const payload = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      form,
      thermoRows
    }
    setRecords((prev) => [payload, ...prev].slice(0, 100))
    setActiveTab('history')
  }

  const resetDraft = () => setForm(initialForm)

  const exportAll = (format) => {
    const payload = {
      exportedAt: new Date().toISOString(),
      form,
      thermoRows,
      records
    }
    if (format === 'json') {
      downloadBlob(`CommissioningEngine_${Date.now()}.json`, JSON.stringify(payload, null, 2), 'application/json')
      return
    }
    const csv = exportCSV(thermoRows)
    downloadBlob(`CommissioningEngine_${Date.now()}.csv`, csv, 'text/csv;charset=utf-8')
  }

  const loadRecord = (record) => setForm(record.form)
  const deleteRecord = (id) => setRecords((prev) => prev.filter((r) => r.id !== id))
  const clearAll = () => setRecords([])

  return (
    <div className="min-h-full bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-4 sm:px-6 lg:px-8">
        <header className="industrial-card p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-400">
                Commissioning Engine V1 Final
              </p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                E-Cure Thermodynamic Field Console
              </h1>
              <p className="max-w-2xl text-sm text-slate-400">
                Industrial dark mode, local persistence, exportable records, and responsive layout for tablet and phone use on the shop floor.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="industrial-chip border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                <Activity className="h-3.5 w-3.5" /> Offline-ready
              </span>
              <span className="industrial-chip border-sky-500/30 bg-sky-500/10 text-sky-300">
                <Save className="h-3.5 w-3.5" /> localStorage
              </span>
              <span className="industrial-chip border-amber-500/30 bg-amber-500/10 text-amber-300">
                <ClipboardCheck className="h-3.5 w-3.5" /> ISO 3966
              </span>
            </div>
          </div>
        </header>

        <nav className="industrial-card flex flex-wrap gap-2 p-2">
          {[
            ['entry', 'Data Entry'],
            ['results', 'Results'],
            ['history', 'History'],
            ['about', 'About']
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                activeTab === key
                  ? 'bg-cyan-500 text-slate-950'
                  : 'bg-slate-950/70 text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {activeTab === 'entry' && (
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <section className="space-y-6">
              <div className="industrial-card p-4 sm:p-6">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Header Identification
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="ID da Medição" value={form.measurementId} onChange={updateField('measurementId')} placeholder="MC-TOY-001" />
                  <Field label="Data" value={form.date} onChange={updateField('date')} type="date" />
                  <Field label="Hora de Início" value={form.startTime} onChange={updateField('startTime')} type="time" />
                  <Field label="Equipamento / Zona" value={form.equipmentZone} onChange={updateField('equipmentZone')} placeholder="E-Cure Zone B" />
                  <Field label="Operador" value={form.operator} onChange={updateField('operator')} placeholder="Nome e sobrenome" />
                  <Field label="Clima Externo: Umidade (%)" value={form.externalHumidity} onChange={updateField('externalHumidity')} type="number" placeholder="54" />
                  <Field label="Clima Externo: Temp (°C)" value={form.externalTemp} onChange={updateField('externalTemp')} type="number" placeholder="29" />
                </div>
              </div>

              <div className="industrial-card p-4 sm:p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Raw Data Table
                  </h2>
                  <span className="text-xs text-slate-500">D-GCH-2026</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-[860px] w-full border-separate border-spacing-y-2 text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        <th className="px-2 py-2">Point ID</th>
                        <th className="px-2 py-2">Temperature (°C)</th>
                        <th className="px-2 py-2">ΔP Pitot (Pa)</th>
                        <th className="px-2 py-2">Static Pressure (Pa)</th>
                        <th className="px-2 py-2">Hydraulic Diameter (m)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.points.map((point, index) => (
                        <tr key={point.pointId} className="rounded-xl bg-slate-950/70">
                          <td className="px-2 py-2">
                            <input
                              className="industrial-input w-24 px-3 py-2 text-sm"
                              value={point.pointId}
                              onChange={(e) => updatePoint(index, 'pointId', e.target.value)}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input className="industrial-input px-3 py-2 text-sm" type="number" value={point.temperature} onChange={(e) => updatePoint(index, 'temperature', e.target.value)} />
                          </td>
                          <td className="px-2 py-2">
                            <input className="industrial-input px-3 py-2 text-sm" type="number" value={point.deltaP} onChange={(e) => updatePoint(index, 'deltaP', e.target.value)} />
                          </td>
                          <td className="px-2 py-2">
                            <input className="industrial-input px-3 py-2 text-sm" type="number" value={point.staticPressure} onChange={(e) => updatePoint(index, 'staticPressure', e.target.value)} />
                          </td>
                          <td className="px-2 py-2">
                            <input className="industrial-input px-3 py-2 text-sm" type="number" step="0.001" value={point.hydraulicDiameter} onChange={(e) => updatePoint(index, 'hydraulicDiameter', e.target.value)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <aside className="space-y-6">
              <div className="industrial-card p-4 sm:p-6">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Quick Troubleshooting Checklist
                </h2>

                <div className="space-y-3">
                  <ChecklistRow checked={form.checklist.vibration} onClick={() => toggleChecklist('vibration')} label="Vibração excessiva no duto?" />
                  <ChecklistRow checked={form.checklist.burnerNoise} onClick={() => toggleChecklist('burnerNoise')} label="Ruído anormal no queimador?" />
                  <ChecklistRow checked={form.checklist.doorSeal} onClick={() => toggleChecklist('doorSeal')} label="Vedação da porta íntegra?" />
                  <ChecklistRow checked={form.checklist.nozzleAlignment} onClick={() => toggleChecklist('nozzleAlignment')} label="Bocal obstruído ou desalinhado?" />
                </div>

                <label className="mt-5 block">
                  <span className="industrial-label">Observações rápidas</span>
                  <textarea
                    className="industrial-input min-h-28 resize-y"
                    value={form.notes}
                    onChange={updateField('notes')}
                    placeholder="Anomalia, causa provável, ação imediata..."
                  />
                </label>
              </div>

              <div className="industrial-card p-4 sm:p-6">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Actions
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <ActionButton icon={<Save className="h-4 w-4" />} label="Save local record" onClick={saveRecord} />
                  <ActionButton icon={<Download className="h-4 w-4" />} label="Export JSON" onClick={() => exportAll('json')} />
                  <ActionButton icon={<Download className="h-4 w-4" />} label="Export CSV" onClick={() => exportAll('csv')} />
                  <ActionButton icon={<RotateCcw className="h-4 w-4" />} label="Reset draft" onClick={resetDraft} />
                </div>
              </div>

              <div className="industrial-card p-4 sm:p-6">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Live Summary
                </h2>
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  <MetricCard icon={<Thermometer className="h-4 w-4" />} label="Measured points" value={summary.pointsMeasured} />
                  <MetricCard icon={<Wind className="h-4 w-4" />} label="Flow regime" value={summary.regime} />
                  <MetricCard icon={<Gauge className="h-4 w-4" />} label="ISO 3966" value={summary.valid ? 'VALID' : 'PENDING'} />
                </div>
              </div>
            </aside>
          </div>
        )}

        {activeTab === 'results' && (
          <div className="space-y-6">
            <section className="industrial-card p-4 sm:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Thermodynamic Results
                </h2>
                <button
                  onClick={() => setActiveTab('entry')}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
                >
                  Back to Entry
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {thermoRows.map((row, index) => (
                  <div key={index} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-semibold text-cyan-300">{row.pointId || `N${index + 1}`}</span>
                      <span className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${row.result?.isoValid ? 'text-emerald-300' : 'text-amber-300'}`}>
                        {row.result ? row.result.regime : 'NO DATA'}
                      </span>
                    </div>
                    {row.result ? (
                      <div className="space-y-2 text-sm text-slate-300">
                        <Line label="ρ" value={`${row.result.rho.toFixed(4)} kg/m³`} />
                        <Line label="μ" value={`${row.result.mu.toExponential(2)} Pa·s`} />
                        <Line label="v" value={`${row.result.velocity.toFixed(3)} m/s`} />
                        <Line label="Re" value={`${Math.round(row.result.reynolds).toLocaleString()}`} />
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">Fill all numeric fields to calculate.</p>
                    )}

                    {row.issues.length > 0 && (
                      <div className="mt-4 space-y-2">
                        {row.issues.map((issue) => (
                          <div key={issue.title} className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100">
                            <div className="mb-1 font-semibold">{issue.severity} · {issue.title}</div>
                            <div>{issue.symptom}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'history' && (
          <section className="industrial-card p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
                Local History
              </h2>
              <button onClick={clearAll} className="rounded-xl border border-rose-500/30 px-4 py-2 text-sm text-rose-300 hover:bg-rose-500/10">
                Clear all
              </button>
            </div>

            {records.length === 0 ? (
              <p className="py-10 text-sm text-slate-500">No saved records yet.</p>
            ) : (
              <div className="space-y-3">
                {records.map((record) => (
                  <div key={record.id} className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-semibold text-slate-100">{record.form.measurementId || 'Unnamed record'}</div>
                      <div className="text-xs text-slate-500">
                        {new Date(record.createdAt).toLocaleString()} · {record.thermoRows.length} points
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => loadRecord(record)} className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
                        Load
                      </button>
                      <button onClick={() => deleteRecord(record.id)} className="rounded-xl border border-rose-500/30 px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10">
                        <Trash2 className="mr-2 inline h-4 w-4" /> Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === 'about' && (
          <section className="industrial-card p-4 sm:p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">About</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <InfoBox title="Engine" body="Thermodynamics calculation integrated with Reynolds classification and the failure matrix." />
              <InfoBox title="Persistence" body="Forms and measurement history are saved locally via localStorage." />
              <InfoBox title="Export" body="One-click export to JSON or CSV for Excel and downstream software." />
              <InfoBox title="Industrial UX" body="Responsive layout optimized for gloves, tablets, and factory-floor use." />
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <label className="block">
      <span className="industrial-label">{label}</span>
      <input className="industrial-input" type={type} value={value} onChange={onChange} placeholder={placeholder} />
    </label>
  )
}

function ChecklistRow({ checked, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
        checked ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100' : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-900'
      }`}
    >
      <span className="pr-3 text-sm">{label}</span>
      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] ${checked ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
        {checked ? 'Checked' : 'Empty'}
      </span>
    </button>
  )
}

function ActionButton({ icon, label, onClick }) {
  return (
    <button onClick={onClick} className="flex items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:border-cyan-500/40 hover:bg-slate-900">
      {icon}
      {label}
    </button>
  )
}

function MetricCard({ icon, label, value }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
        {icon}
        {label}
      </div>
      <div className="text-xl font-semibold text-slate-100">{value}</div>
    </div>
  )
}

function Line({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono text-slate-100">{value}</span>
    </div>
  )
}

function InfoBox({ title, body }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="mb-2 font-semibold text-slate-100">{title}</div>
      <p className="text-sm leading-6 text-slate-400">{body}</p>
    </div>
  )
}
