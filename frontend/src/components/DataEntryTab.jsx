import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../api'
import BulkImportPanel from './BulkImportPanel'
import PeriodsPanel from './PeriodsPanel'
import RoomsPanel from './RoomsPanel'

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
export default function DataEntryTab({ schoolId, classGroupId, institutionType, onClassGroupsChanged, readOnly = false }) {
  const [subjects, setSubjects] = useState([])
  const [teachers, setTeachers] = useState([])
  const [requirements, setRequirements] = useState([])
  const [periods, setPeriods] = useState([])
  const [rooms, setRooms] = useState([])
  const [classGroups, setClassGroups] = useState([])
  const [openDropdownId, setOpenDropdownId] = useState(null)
  // Periods, Rooms, and Bulk import are grouped under one disclosure (see
  // the "Setup" section below) rather than three separate toggles.
  const [showSetup, setShowSetup] = useState(false)
  const [addTeacherOpen, setAddTeacherOpen] = useState(false)
  const [error, setError] = useState(null)
  // Which subject rows have their "advanced" fields (room type, and for
  // colleges, credits/lab batches) expanded. Collapsed by default per row
  // — most subjects never set these, so showing two extra inputs under
  // every single subject name was pure clutter for the common case. A row
  // that already has an advanced field set starts expanded (see the
  // initializer below, computed once subjects first load) so existing
  // settings are never hidden without a trace.
  const [expandedAdvanced, setExpandedAdvanced] = useState(new Set())
  const [selectedSubjectIds, setSelectedSubjectIds] = useState([])
  const [copyingPeriods, setCopyingPeriods] = useState(false)
  // Guards against the "quick setup" button firing 40 createPeriod calls
  // once, then another 40 if double-clicked before the first batch lands.
  const [settingUpPeriods, setSettingUpPeriods] = useState(false)

  async function load() {
    try {
      const [s, t, r, p, rm, cg] = await Promise.all([
        api.listSubjects(schoolId),
        api.listTeachers(schoolId),
        api.listRequirements(classGroupId),
        api.listPeriods(schoolId),
        api.listRooms(schoolId),
        api.listClassGroups(schoolId),
      ])
      setSubjects(s)
      setTeachers(t)
      setRequirements(r)
      setPeriods(p)
      setRooms(rm)
      setClassGroups(cg)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
  }, [schoolId, classGroupId])

  // Auto-expand a subject's advanced fields if it already has one set
  // (e.g. loading a school that was set up before this collapsed view
  // existed, or one imported via bulk-import's required_room_type
  // column) — collapsing it would hide a real setting, not just reduce
  // clutter. Only adds ids in; never removes one a user collapsed by
  // hand, so manually collapsing a row sticks even if you blur/re-render.
  useEffect(() => {
    setExpandedAdvanced((prev) => {
      const withAdvanced = subjects.filter(
        (s) => s.required_room_type || s.credits || (s.lab_batch_count && s.lab_batch_count >= 2)
      )
      if (withAdvanced.every((s) => prev.has(s.id))) return prev
      const next = new Set(prev)
      withAdvanced.forEach((s) => next.add(s.id))
      return next
    })
  }, [subjects])

  function toggleAdvanced(subjectId) {
    setExpandedAdvanced((prev) => {
      const next = new Set(prev)
      if (next.has(subjectId)) next.delete(subjectId)
      else next.add(subjectId)
      return next
    })
  }

  async function handleQuickSetupPeriods() {
    if (settingUpPeriods) return
    setSettingUpPeriods(true)
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
    } finally {
      setSettingUpPeriods(false)
    }
  }

  async function handleAddSubject() {
    try {
      // Append the created row locally instead of calling load() (which
      // fires 5 parallel GETs — subjects, teachers, requirements, periods,
      // rooms). A brand-new subject can't affect any of those other four
      // lists, so re-fetching all of them here was pure overhead — on a
      // remote/hosted database (real network round-trip per request,
      // e.g. Supabase) that overhead is what made "+ Add subject" feel
      // like it hung for a few seconds. The POST response already has the
      // full row (id included), so this is a plain state append, not a
      // guess at what the server assigned.
      const created = await api.createSubject({ school_id: schoolId, name: 'New subject' })
      setSubjects((prev) => [...prev, created])
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleRemoveSubject(id, name) {
    if (!window.confirm(`Remove "${name}"? This also removes its periods/week and teacher qualifications for this subject.`)) {
      return
    }
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

  async function handleUpdateCredits(id, value) {
    const n = Number(value)
    try {
      await api.updateSubject(id, { credits: n > 0 ? n : null })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleUpdateLabBatchCount(id, value) {
    // 0/1/blank all mean "no split" — stored as null so the solver treats
    // it exactly like any other subject (see Subject.lab_batch_count's
    // docstring in backend/app/models/school.py).
    const n = Number(value)
    try {
      await api.updateSubject(id, { lab_batch_count: n >= 2 ? n : null })
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

  async function handleToggleSubjectAssignment(subjectId, currentlyAssigned) {
    const targetValue = currentlyAssigned ? 0 : 1
    await handleUpdatePeriods(subjectId, targetValue)
  }

  async function handleCopyPeriodsToOtherSections() {
    if (copyingPeriods) return
    const rowsToCopy = selectedSubjectIds.length > 0
      ? rows.filter((row) => selectedSubjectIds.includes(row.subject.id))
      : rows.filter((row) => row.periodsPerWeek > 0)
    if (rowsToCopy.length === 0) {
      setError('Nothing to copy: set some periods/week in this section first.')
      return
    }

    const otherSections = classGroups.filter((cg) => cg.id !== classGroupId)
    if (otherSections.length === 0) {
      setError('No other sections to copy to.')
      return
    }

    if (!window.confirm(`Copy ${rowsToCopy.length} subject assignment${rowsToCopy.length === 1 ? '' : 's'} to ${otherSections.length} other section${otherSections.length === 1 ? '' : 's'}?`)) {
      return
    }

    setCopyingPeriods(true)
    setError(null)
    try {
      const calls = []
      for (const target of otherSections) {
        for (const row of rowsToCopy) {
          calls.push(
            api.createRequirement(target.id, {
              class_group_id: target.id,
              subject_id: row.subject.id,
              periods_per_week: row.periodsPerWeek,
            })
          )
        }
      }
      await Promise.all(calls)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setCopyingPeriods(false)
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

  const totalWeeklyPeriods = rows.reduce((sum, row) => sum + row.periodsPerWeek, 0)
  const selectedAll = selectedSubjectIds.length === rows.length && rows.length > 0
  const selectedCount = selectedSubjectIds.length

  function toggleSelectedSubject(subjectId) {
    setSelectedSubjectIds((prev) =>
      prev.includes(subjectId) ? prev.filter((id) => id !== subjectId) : [...prev, subjectId]
    )
  }

  function toggleSelectAll() {
    if (selectedAll) {
      setSelectedSubjectIds([])
    } else {
      setSelectedSubjectIds(rows.map((row) => row.subject.id))
    }
  }

  const selectedRows = selectedSubjectIds.length > 0
    ? rows.filter((row) => selectedSubjectIds.includes(row.subject.id))
    : rows

  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-lg font-medium">Subjects &amp; teachers</h3>
          <p className="mt-1 text-sm text-slate-500">
            Applies school-wide, except periods/week which is set per section.
          </p>
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            <button
              onClick={() => setAddTeacherOpen(true)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
            >
              + Add teacher
            </button>
            <button
              onClick={handleAddSubject}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
            >
              + Add subject
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {addTeacherOpen && (
          <AddTeacherModal
            schoolId={schoolId}
            subjects={subjects}
            onClose={() => setAddTeacherOpen(false)}
            onAdded={async () => {
              setAddTeacherOpen(false)
              await load()
            }}
          />
        )}
      </AnimatePresence>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <strong>{totalWeeklyPeriods}</strong> total periods/week for this section
          </div>
          {!readOnly && rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleSelectAll}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-100"
              >
                {selectedAll ? 'Clear selection' : `Select ${rows.length} subject${rows.length === 1 ? '' : 's'}`}
              </button>
              <button
                type="button"
                onClick={handleCopyPeriodsToOtherSections}
                disabled={copyingPeriods}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
              >
                {copyingPeriods
                  ? 'Copying…'
                  : selectedCount > 0
                    ? `Copy ${selectedCount} selected subject${selectedCount === 1 ? '' : 's'} to other sections`
                    : `Copy ${rows.filter((row) => row.periodsPerWeek > 0).length} subject${rows.filter((row) => row.periodsPerWeek > 0).length === 1 ? '' : 's'} to other sections`}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* The "no periods yet" case stays outside the collapsed Setup
          section, always visible — it's a hard blocker (the solver can't
          run at all without periods), not a one-time-setup convenience,
          so it shouldn't be hideable behind a click. Quick setup handles
          it in one click for the common Mon-Fri case; once periods exist,
          managing them moves into Setup below like Rooms and Bulk import. */}
      {periods.length === 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="mb-2">
            No periods set up yet — the solver needs these before it can generate a
            timetable.
          </p>
          {!readOnly && (
            <button
              onClick={handleQuickSetupPeriods}
              disabled={settingUpPeriods}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {settingUpPeriods ? 'Setting up…' : 'Quick setup: Mon–Fri, 8 periods/day'}
            </button>
          )}
        </div>
      )}

      {/* Periods (once configured), Rooms, and Bulk import are all
          one-time setup actions, not the day-to-day task this tab is
          for — grouped under a single disclosure instead of three
          separate always-present rows, so the subject table below is the
          first thing you see once a school is actually set up. */}
      <button
        onClick={() => setShowSetup((v) => !v)}
        className="w-fit text-xs text-slate-500 underline underline-offset-2"
      >
        Setup — {periods.length} period{periods.length === 1 ? '' : 's'}, {rooms.length} room
        {rooms.length === 1 ? '' : 's'}, bulk import — {showSetup ? 'hide' : 'manage'}
      </button>
      {showSetup && (
        <div className="divide-y divide-slate-200 rounded-md border border-slate-200">
          {periods.length > 0 && (
            <div className="p-4">
              <PeriodsPanel schoolId={schoolId} />
            </div>
          )}
          <div className="p-4">
            <RoomsPanel schoolId={schoolId} />
          </div>
          {!readOnly && (
            <div className="p-4">
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
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="w-10 py-2 font-medium">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={selectedAll}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900"
                />
                <span className="sr-only">Select all</span>
              </label>
            </th>
            <th className="w-1/4 py-2 font-medium">Subject</th>
            <th className="w-32 py-2 font-medium">Periods/week</th>
            <th className="py-2 font-medium">Teachers</th>
            <th className="w-28 py-2 font-medium">Status</th>
            <th className="w-8 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ subject, requirement, periodsPerWeek, qualifiedTeachers, availableTeachers, preferredTeacherId, valid }, i) => (
            <motion.tr
              key={subject.id}
              layout="position"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: Math.min(i, 10) * 0.02, ease: 'easeOut' }}
              className="border-b border-slate-100"
            >
              <td className="py-2 pr-2 align-top">
                <input
                  type="checkbox"
                  checked={selectedSubjectIds.includes(subject.id)}
                  onChange={() => toggleSelectedSubject(subject.id)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900"
                />
              </td>
              <td className="py-2 pr-2">
                <label htmlFor={`subject-name-${subject.id}`} className="sr-only">
                  Subject name
                </label>
                <input
                  id={`subject-name-${subject.id}`}
                  defaultValue={subject.name}
                  disabled={readOnly}
                  onBlur={(e) => e.target.value !== subject.name && handleUpdateName(subject.id, e.target.value)}
                  className="w-full rounded px-1.5 py-1 text-sm hover:bg-slate-50 focus:bg-slate-50 focus:outline-none disabled:bg-transparent disabled:text-slate-700"
                />
                {expandedAdvanced.has(subject.id) ? (
                  <>
                    <label htmlFor={`subject-room-type-${subject.id}`} className="sr-only">
                      Required room type (optional)
                    </label>
                    <input
                      id={`subject-room-type-${subject.id}`}
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
                    {institutionType === 'college' && (
                      <div className="mt-0.5 flex items-center gap-2">
                        <label htmlFor={`subject-batches-${subject.id}`} className="text-xs text-slate-400">
                          Split into
                        </label>
                        <input
                          id={`subject-batches-${subject.id}`}
                          type="number"
                          min="0"
                          max="10"
                          defaultValue={subject.lab_batch_count ?? ''}
                          disabled={readOnly}
                          onBlur={(e) =>
                            Number(e.target.value || 0) !== (subject.lab_batch_count ?? 0) &&
                            handleUpdateLabBatchCount(subject.id, e.target.value)
                          }
                          placeholder="1"
                          title="For lab/practical subjects: split the class into this many simultaneous batches, each with its own teacher and room. Leave blank or 1 for no split."
                          className="w-12 rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                        />
                        <span className="text-xs text-slate-400">batches</span>
                        <label htmlFor={`subject-credits-${subject.id}`} className="sr-only">Credits</label>
                        <input
                          id={`subject-credits-${subject.id}`}
                          type="number"
                          min="0"
                          defaultValue={subject.credits ?? ''}
                          disabled={readOnly}
                          onBlur={(e) =>
                            Number(e.target.value || 0) !== (subject.credits ?? 0) &&
                            handleUpdateCredits(subject.id, e.target.value)
                          }
                          placeholder="Credits"
                          title="Optional — for colleges that track credits per course. Not used by the solver."
                          className="w-16 rounded px-1.5 py-0.5 text-xs text-slate-500 placeholder:text-slate-400 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleAdvanced(subject.id)}
                      className="mt-0.5 text-[11px] text-slate-400 underline underline-offset-2 hover:text-slate-600"
                    >
                      Hide advanced
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleAdvanced(subject.id)}
                    className="mt-0.5 text-[11px] text-slate-400 underline underline-offset-2 hover:text-slate-600"
                  >
                    + Advanced (room type
                    {institutionType === 'college' ? ', credits, lab batches' : ''})
                  </button>
                )}
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
                  <AnimatePresence initial={false}>
                    {qualifiedTeachers.map((t) => (
                      <motion.span
                        key={t.id}
                        layout
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        transition={{ duration: 0.15 }}
                        title={t.id === preferredTeacherId ? 'Preferred teacher for this section' : undefined}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-white ${
                          t.id === preferredTeacherId ? 'bg-emerald-700 ring-2 ring-emerald-200' : 'bg-indigo-600'
                        }`}
                      >
                        {t.id === preferredTeacherId && '★ '}
                        {t.name}
                        {!readOnly && (
                          <button
                            onClick={() => handleRemoveTeacher(subject.id, t)}
                            aria-label={`Remove ${t.name} from ${subject.name}`}
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
                      onClick={() => setOpenDropdownId(openDropdownId === subject.id ? null : subject.id)}
                      className="rounded-full border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      + Add
                    </motion.button>
                  )}
                  <AnimatePresence>
                    {openDropdownId === subject.id && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.96, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: -4 }}
                        transition={{ duration: 0.12, ease: 'easeOut' }}
                        className="absolute left-0 top-7 z-10 max-h-52 w-48 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-md"
                      >
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
                      </motion.div>
                    )}
                  </AnimatePresence>
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
                    onClick={() => handleRemoveSubject(subject.id, subject.name)}
                    className="text-slate-300 hover:text-red-600"
                    title="Remove subject"
                    aria-label={`Remove subject ${subject.name}`}
                  >
                    ✕
                  </button>
                )}
              </td>
            </motion.tr>
          ))}
          {rows.length > 0 && (
            <tr className="bg-slate-50 text-slate-600">
              <td className="py-3 pr-2"></td>
              <td className="py-3 pr-2 text-sm font-semibold">Total</td>
              <td className="py-3 pr-2 font-semibold">{totalWeeklyPeriods}</td>
              <td colSpan={3} className="py-3 text-sm text-slate-500">
                Total periods/week configured for this section.
              </td>
            </tr>
          )}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-sm text-slate-500">
                No subjects yet — add one above.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {!readOnly && teachers.length > 0 && (
        <p className="text-xs text-slate-400">
          {teachers.length} teacher{teachers.length === 1 ? '' : 's'} at this school. Use "+ Add
          teacher" above to add another, or the "+ Add" button next to a subject's teacher list to
          assign an existing one.
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

/**
 * Modal for adding a teacher with their subjects in one step, instead of
 * creating a name-only teacher and then having to find them in every
 * relevant subject's "+ Add" dropdown one at a time. A teacher can teach
 * more than one subject (e.g. a Math teacher who also covers Physics), so
 * this is a multi-select checkbox list, not a single dropdown — mirrors
 * how `qualified_subject_ids` is actually modeled (a list) rather than
 * implying one teacher = one subject.
 */
function AddTeacherModal({ schoolId, subjects, onClose, onAdded }) {
  const [name, setName] = useState('')
  const [selectedSubjectIds, setSelectedSubjectIds] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  function toggleSubject(id) {
    setSelectedSubjectIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
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
            {subjects.length === 0 ? (
              <p className="text-xs text-slate-400">
                No subjects yet — add subjects first, or add this teacher now and assign
                subjects afterward from each subject's teacher list.
              </p>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200 p-2">
                {subjects.map((s) => (
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
