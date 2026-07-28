import { useEffect, useState } from 'react'
import { api } from '../api'

const TYPE_LABELS = {
  workload_limit: 'Workload limit',
  availability: 'Availability',
  scheduling_rule: 'Scheduling rule',
}

/**
 * Plain-English constraint entry. Text is sent to
 * POST /api/constraints/parse (see backend/app/services/constraint_parser.py),
 * a pattern-matching parser — not a general LLM — that recognizes workload
 * limits, availability mentions, and falls back to a generic "scheduling
 * rule" bucket otherwise. Workload limits with a matched teacher are
 * actually enforced by the solver; other types are recorded but not yet
 * enforced, and the card says so.
 */
export default function ConstraintsTab({ schoolId }) {
  const [constraints, setConstraints] = useState([])
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function load() {
    try {
      setConstraints(await api.listConstraints(schoolId))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
  }, [schoolId])

  async function handleAdd(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    setSubmitting(true)
    setError(null)
    try {
      await api.parseConstraint(schoolId, text)
      setInput('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRemove(id) {
    try {
      await api.deleteConstraint(id)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h3 className="text-lg font-medium">Constraints</h3>
        <p className="mt-1 text-sm text-slate-500">
          Describe scheduling rules in plain English — we'll turn them into
          structured constraints.
        </p>
      </div>

      <form onSubmit={handleAdd} className="flex items-center gap-2.5 rounded-md border border-slate-300 py-1.5 pl-3.5 pr-1.5">
        <span className="text-slate-400">✦</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Mrs. Sharma can only teach 10 periods a week"
          className="flex-1 py-1 text-sm focus:outline-none"
        />
        <button
          disabled={submitting}
          className="rounded-md bg-slate-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Add'}
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-3">
        {constraints.map((c) => (
          <div key={c.id} className="w-64 rounded-lg border border-slate-200 p-3.5">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {TYPE_LABELS[c.type] || c.type}
              </span>
              <button onClick={() => handleRemove(c.id)} className="text-slate-300 hover:text-red-600">
                ✕
              </button>
            </div>
            <p className="mt-2 text-sm leading-snug">{c.description}</p>
            {c.type !== 'workload_limit' && (
              <p className="mt-2 text-xs text-amber-600">Not yet enforced by the solver</p>
            )}
          </div>
        ))}
        {constraints.length === 0 && (
          <p className="text-sm text-slate-500">No constraints added yet.</p>
        )}
      </div>
    </div>
  )
}
