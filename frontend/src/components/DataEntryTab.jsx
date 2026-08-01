import { useEffect, useState } from 'react'
import { api } from '../api'
import BulkImportPanel from './BulkImportPanel'
import PeriodsPanel from './PeriodsPanel'
import RoomsPanel from './RoomsPanel'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

/**
 * The main data-entry screen: subjects, how many periods/week the
 * currently selected section needs of each, and which teacher(s) (school-
 * wide) are qualified to teach each subject. This is the main input the
 * solver reads (see backend/app/services/solver.py).
 *
 * Periods are a prerequisite the solver also needs but that isn't
 * per-section, so they get a lightweight setup block up top instead of
 * their own tab — most schools just need a standard Mon-Fri grid, which
 * the quick-setup button creates in one click.
 *
 * When a subject has more than one qualified teacher, a "Preferred
 * teacher" picker appears so the admin can pin which one covers this
 * specific section (SubjectRequirement.preferred_teacher_id). This isn't
 * just a convenience — leaving multiple teachers interchangeable makes
 * the solver search a much larger space of equally-valid schedules, which
 * gets dramatically slower at scale (see the scale-testing table in
 * docs/ARCHITECTURE.md: pinning turned an inconclusive 50-section solve
 * into an optimal 200-section solve in ~11s).
 */
export default function DataEntryTab({ schoolId, classGroupId, onClassGroupsChanged, readOnly = false }) {
  const [subjects, setSubjects] = useState([])
  const [teachers, setTeachers] = useState([])
  const [requirements, setRequirements] = useState([])
  const [periods, setPeriods] = useState([])
  const [rooms, setRooms] = useState([])
  const [openDropdownId, setOpenDropdownId] = useState(null)
  const [showPeriods, setShowPeriods] = useState(false)
  const [showRooms, setShowRooms] = useState(false)
  const [error, setError] = useState(null)

  async function load() {
    try {
      const [s, t, r, p, rm] = await Promise.all([
        api.listSubjects(schoolId),
        api.listTeachers(schoolId),
        api.listRequirements(classGroupId),
        api.listPeriods(schoolId),
        api.listRooms(schoolId),
      ])
      setSubjects(s)
      setTeachers(t)
      setRequirements(r)
      setPeriods(p)
      setRooms(rm)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
  }, [schoolId, classGroupId])

  async function handleQuickSetupPeriods() {
    try {
      const calls = []
      for (let day = 0; day < 5; day++) {
        for (let order = 0; order < 8; order++) {
          calls.push(
            api.createPeriod({
              school_id: schoolId,
              day_of_week: day,
              order,
              label: `Period ${order + 1}`,
            })
          )
        }
      }
      await Promise.all(calls)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleAddSubject() {
    try {
      await api.createSubject({ school_id: schoolId, name: 'New subject' })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleRemoveSubject(id) {
    try {
      await api.deleteSubject(id)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleUpdateName(id, name) {
    try {
      await api.updateSubject(id, { name })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleUpdateRoomType(id, requiredRoomType) {
    try {
      await api.updateSubject(id, { required_room_type: requiredRoomType || null })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleUpdatePeriods(subjectId, periodsPerWeek) {
    try {
      // Re-fetch instead of reading from React state: if this field is
      // blurred twice in quick succession (e.g. tabbing through fields),
      // stale state could make two calls both think no requirement exists
      // yet and both create one — silently doubling the real periods/week
      // total behind a UI that only shows one value. Fetching fresh here
      // closes that race.
      const fresh = await api.listRequirements(classGroupId)
      const existing = fresh.find((r) => r.subject_id === subjectId)
      if (existing) {
        if (periodsPerWeek <= 0) {
          await api.deleteRequirement(existing.id)
        } else {
          await api.updateRequirement(existing.id, { periods_per_week: periodsPerWeek })
        }
      } else if (periodsPerWeek > 0) {
        await api.createRequirement(classGroupId, {
          class_group_id: classGroupId,
          subject_id: subjectId,
          periods_per_week: periodsPerWeek,
        })
      }
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleAddTeacher(subjectId, teacher) {
    try {
      await api.updateTeacher(teacher.id, {
        qualified_subject_ids: [...teacher.qualified_subject_ids, subjectId],
      })
      setOpenDropdownId(null)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleRemoveTeacher(subjectId, teacher) {
    try {
      await api.updateTeacher(teacher.id, {
        qualified_subject_ids: teacher.qualified_subject_ids.filter((id) => id !== subjectId),
      })
      // If this teacher was pinned as the preferred teacher for this
      // subject on the currently selected section, clear that pin too —
      // otherwise the solver would keep assigning them anyway (a pin
      // overrides the qualified-teachers list by design, see solver.py),
      // silently contradicting the "removed" state shown here.
      const fresh = await api.listRequirements(classGroupId)
      const requirement = fresh.find((r) => r.subject_id === subjectId)
      if (requirement?.preferred_teacher_id === teacher.id) {
        await api.updateRequirement(requirement.id, { preferred_teacher_id: null })
      }
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleSetPreferredTeacher(subjectId, teacherId) {
    try {
      const fresh = await api.listRequirements(classGroupId)
      const requirement = fresh.find((r) => r.subject_id === subjectId)
      if (!requirement) return // picker is only shown once a requirement exists
      await api.updateRequirement(requirement.id, { preferred_teacher_id: teacherId })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  const rows = subjects.map((subject) => {
    const requirement = requirements.find((r) => r.subject_id === subject.id)
    const qualifiedTeachers = teachers.filter((t) => t.qualified_subject_ids.includes(subject.id))
    const availableTeachers = teachers.filter((t) => !t.qualified_subject_ids.includes(subject.id))
    const periodsPerWeek = requirement?.periods_per_week ?? 0
    return {
      subject,
      requirement,
      periodsPerWeek,
      qualifiedTeachers,
      availableTeachers,
      preferredTeacherId: requirement?.preferred_teacher_id ?? null,
      valid: periodsPerWeek > 0 && qualifiedTeachers.length > 0,
    }
  })

  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Subjects &amp; teachers</h3>
          <p className="mt-1 text-sm text-slate-500">
            Applies school-wide, except periods/week which is set per section.
          </p>
        </div>
        {!readOnly && (
          <button
            onClick={handleAddSubject}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
          >
            + Add subject
          </button>
        )}
      </div>

      {periods.length === 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="mb-2">
            No periods set up yet — the solver needs these before it can generate a
            timetable.
          </p>
          {!readOnly && (
            <button
              onClick={handleQuickSetupPeriods}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
            >
              Quick setup: Mon–Fri, 8 periods/day
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={() => setShowPeriods((v) => !v)}
          className="w-fit text-xs text-slate-500 underline underline-offset-2"
        >
          {periods.length} periods configured ({DAY_LABELS.length} days) — {showPeriods ? 'hide' : 'manage'}
        </button>
      )}
      {showPeriods && (
        <div className="rounded-md border border-slate-200 p-4">
          <PeriodsPanel schoolId={schoolId} />
        </div>
      )}

      <button
        onClick={() => setShowRooms((v) => !v)}
        className="w-fit text-xs text-slate-500 underline underline-offset-2"
      >
        {rooms.length} room{rooms.length === 1 ? '' : 's'} configured — {showRooms ? 'hide' : 'manage'}
      </button>
      {showRooms && (
        <div className="rounded-md border border-slate-200 p-4">
          <RoomsPanel schoolId={schoolId} />
        </div>
      )}

      {!readOnly && (
        <BulkImportPanel
          schoolId={schoolId}
          onImported={async () => {
            await load()
            // Class groups (sections) live in the sidebar's own state in
            // App.jsx, not here — refresh that too so a bulk-imported
            // section shows up without a manual page reload. Harmless to
            // call after every import, not just a class-groups one.
            if (onClassGroupsChanged) await onClassGroupsChanged()
          }}
        />
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="w-1/4 py-2 font-medium">Subject</th>
            <th className="w-32 py-2 font-medium">Periods/week</th>
            <th className="py-2 font-medium">Teachers</th>
            <th className="w-28 py-2 font-medium">Status</th>
            <th className="w-8 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ subject, requirement, periodsPerWeek, qualifiedTeachers, availableTeachers, preferredTeacherId, valid }) => (
            <tr key={subject.id} className="border-b border-slate-100">
              <td className="py-2 pr-2">
                <input
                  defaultValue={subject.name}
                  disabled={readOnly}
                  onBlur={(e) => e.target.value !== subject.name && handleUpdateName(subject.id, e.target.value)}
                  className="w-full rounded px-1.5 py-1 text-sm hover:bg-slate-50 focus:bg-slate-50 focus:outline-none disabled:bg-transparent disabled:text-slate-700"
                />
                <input
                  defaultValue={subject.required_room_type ?? ''}
                  disabled={readOnly}
                  onBlur={(e) =>
                    e.target.value !== (subject.required_room_type ?? '') &&
                    handleUpdateRoomType(subject.id, e.target.value.trim())
                  }
                  placeholder="Room type (optional, e.g. lab)"
                  title="If set, this subject can only be assigned a room whose type matches exactly"
                  className="mt-0.5 w-full rounded px-1.5 py-0.5 text-xs text-slate-500 placeholder:text-slate-400 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                />
              </td>
              <td className="py-2 pr-2">
                <PeriodsPerWeekInput
                  value={periodsPerWeek}
                  onSave={(val) => handleUpdatePeriods(subject.id, val)}
                  disabled={readOnly}
                />
              </td>
              <td className="py-2 pr-2">
                <div className="relative flex flex-wrap items-center gap-1.5">
                  {qualifiedTeachers.map((t) => (
                    <span
                      key={t.id}
                      title={t.id === preferredTeacherId ? 'Preferred teacher for this section' : undefined}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-white ${
                        t.id === preferredTeacherId ? 'bg-emerald-700 ring-2 ring-emerald-200' : 'bg-slate-900'
                      }`}
                    >
                      {t.id === preferredTeacherId && '★ '}
                      {t.name}
                      {!readOnly && (
                        <button onClick={() => handleRemoveTeacher(subject.id, t)} className="opacity-70 hover:opacity-100">
                          ✕
                        </button>
                      )}
                    </span>
                  ))}
                  {!readOnly && (
                    <button
                      onClick={() => setOpenDropdownId(openDropdownId === subject.id ? null : subject.id)}
                      className="rounded-full border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      + Add
                    </button>
                  )}
                  {openDropdownId === subject.id && (
                    <div className="absolute left-0 top-7 z-10 max-h-52 w-48 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-md">
                      {availableTeachers.length === 0 && (
                        <p className="px-2 py-1.5 text-xs text-slate-400">No other teachers</p>
                      )}
                      {availableTeachers.map((t) => (
                        <div
                          key={t.id}
                          onClick={() => handleAddTeacher(subject.id, t)}
                          className="cursor-pointer rounded px-2 py-1.5 text-sm hover:bg-slate-50"
                        >
                          {t.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {requirement && qualifiedTeachers.length > 1 && (
                  <select
                    value={preferredTeacherId ?? ''}
                    disabled={readOnly}
                    onChange={(e) =>
                      handleSetPreferredTeacher(subject.id, e.target.value ? Number(e.target.value) : null)
                    }
                    title="Which teacher covers this section — pinning one speeds up generation for large schools"
                    className="mt-1.5 rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    <option value="">Preferred teacher: any (let solver choose)</option>
                    {qualifiedTeachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        Preferred teacher: {t.name}
                      </option>
                    ))}
                  </select>
                )}
              </td>
              <td className="py-2 pr-2">
                {valid ? (
                  <span className="text-xs font-medium text-emerald-700">✓ Ready</span>
                ) : periodsPerWeek <= 0 ? (
                  <span className="text-xs text-slate-500">Set periods/week</span>
                ) : (
                  <span className="text-xs text-slate-500">Needs a teacher</span>
                )}
              </td>
              <td className="py-2">
                {!readOnly && (
                  <button
                    onClick={() => handleRemoveSubject(subject.id)}
                    className="text-slate-300 hover:text-red-600"
                    title="Remove subject"
                  >
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-sm text-slate-500">
                No subjects yet — add one above.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {!readOnly && (
        <p className="text-xs text-slate-400">
          Teachers are managed here too — add one from the "Teachers" list when
          assigning them to a subject, or{' '}
          <TeacherQuickAdd schoolId={schoolId} onAdded={load} />.
        </p>
      )}
    </div>
  )
}

/**
 * A controlled periods/week field, explicitly re-synced to `value`
 * whenever it changes (e.g. switching sections).
 *
 * The previous version used an uncontrolled input (`defaultValue`), which
 * only sets the DOM's value on first mount — React does not update it on
 * later re-renders. Since this row's <tr> was reused across section
 * switches (same subject.id, so same React key), the box kept showing
 * whichever section's number it happened to mount with first, even after
 * the real underlying value changed. That's exactly the "Section B shows
 * Section A's periods" bug. A controlled input with this effect can't
 * drift from the real value, regardless of how the parent re-renders.
 */
function PeriodsPerWeekInput({ value, onSave, disabled = false }) {
  const [text, setText] = useState(String(value))

  useEffect(() => {
    setText(String(value))
  }, [value])

  function handleBlur() {
    const val = Number(text) || 0
    if (val !== value) onSave(val)
    else setText(String(value)) // normalize e.g. "007" -> "7"
  }

  return (
    <input
      type="number"
      min="0"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={handleBlur}
      className="w-16 rounded px-1.5 py-1 text-sm hover:bg-slate-50 focus:bg-slate-50 focus:outline-none disabled:bg-transparent disabled:text-slate-700"
    />
  )
}

function TeacherQuickAdd({ schoolId, onAdded }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState(null)

  async function handleAdd(e) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await api.createTeacher({ school_id: schoolId, name: name.trim() })
      setName('')
      setAdding(false)
      onAdded()
    } catch (err) {
      setError(err.message)
    }
  }

  if (!adding) {
    return (
      <button onClick={() => setAdding(true)} className="underline underline-offset-2">
        add a new teacher
      </button>
    )
  }

  return (
    <form onSubmit={handleAdd} className="mt-1 inline-flex items-center gap-1.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => !name && setAdding(false)}
        placeholder="Teacher name"
        className="rounded border border-slate-300 px-1.5 py-0.5 text-xs"
      />
      <button className="text-xs font-medium text-slate-900 underline">Add</button>
      {error && <span className="text-red-600">{error}</span>}
    </form>
  )
}
