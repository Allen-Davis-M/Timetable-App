import { useEffect, useState } from 'react'
import { api } from '../api'

const TYPE_LABELS = {
  workload_limit: 'Workload limit',
  availability: 'Availability',
  no_subject_period: 'Subject placement',
  require_subject_period: 'Subject placement',
  no_subject_day: 'Subject day restriction',
  require_subject_day: 'Subject day restriction',
  max_consecutive_periods: 'Consecutive periods limit',
  min_gap_between_subjects: 'Subject spacing',
  subject_sequence: 'Subject sequencing',
  scheduling_rule: 'Scheduling rule',
}

// Types whose parameters include an optional class_group_ids scope —
// these are the ones that get the "Applies to" line and scope editor.
// The other types (workload_limit, availability) are always about one
// specific teacher, not a set of sections, so scoping doesn't apply.
//
// max_consecutive_periods is a special case: it's only actually scopable
// when it's the subject variant (parameters.subject_id set). The teacher
// variant (parameters.teacher_id set) caps that teacher's whole schedule
// and ignores any class_group_ids you'd set here — see isActuallyScopable
// below, which checks the card's own parameters rather than just its type.
const SCOPABLE_TYPES = new Set([
  'no_subject_period',
  'require_subject_period',
  'no_subject_day',
  'require_subject_day',
  'max_consecutive_periods',
  'min_gap_between_subjects',
  'subject_sequence',
])

/**
 * Plain-English constraint entry. Text is sent to
 * POST /api/constraints/parse (see backend/app/routers/constraints.py),
 * which tries Claude first (backend/app/services/llm_constraint_parser.py)
 * for flexible phrasing and richer constraint types — including rules
 * scoped to one grade/section ("Grade 3 shouldn't have Math last period")
 * and consecutive-period limits ("no more than 2 PE periods in a row") —
 * and silently falls back to a regex parser if no API key is configured or
 * the call fails, so constraint entry never just breaks. Each saved
 * constraint comes back with `enforced` so the card can honestly say
 * whether the solver actually applies it, regardless of which parser
 * produced it.
 *
 * Each card also supports editing in place (rewording re-parses via
 * PUT /{id}/reparse, keeping the same id), an explicit "Applies to" line
 * with a scope editor for the rule types that support being scoped to
 * specific sections (PUT /{id} with an updated parameters.class_group_ids),
 * and `conflicts` — server-computed warnings when this constraint directly
 * contradicts another one already saved (two "must be" position rules for
 * the same subject, or two "must be"/"must not be" day rules for the same
 * subject, that can never both be true).
 */
export default function ConstraintsTab({ schoolId, readOnly = false }) {
  const [constraints, setConstraints] = useState([])
  const [classGroups, setClassGroups] = useState([])
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [scopeEditingId, setScopeEditingId] = useState(null)

  async function load() {
    try {
      const [c, cg] = await Promise.all([api.listConstraints(schoolId), api.listClassGroups(schoolId)])
      setConstraints(c)
      setClassGroups(cg)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
  }, [schoolId])

  function classGroupLabel(cg) {
    return cg.grade ? `${cg.grade} - ${cg.name}` : cg.name
  }

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

  async function handleSaveEdit(id, text) {
    if (!text.trim()) return
    setError(null)
    try {
      await api.reparseConstraint(id, text.trim())
      setEditingId(null)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleSaveScope(constraint, selectedIds) {
    setError(null)
    try {
      const parameters = { ...constraint.parameters }
      if (selectedIds.length > 0) {
        parameters.class_group_ids = selectedIds
      } else {
        delete parameters.class_group_ids // empty selection = whole school
      }
      await api.updateConstraint(constraint.id, { parameters })
      setScopeEditingId(null)
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

      {!readOnly && (
        <form onSubmit={handleAdd} className="flex items-center gap-2.5 rounded-md border border-slate-300 py-1.5 pl-3.5 pr-1.5">
          <span className="text-slate-400">✦</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. Math can't immediately follow PE, or Priya Sharma is not available on Wednesdays"
            className="flex-1 py-1 text-sm focus:outline-none"
          />
          <button
            disabled={submitting}
            className="rounded-md bg-slate-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Adding…' : 'Add'}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-3">
        {constraints.map((c) => (
          <ConstraintCard
            key={c.id}
            constraint={c}
            classGroups={classGroups}
            classGroupLabel={classGroupLabel}
            isEditing={editingId === c.id}
            isEditingScope={scopeEditingId === c.id}
            readOnly={readOnly}
            onStartEdit={() => setEditingId(c.id)}
            onCancelEdit={() => setEditingId(null)}
            onSaveEdit={(text) => handleSaveEdit(c.id, text)}
            onStartScopeEdit={() => setScopeEditingId(c.id)}
            onCancelScopeEdit={() => setScopeEditingId(null)}
            onSaveScope={(ids) => handleSaveScope(c, ids)}
            onRemove={() => handleRemove(c.id)}
          />
        ))}
        {constraints.length === 0 && (
          <p className="text-sm text-slate-500">No constraints added yet.</p>
        )}
      </div>
    </div>
  )
}

function ConstraintCard({
  constraint: c,
  classGroups,
  classGroupLabel,
  isEditing,
  isEditingScope,
  readOnly = false,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onStartScopeEdit,
  onCancelScopeEdit,
  onSaveScope,
  onRemove,
}) {
  const [editText, setEditText] = useState(c.description || '')
  const [selectedIds, setSelectedIds] = useState(c.parameters?.class_group_ids || [])

  useEffect(() => {
    setEditText(c.description || '')
  }, [c.description, isEditing])

  useEffect(() => {
    setSelectedIds(c.parameters?.class_group_ids || [])
  }, [c.parameters, isEditingScope])

  // See the SCOPABLE_TYPES comment above: a teacher-variant
  // max_consecutive_periods row (parameters.teacher_id set) caps that
  // teacher's whole schedule and isn't scoped to class groups, even
  // though the *type* is otherwise scopable for its subject variant.
  const scopable = SCOPABLE_TYPES.has(c.type) && !(c.type === 'max_consecutive_periods' && c.parameters?.teacher_id)
  const scopeIds = c.parameters?.class_group_ids
  const scopeLabel = !scopeIds
    ? 'Whole school'
    : classGroups
        .filter((cg) => scopeIds.includes(cg.id))
        .map(classGroupLabel)
        .join(', ') || 'Whole school'

  function toggleId(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <div className="w-72 rounded-lg border border-slate-200 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {TYPE_LABELS[c.type] || c.type}
        </span>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <button onClick={onStartEdit} className="text-xs text-slate-400 hover:text-slate-700" title="Edit">
              ✎
            </button>
            <button onClick={onRemove} className="text-slate-300 hover:text-red-600" title="Delete">
              ✕
            </button>
          </div>
        )}
      </div>

      {isEditing ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <textarea
            autoFocus
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={3}
            className="w-full rounded border border-slate-300 p-1.5 text-sm focus:border-slate-500 focus:outline-none"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => onSaveEdit(editText)}
              className="rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700"
            >
              Save
            </button>
            <button onClick={onCancelEdit} className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm leading-snug">{c.description}</p>
      )}

      {scopable && !isEditing && (
        <div className="mt-2">
          {readOnly ? (
            <p className="text-xs text-slate-500">Applies to: {scopeLabel}</p>
          ) : isEditingScope ? (
            <div className="rounded border border-slate-200 p-2">
              <p className="mb-1 text-xs text-slate-500">Applies to (none selected = whole school):</p>
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {classGroups.map((cg) => (
                  <label key={cg.id} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(cg.id)}
                      onChange={() => toggleId(cg.id)}
                    />
                    {classGroupLabel(cg)}
                  </label>
                ))}
              </div>
              <div className="mt-1.5 flex gap-1.5">
                <button
                  onClick={() => onSaveScope(selectedIds)}
                  className="rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700"
                >
                  Save
                </button>
                <button onClick={onCancelScopeEdit} className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={onStartScopeEdit} className="text-left text-xs text-slate-500 hover:text-slate-700">
              Applies to: <span className="underline underline-offset-2">{scopeLabel}</span>
            </button>
          )}
        </div>
      )}

      {!c.enforced && (
        <p className="mt-2 text-xs text-amber-600">Not yet enforced by the solver</p>
      )}
      {c.conflicts && c.conflicts.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-red-600">
          {c.conflicts.map((msg, i) => (
            <li key={i}>{msg}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
