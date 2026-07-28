import { useEffect, useState } from 'react'
import { api } from '../api'
import PeriodsPanel from './PeriodsPanel'

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
 */
export default function DataEntryTab({ schoolId, classGroupId }) {
  const [subjects, setSubjects] = useState([])
  const [teachers, setTeachers] = useState([])
  const [requirements, setRequirements] = useState([])
  const [periods, setPeriods] = useState([])
  const [openDropdownId, setOpenDropdownId] = useState(null)
  const [showPeriods, setShowPeriods] = useState(false)
  const [error, setError] = useState(null)

  async function load() {
    try {
      const [s, t, r, p] = await Promise.all([
        api.listSubjects(schoolId),
        api.listTeachers(schoolId),
        api.listRequirements(classGroupId),
        api.listPeriods(schoolId),
      ])
      setSubjects(s)
      setTeachers(t)
      setRequirements(r)
      setPeriods(p)
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
      periodsPerWeek,
      qualifiedTeachers,
      availableTeachers,
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
        <button
          onClick={handleAddSubject}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
        >
          + Add subject
        </button>
      </div>

      {periods.length === 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="mb-2">
            No periods set up yet — the solver needs these before it can generate a
            timetable.
          </p>
          <button
            onClick={handleQuickSetupPeriods}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
          >
            Quick setup: Mon–Fri, 8 periods/day
          </button>
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
          {rows.map(({ subject, periodsPerWeek, qualifiedTeachers, availableTeachers, valid }) => (
            // key includes classGroupId: the periods/week input below is an
            // uncontrolled input (defaultValue), which React does NOT
            // refresh on re-render — only on mount. Without classGroupId in
            // the key, switching sections would silently keep showing the
            // previous section's numbers in the box even though the real
            // value underneath had changed (see the "Section B shows the
            // same periods as Section A" bug this fixes).
            <tr key={`${classGroupId}-${subject.id}`} className="border-b border-slate-100">
              <td className="py-2 pr-2">
                <input
                  defaultValue={subject.name}
                  onBlur={(e) => e.target.value !== subject.name && handleUpdateName(subject.id, e.target.value)}
                  className="w-full rounded px-1.5 py-1 text-sm hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                />
              </td>
              <td className="py-2 pr-2">
                <input
                  type="number"
                  min="0"
                  defaultValue={periodsPerWeek}
                  onBlur={(e) => {
                    const val = Number(e.target.value) || 0
                    if (val !== periodsPerWeek) handleUpdatePeriods(subject.id, val)
                  }}
                  className="w-16 rounded px-1.5 py-1 text-sm hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                />
              </td>
              <td className="py-2 pr-2">
                <div className="relative flex flex-wrap items-center gap-1.5">
                  {qualifiedTeachers.map((t) => (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-2.5 py-1 text-xs text-white"
                    >
                      {t.name}
                      <button onClick={() => handleRemoveTeacher(subject.id, t)} className="opacity-70 hover:opacity-100">
                        ✕
                      </button>
                    </span>
                  ))}
                  <button
                    onClick={() => setOpenDropdownId(openDropdownId === subject.id ? null : subject.id)}
                    className="rounded-full border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    + Add
                  </button>
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
                <button
                  onClick={() => handleRemoveSubject(subject.id)}
                  className="text-slate-300 hover:text-red-600"
                  title="Remove subject"
                >
                  ✕
                </button>
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

      <p className="text-xs text-slate-400">
        Teachers are managed here too — add one from the "Teachers" list when
        assigning them to a subject, or{' '}
        <TeacherQuickAdd schoolId={schoolId} onAdded={load} />.
      </p>
    </div>
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
