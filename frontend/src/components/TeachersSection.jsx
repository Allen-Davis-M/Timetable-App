import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../api'
import BulkImportPanel from './BulkImportPanel'

/**
 * "Who teaches what" — one row per teacher, their subjects shown as
 * removable chips with a "+ Add" picker for the rest. This is the
 * teacher-centric mirror of the subject-to-teacher assignment that used
 * to live inline in the (now-removed) combined subjects/teachers table —
 * moved here since "which subjects does this teacher cover" is naturally
 * a question about the teacher, not something that should require
 * finding them in every relevant subject's own dropdown one at a time.
 */
// Distinct grade labels across every section, in the order they first
// appear (not alphabetized — schools tend to enter grades in a natural
// low-to-high order already, and re-sorting strings would put "Grade 10"
// before "Grade 2"). Shared by the inline per-teacher picker and
// AddTeacherModal so the two can't drift.
function distinctGrades(classGroups) {
  const seen = new Set()
  const grades = []
  for (const cg of classGroups) {
    if (cg.grade && !seen.has(cg.grade)) {
      seen.add(cg.grade)
      grades.push(cg.grade)
    }
  }
  return grades
}

export default function TeachersSection({ schoolId, teachers, subjects, classGroups, onTeachersChanged, readOnly }) {
  const [error, setError] = useState(null)
  const [showImport, setShowImport] = useState(true)
  const [addTeacherOpen, setAddTeacherOpen] = useState(false)
  const [openDropdownId, setOpenDropdownId] = useState(null)
  const [openGradeDropdownId, setOpenGradeDropdownId] = useState(null)

  const allGrades = distinctGrades(classGroups)

  async function handleAssignSubject(teacher, subjectId) {
    try {
      await onTeachersChanged.update(teacher.id, {
        qualified_subject_ids: [...teacher.qualified_subject_ids, subjectId],
      })
      setOpenDropdownId(null)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleUnassignSubject(teacher, subjectId) {
    try {
      await onTeachersChanged.update(teacher.id, {
        qualified_subject_ids: teacher.qualified_subject_ids.filter((id) => id !== subjectId),
      })
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleAssignGrade(teacher, grade) {
    try {
      await onTeachersChanged.update(teacher.id, {
        qualified_grades: [...(teacher.qualified_grades || []), grade],
      })
      setOpenGradeDropdownId(null)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleUnassignGrade(teacher, grade) {
    try {
      await onTeachersChanged.update(teacher.id, {
        qualified_grades: (teacher.qualified_grades || []).filter((g) => g !== grade),
      })
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDeleteTeacher(teacher) {
    if (!window.confirm(`Remove ${teacher.name}? This also removes them from every subject and section they're assigned to.`)) {
      return
    }
    try {
      await onTeachersChanged.delete(teacher.id)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-base font-medium">Teachers</h4>
          <p className="mt-1 text-sm text-slate-500">Who teaches, and which subjects they cover.</p>
        </div>
        {!readOnly && (
          <button
            onClick={() => setAddTeacherOpen(true)}
            className="w-fit rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
          >
            + Add teacher
          </button>
        )}
      </div>

      <AnimatePresence>
        {addTeacherOpen && (
          <AddTeacherModal
            schoolId={schoolId}
            subjects={subjects}
            allGrades={allGrades}
            onClose={() => setAddTeacherOpen(false)}
            onAdded={async () => {
              setAddTeacherOpen(false)
              await onTeachersChanged.reload()
            }}
          />
        )}
      </AnimatePresence>

      {!readOnly && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h5 className="text-sm font-semibold text-indigo-900">Import teachers</h5>
              <p className="mt-0.5 text-xs text-indigo-700/80">
                Upload a spreadsheet instead of adding teachers one at a time. Add subjects first
                — teacher rows are matched against subject names that already exist.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowImport((v) => !v)}
              className="flex-none text-xs font-medium text-indigo-700 hover:underline"
            >
              {showImport ? 'Hide' : 'Show'}
            </button>
          </div>
          {showImport && (
            <div className="mt-3">
              <BulkImportPanel schoolId={schoolId} resource="teachers" onImported={onTeachersChanged.reload} />
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-col divide-y divide-slate-100 rounded-md border border-slate-200">
        {teachers.map((teacher) => {
          const qualified = subjects.filter((s) => teacher.qualified_subject_ids.includes(s.id))
          // Excludes subjects still `_pending` (optimistically shown right
          // after "+ Add subject" but not yet confirmed by the server) —
          // picking one here before it has a real id would send that
          // temporary id to the backend instead of a valid subject id.
          const available = subjects.filter((s) => !s._pending && !teacher.qualified_subject_ids.includes(s.id))
          const qualifiedGrades = teacher.qualified_grades || []
          const availableGrades = allGrades.filter((g) => !qualifiedGrades.includes(g))
          return (
            <div key={teacher.id} className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-40 flex-none font-medium">{teacher.name}</div>
              <div className="relative flex flex-1 flex-wrap items-center gap-1.5">
                <AnimatePresence initial={false}>
                  {qualified.map((s) => (
                    <motion.span
                      key={s.id}
                      layout
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.85 }}
                      transition={{ duration: 0.15 }}
                      className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-2.5 py-1 text-xs text-white"
                    >
                      {s.name}
                      {!readOnly && (
                        <button
                          onClick={() => handleUnassignSubject(teacher, s.id)}
                          aria-label={`Remove ${s.name} from ${teacher.name}`}
                          className="opacity-70 hover:opacity-100"
                        >
                          ✕
                        </button>
                      )}
                    </motion.span>
                  ))}
                </AnimatePresence>
                {!readOnly && (
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setOpenDropdownId(openDropdownId === teacher.id ? null : teacher.id)}
                    className="rounded-full border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    + Add
                  </motion.button>
                )}
                <AnimatePresence>
                  {openDropdownId === teacher.id && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.96, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96, y: -4 }}
                      transition={{ duration: 0.12, ease: 'easeOut' }}
                      className="absolute left-0 top-7 z-10 max-h-52 w-48 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-md"
                    >
                      {available.length === 0 && (
                        <p className="px-2 py-1.5 text-xs text-slate-400">
                          {subjects.length === 0 ? 'No subjects yet' : 'Already teaches everything'}
                        </p>
                      )}
                      {available.map((s) => (
                        <div
                          key={s.id}
                          onClick={() => handleAssignSubject(teacher, s.id)}
                          className="cursor-pointer rounded px-2 py-1.5 text-sm hover:bg-slate-50"
                        >
                          {s.name}
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {!readOnly && (
                <button
                  onClick={() => handleDeleteTeacher(teacher)}
                  className="flex-none text-slate-300 hover:text-red-600"
                  title={`Remove ${teacher.name}`}
                  aria-label={`Remove ${teacher.name}`}
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 pl-0 sm:pl-[172px]">
              <span className="mr-1 flex-none text-xs text-slate-400">Grades:</span>
              {qualifiedGrades.length === 0 && (
                <span className="text-xs text-slate-400">All grades</span>
              )}
              <AnimatePresence initial={false}>
                {qualifiedGrades.map((g) => (
                  <motion.span
                    key={g}
                    layout
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{ duration: 0.15 }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-700 px-2.5 py-1 text-xs text-white"
                  >
                    {g}
                    {!readOnly && (
                      <button
                        onClick={() => handleUnassignGrade(teacher, g)}
                        aria-label={`Remove ${g} from ${teacher.name}`}
                        className="opacity-70 hover:opacity-100"
                      >
                        ✕
                      </button>
                    )}
                  </motion.span>
                ))}
              </AnimatePresence>
              {!readOnly && allGrades.length > 0 && (
                <div className="relative">
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setOpenGradeDropdownId(openGradeDropdownId === teacher.id ? null : teacher.id)}
                    className="rounded-full border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    {qualifiedGrades.length === 0 ? '+ Restrict to specific grades' : '+ Add'}
                  </motion.button>
                  <AnimatePresence>
                    {openGradeDropdownId === teacher.id && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.96, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: -4 }}
                        transition={{ duration: 0.12, ease: 'easeOut' }}
                        className="absolute left-0 top-7 z-10 max-h-52 w-48 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-md"
                      >
                        {availableGrades.length === 0 && (
                          <p className="px-2 py-1.5 text-xs text-slate-400">Already covers every grade</p>
                        )}
                        {availableGrades.map((g) => (
                          <div
                            key={g}
                            onClick={() => handleAssignGrade(teacher, g)}
                            className="cursor-pointer rounded px-2 py-1.5 text-sm hover:bg-slate-50"
                          >
                            {g}
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
            </div>
          )
        })}
        {teachers.length === 0 && (
          <p className="p-4 text-sm text-slate-500">No teachers yet — add one above, or import a spreadsheet.</p>
        )}
      </div>
    </div>
  )
}

/**
 * Modal for adding a teacher with their subjects in one step, instead of
 * creating a name-only teacher and then having to find them in every
 * relevant subject's "+ Add" dropdown one at a time. A teacher can teach
 * more than one subject (e.g. a Math teacher who also covers Physics), so
 * this is a multi-select checkbox list, not a single dropdown — mirrors
 * how `qualified_subject_ids` is actually modeled (a list) rather than
 * implying one teacher = one subject.
 */
function AddTeacherModal({ schoolId, subjects, allGrades, onClose, onAdded }) {
  const [name, setName] = useState('')
  const [selectedSubjectIds, setSelectedSubjectIds] = useState([])
  // Empty = no restriction (teaches every grade) — same default as
  // Teacher.qualified_grades server-side, so leaving this untouched here
  // behaves exactly like every teacher did before this field existed.
  const [selectedGrades, setSelectedGrades] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  function toggleSubject(id) {
    setSelectedSubjectIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  function toggleGrade(grade) {
    setSelectedGrades((prev) =>
      prev.includes(grade) ? prev.filter((g) => g !== grade) : [...prev, grade]
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await api.createTeacher({
        school_id: schoolId,
        name: name.trim(),
        qualified_subject_ids: selectedSubjectIds,
        qualified_grades: selectedGrades,
      })
      await onAdded()
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
      >
        <h3 className="text-base font-semibold">Add teacher</h3>
        <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="new-teacher-name" className="text-xs font-medium text-slate-500">
              Name
            </label>
            <input
              id="new-teacher-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Teacher name"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">
              Subjects they teach (optional — a teacher can teach more than one)
            </span>
            {subjects.filter((s) => !s._pending).length === 0 ? (
              <p className="text-xs text-slate-400">
                No subjects yet — add subjects first, or add this teacher now and assign
                subjects afterward from this list.
              </p>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200 p-2">
                {subjects.filter((s) => !s._pending).map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSubjectIds.includes(s.id)}
                      onChange={() => toggleSubject(s.id)}
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          {allGrades.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-500">
                Grades they teach (optional — leave all unchecked to teach every grade)
              </span>
              <div className="max-h-32 overflow-y-auto rounded-md border border-slate-200 p-2">
                {allGrades.map((g) => (
                  <label
                    key={g}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedGrades.includes(g)}
                      onChange={() => toggleGrade(g)}
                    />
                    {g}
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              disabled={!name.trim() || submitting}
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? 'Adding…' : 'Add teacher'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
