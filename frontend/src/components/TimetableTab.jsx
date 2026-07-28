import { useEffect, useState } from 'react'
import { api } from '../api'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Generates a timetable for the whole school (every section + every
 * teacher together, so there are no cross-section conflicts — see
 * backend/app/services/solver.py, which already reads every class group
 * in the school in one solve) and displays it as a day x period grid,
 * either for the currently selected section or for a chosen teacher
 * across all their sections.
 */
export default function TimetableTab({ schoolId, classGroup, classGroups, teachers }) {
  const [periods, setPeriods] = useState([])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState('section') // 'section' | 'teacher'
  const [selectedTeacherId, setSelectedTeacherId] = useState(teachers[0]?.id ?? null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.listPeriods(schoolId).then(setPeriods).catch((err) => setError(err.message))
    setResult(null)
  }, [schoolId])

  useEffect(() => {
    if (!selectedTeacherId && teachers.length > 0) setSelectedTeacherId(teachers[0].id)
  }, [teachers, selectedTeacherId])

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    try {
      setResult(await api.generateTimetable(schoolId))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const days = [...new Set(periods.map((p) => p.day_of_week))].sort((a, b) => a - b)
  const orders = [...new Set(periods.map((p) => p.order))].sort((a, b) => a - b)

  function periodAt(day, order) {
    return periods.find((p) => p.day_of_week === day && p.order === order)
  }

  function entryFor(day, order) {
    const period = periodAt(day, order)
    if (!period || !result?.timetable) return null
    if (view === 'section') {
      return result.timetable.entries.find(
        (e) => e.period_id === period.id && e.class_group_id === classGroup.id
      )
    }
    return result.timetable.entries.find(
      (e) => e.period_id === period.id && e.teacher_id === selectedTeacherId
    )
  }

  const classGroupName = (id) => classGroups.find((c) => c.id === id)?.name

  const solved = result && (result.solver_status === 'optimal' || result.solver_status === 'feasible')

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium">Generate timetable</h3>
          <p className="mt-1 text-sm text-slate-500">
            Solves for the whole school at once, so teachers shared across
            sections never overlap.
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? 'Generating…' : 'Generate Timetable'}
        </button>
      </div>

      <div className="h-px bg-slate-200" />

      {loading && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-slate-500">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
          Solving the schedule — this can take a few seconds…
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && result && !solved && (
        <div className="max-w-xl rounded-lg border border-amber-300 bg-amber-50 p-5">
          <div className="font-medium text-amber-900">
            We couldn't build a conflict-free timetable
          </div>
          <ul className="mt-2 list-disc pl-5 text-sm text-amber-800">
            {result.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {!loading && solved && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-md border border-slate-300 p-0.5 text-xs">
              <button
                onClick={() => setView('section')}
                className={`rounded px-3 py-1 ${view === 'section' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
              >
                By Section
              </button>
              <button
                onClick={() => setView('teacher')}
                className={`rounded px-3 py-1 ${view === 'teacher' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
              >
                By Teacher
              </button>
            </div>
            {view === 'teacher' && (
              <select
                value={selectedTeacherId ?? ''}
                onChange={(e) => setSelectedTeacherId(Number(e.target.value))}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="border border-slate-200 px-3 py-2 text-left font-medium">Period</th>
                  {days.map((d) => (
                    <th key={d} className="border border-slate-200 px-3 py-2 text-left font-medium">
                      {DAY_NAMES[d]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order}>
                    <td className="border border-slate-200 px-3 py-2 font-medium text-slate-500">
                      Period {order + 1}
                    </td>
                    {days.map((d) => {
                      const entry = entryFor(d, order)
                      const period = periodAt(d, order)
                      return (
                        <td key={d} className="border border-slate-200 px-3 py-2">
                          {!period ? (
                            <span className="text-slate-300">—</span>
                          ) : entry ? (
                            <div>
                              <div className="font-medium">{entry.subject_name}</div>
                              <div className="text-xs text-slate-500">
                                {view === 'section' ? entry.teacher_name : `Sec ${classGroupName(entry.class_group_id)}`}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-300">Free</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !result && (
        <div className="flex flex-col items-center justify-center gap-1 py-16 text-center text-slate-500">
          <p className="text-sm">No timetable generated yet for this school.</p>
          <p className="text-xs">Add subjects and constraints, then hit Generate.</p>
        </div>
      )}
    </div>
  )
}
