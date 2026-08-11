import { useEffect, useState } from 'react'
import { api } from '../api'

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/**
 * CRUD panel for a school's periods (schedulable time slots). The solver
 * treats these as the units it assigns subjects into, so a school needs at
 * least as many periods as the sum of its weekly subject requirements
 * before generation can succeed.
 */
export default function PeriodsPanel({ schoolId }) {
  const [periods, setPeriods] = useState([])
  const [dayOfWeek, setDayOfWeek] = useState(0)
  const [order, setOrder] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState(null)

  async function load() {
    try {
      setPeriods(await api.listPeriods(schoolId))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
  }, [schoolId])

  async function handleAdd(e) {
    e.preventDefault()
    if (order === '') return
    try {
      await api.createPeriod({
        school_id: schoolId,
        day_of_week: Number(dayOfWeek),
        order: Number(order),
        label: label.trim() || null,
      })
      setOrder('')
      setLabel('')
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(id) {
    try {
      await api.deletePeriod(id)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-medium">Periods</h2>
      <p className="mb-4 text-sm text-slate-500">
        Each row is one schedulable slot, e.g. "Monday, period 1". Add every
        slot the school actually teaches in.
      </p>

      <form onSubmit={handleAdd} className="mb-4 flex flex-wrap gap-2">
        <select
          value={dayOfWeek}
          onChange={(e) => setDayOfWeek(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        >
          {DAY_NAMES.map((d, i) => (
            <option key={i} value={i}>
              {d}
            </option>
          ))}
        </select>
        <input
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          placeholder="Order (1, 2, 3…)"
          type="number"
          className="w-36 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. 9:00-9:45)"
          className="flex-1 min-w-[160px] rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <button className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Add
        </button>
      </form>

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <ul className="divide-y divide-slate-200">
        {periods.map((p) => (
          <li key={p.id} className="flex items-center justify-between py-2 text-sm">
            <span>
              {DAY_NAMES[p.day_of_week]} · #{p.order}
              {p.label ? ` · ${p.label}` : ''}
            </span>
            <button
              onClick={() => handleDelete(p.id)}
              className="text-xs text-slate-400 hover:text-red-600"
            >
              Remove
            </button>
          </li>
        ))}
        {periods.length === 0 && (
          <p className="py-2 text-sm text-slate-500">No periods yet.</p>
        )}
      </ul>
    </div>
  )
}
