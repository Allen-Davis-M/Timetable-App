import { useEffect, useState } from 'react'
import { api } from '../api'
import BulkImportPanel from './BulkImportPanel'
import PeriodsPanel from './PeriodsPanel'
import RoomsPanel from './RoomsPanel'
import SubjectsSection from './SubjectsSection'
import TeachersSection from './TeachersSection'

const SUB_VIEWS = [
  { id: 'subjects', label: 'Subjects' },
  { id: 'teachers', label: 'Teachers' },
]

/**
 * Data Entry is three separate sub-pages, not one combined table:
 * Subjects (what the school teaches), Teachers (who teaches, and which
 * subjects they cover), and This section's plan (how many periods/week
 * the *currently selected* section needs of each subject, plus which
 * teacher covers it here). Subjects/Teachers are reached from the
 * sidebar's "Subjects & Teachers" item (school-wide, no section
 * implied); the Plan page is reached by clicking a section in the
 * sidebar directly — it has no sub-nav tab of its own, since "click a
 * section to see its plan" already is the navigation for it, and
 * showing the school-wide Subjects/Teachers tabs while a specific
 * section's plan is open just invited the "why does the sidebar say
 * Section 8-B while I'm looking at every teacher in the school"
 * confusion this split is meant to avoid.
 *
 * This used to be a single dense table where every row did five things
 * at once — subject name, room type/credits, periods/week, teacher
 * assignment, preferred-teacher picker, status — which meant "add
 * subjects" and "add teachers" (two genuinely separate tasks for a
 * school admin) were smashed into one screen. Splitting them mirrors how
 * an admin actually thinks about the job ("what do we teach" vs "who
 * teaches" vs "how much does this class need"), and lets each page have
 * its own prominent, correctly-scoped bulk import instead of one import
 * panel with a "which resource am I uploading" dropdown.
 *
 * Only "This section's plan" is genuinely scoped to `classGroupId` —
 * Subjects and Teachers are school-wide. `activeSectionId` on the Plan
 * page can be switched independently of the sidebar's selection (see
 * its own comment below), same as before the split.
 *
 * Periods and Rooms are still shared, foundational setup that doesn't
 * belong to Subjects or Teachers specifically, so they stay above the
 * sub-nav, visible regardless of which sub-page is active.
 */
export default function DataEntryTab({
  schoolId,
  classGroupId,
  institutionType,
  onClassGroupsChanged,
  readOnly = false,
  subView,
  onSubViewChange,
}) {
  const [subjects, setSubjects] = useState([])
  const [teachers, setTeachers] = useState([])
  const [requirements, setRequirements] = useState([])
  const [periods, setPeriods] = useState([])
  const [rooms, setRooms] = useState([])
  const [classGroups, setClassGroups] = useState([])
  const [activeSectionId, setActiveSectionId] = useState(classGroupId)
  const [showSetup, setShowSetup] = useState(false)
  const [error, setError] = useState(null)
  const [selectedSubjectIds, setSelectedSubjectIds] = useState([])
  const [copyTargetIds, setCopyTargetIds] = useState([])
  const [copyPickerOpen, setCopyPickerOpen] = useState(false)
  const [copyingPeriods, setCopyingPeriods] = useState(false)
  const [settingUpPeriods, setSettingUpPeriods] = useState(false)

  // Subjects/Teachers/periods/rooms are school-wide and load regardless
  // of whether any section exists yet — only `requirements` (Plan's
  // periods/week) is genuinely per-section, so it's the one piece that
  // stays empty when there's no active section instead of gating the
  // whole fetch behind one.
  async function load() {
    try {
      const [s, t, p, rm, cg, r] = await Promise.all([
        api.listSubjects(schoolId),
        api.listTeachers(schoolId),
        api.listPeriods(schoolId),
        api.listRooms(schoolId),
        api.listClassGroups(schoolId),
        activeSectionId ? api.listRequirements(activeSectionId) : Promise.resolve([]),
      ])
      setSubjects(s)
      setTeachers(t)
      setPeriods(p)
      setRooms(rm)
      setClassGroups(cg)
      setRequirements(r)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  // Follow the sidebar's selection by default; overridden locally via
  // the Plan page's section switcher without affecting the sidebar.
  useEffect(() => {
    setActiveSectionId(classGroupId)
  }, [classGroupId])

  useEffect(() => {
    if (schoolId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, activeSectionId])

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

  // Bulk import's resource dropdown still includes "Class groups" even on
  // the Subjects/Teachers pages (nothing removed, just re-defaulted — see
  // BulkImportPanel's docstring), so an import triggered from either page
  // needs to refresh the sidebar's class-groups list too, not just this
  // tab's own data.
  async function reloadAll() {
    await load()
    if (onClassGroupsChanged) await onClassGroupsChanged()
  }

  // Handed to SubjectsSection as a small, stable interface so it doesn't
  // need to know about `api` or this component's reload strategy.
  const subjectsApi = {
    async create(data) {
      // Appended locally instead of a full reload (5 parallel GETs) — a
      // brand-new subject can't affect periods/rooms/teachers/requirements,
      // so re-fetching everything here was pure overhead, especially
      // against a remote database.
      const created = await api.createSubject(data)
      setSubjects((prev) => [...prev, created])
      return created
    },
    async update(id, data) {
      await api.updateSubject(id, data)
      await load()
    },
    async delete(id) {
      await api.deleteSubject(id)
      await load()
    },
    reload: reloadAll,
  }

  const teachersApi = {
    async update(id, data) {
      await api.updateTeacher(id, data)
      await load()
    },
    async delete(id) {
      await api.deleteTeacher(id)
      await load()
    },
    reload: reloadAll,
  }

  async function handleUpdatePeriods(subjectId, periodsPerWeek) {
    try {
      // Re-fetch instead of reading from React state to close a race if
      // this field is blurred twice in quick succession (e.g. tabbing
      // through fields) — see PeriodsPerWeekInput's docstring below.
      const fresh = await api.listRequirements(activeSectionId)
      const existing = fresh.find((r) => r.subject_id === subjectId)
      if (existing) {
        if (periodsPerWeek <= 0) {
          await api.deleteRequirement(existing.id)
        } else {
          await api.updateRequirement(existing.id, { periods_per_week: periodsPerWeek })
        }
      } else if (periodsPerWeek > 0) {
        await api.createRequirement(activeSectionId, {
          class_group_id: activeSectionId,
          subject_id: subjectId,
          periods_per_week: periodsPerWeek,
        })
      }
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleSetPreferredTeacher(subjectId, teacherId) {
    try {
      const fresh = await api.listRequirements(activeSectionId)
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
    const periodsPerWeek = requirement?.periods_per_week ?? 0
    return {
      subject,
      periodsPerWeek,
      qualifiedTeachers,
      preferredTeacherId: requirement?.preferred_teacher_id ?? null,
      valid: periodsPerWeek > 0 && qualifiedTeachers.length > 0,
    }
  })

  const otherSections = classGroups.filter((cg) => cg.id !== activeSectionId)

  async function handleCopyPeriodsToOtherSections(targetIds) {
    if (copyingPeriods) return
    const rowsToCopy = selectedSubjectIds.length > 0
      ? rows.filter((row) => selectedSubjectIds.includes(row.subject.id))
      : rows.filter((row) => row.periodsPerWeek > 0)
    if (rowsToCopy.length === 0) {
      setError('Nothing to copy: set some periods/week in this section first.')
      return
    }

    const targets = otherSections.filter((cg) => targetIds.includes(cg.id))
    if (targets.length === 0) {
      setError('Pick at least one section to copy to.')
      return
    }

    if (!window.confirm(`Copy ${rowsToCopy.length} subject assignment${rowsToCopy.length === 1 ? '' : 's'} to ${targets.length} section${targets.length === 1 ? '' : 's'}?`)) {
      return
    }

    setCopyingPeriods(true)
    setError(null)
    try {
      const calls = []
      for (const target of targets) {
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
      setCopyTargetIds([])
      setCopyPickerOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setCopyingPeriods(false)
    }
  }

  const activeSection = classGroups.find((cg) => cg.id === activeSectionId)

  return (
    <div className="flex max-w-5xl flex-col gap-5">
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

      <button
        onClick={() => setShowSetup((v) => !v)}
        className="w-fit text-xs text-slate-500 underline underline-offset-2"
      >
        Setup — {periods.length} period{periods.length === 1 ? '' : 's'}, {rooms.length} room
        {rooms.length === 1 ? '' : 's'} — {showSetup ? 'hide' : 'manage'}
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
              <BulkImportPanel schoolId={schoolId} resource="rooms" onImported={load} />
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {subView === 'plan' ? (
        <button
          onClick={() => onSubViewChange('subjects')}
          className="w-fit text-xs font-medium text-indigo-600 hover:underline"
        >
          ← Manage school subjects &amp; teachers
        </button>
      ) : (
        <nav className="flex gap-1 border-b border-slate-200 text-sm">
          {SUB_VIEWS.map((v) => {
            const count = v.id === 'subjects' ? subjects.length : teachers.length
            return (
              <button
                key={v.id}
                onClick={() => onSubViewChange(v.id)}
                className={`-mb-px border-b-2 px-3 py-2 font-medium ${
                  subView === v.id
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {v.label}
                <span className="ml-1 text-xs text-slate-400">({count})</span>
              </button>
            )
          })}
        </nav>
      )}

      {subView === 'subjects' && (
        <SubjectsSection
          schoolId={schoolId}
          subjects={subjects}
          onSubjectsChanged={subjectsApi}
          institutionType={institutionType}
          readOnly={readOnly}
        />
      )}

      {subView === 'teachers' && (
        <TeachersSection
          schoolId={schoolId}
          teachers={teachers}
          subjects={subjects}
          onTeachersChanged={teachersApi}
          readOnly={readOnly}
        />
      )}

      {subView === 'plan' && (
        <PlanSection
          rows={rows}
          classGroups={classGroups}
          otherSections={otherSections}
          activeSectionId={activeSectionId}
          activeSection={activeSection}
          onActiveSectionChange={setActiveSectionId}
          onUpdatePeriods={handleUpdatePeriods}
          onSetPreferredTeacher={handleSetPreferredTeacher}
          selectedSubjectIds={selectedSubjectIds}
          onSelectedSubjectIdsChange={setSelectedSubjectIds}
          copyTargetIds={copyTargetIds}
          onCopyTargetIdsChange={setCopyTargetIds}
          copyPickerOpen={copyPickerOpen}
          onCopyPickerOpenChange={setCopyPickerOpen}
          onCopyToOtherSections={handleCopyPeriodsToOtherSections}
          copyingPeriods={copyingPeriods}
          onGoToSubjects={() => onSubViewChange('subjects')}
          readOnly={readOnly}
        />
      )}
    </div>
  )
}

/**
 * "How many periods/week does the currently selected section need of
 * each subject" plus which teacher covers it here — the one genuinely
 * per-section question in Data Entry. Everything else (subject list,
 * teacher list/qualifications) lives on the other two sub-pages; this
 * one only reads them.
 */
function PlanSection({
  rows,
  classGroups,
  otherSections,
  activeSectionId,
  activeSection,
  onActiveSectionChange,
  onUpdatePeriods,
  onSetPreferredTeacher,
  selectedSubjectIds,
  onSelectedSubjectIdsChange,
  copyTargetIds,
  onCopyTargetIdsChange,
  copyPickerOpen,
  onCopyPickerOpenChange,
  onCopyToOtherSections,
  copyingPeriods,
  onGoToSubjects,
  readOnly,
}) {
  const totalWeeklyPeriods = rows.reduce((sum, row) => sum + row.periodsPerWeek, 0)
  const selectedAll = selectedSubjectIds.length === rows.length && rows.length > 0
  const selectedCount = selectedSubjectIds.length

  function toggleSelectedSubject(subjectId) {
    onSelectedSubjectIdsChange(
      selectedSubjectIds.includes(subjectId)
        ? selectedSubjectIds.filter((id) => id !== subjectId)
        : [...selectedSubjectIds, subjectId]
    )
  }

  function toggleSelectAll() {
    onSelectedSubjectIdsChange(selectedAll ? [] : rows.map((row) => row.subject.id))
  }

  if (classGroups.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
        <p>
          No grades/sections yet — use "+ Add" in the sidebar to create one, then come back here
          to plan periods/week per subject.
        </p>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
        <p className="mb-2">No subjects yet — add some on the Subjects page first.</p>
        <button
          onClick={onGoToSubjects}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Go to Subjects
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h4 className="text-base font-medium">This section's plan</h4>
        <p className="mt-1 text-sm text-slate-500">
          How many periods/week this section needs of each subject, and who teaches it here.
        </p>
      </div>

      <div className="rounded-md border border-indigo-200 bg-indigo-50/60 p-4 text-sm text-slate-600">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <strong>{totalWeeklyPeriods}</strong> total periods/week for
            {classGroups.length > 1 ? (
              <>
                <label htmlFor="active-section-select" className="sr-only">Section</label>
                <select
                  id="active-section-select"
                  value={activeSectionId ?? ''}
                  onChange={(e) => onActiveSectionChange(Number(e.target.value))}
                  className="rounded-md border border-indigo-300 bg-white px-2 py-1 text-sm font-medium text-indigo-700 focus:border-indigo-500 focus:outline-none"
                >
                  {classGroups.map((cg) => (
                    <option key={cg.id} value={cg.id}>
                      {cg.grade ? `${cg.grade} · ` : ''}Section {cg.name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <span className="font-medium">
                {activeSection ? (activeSection.grade ? `${activeSection.grade} · ` : '') + `Section ${activeSection.name}` : 'this section'}
              </span>
            )}
          </div>
          {!readOnly && (
            <div className="relative flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleSelectAll}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-100"
              >
                {selectedAll ? 'Clear selection' : `Select ${rows.length} subject${rows.length === 1 ? '' : 's'}`}
              </button>
              <button
                type="button"
                onClick={() => onCopyPickerOpenChange(!copyPickerOpen)}
                disabled={copyingPeriods || otherSections.length === 0}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
              >
                {copyingPeriods
                  ? 'Copying…'
                  : `Copy ${selectedCount > 0 ? selectedCount : rows.filter((row) => row.periodsPerWeek > 0).length} subject${(selectedCount > 0 ? selectedCount : rows.filter((row) => row.periodsPerWeek > 0).length) === 1 ? '' : 's'} to…`}
              </button>
              {copyPickerOpen && (
                <CopyTargetPicker
                  otherSections={otherSections}
                  copyTargetIds={copyTargetIds}
                  onCopyTargetIdsChange={onCopyTargetIdsChange}
                  onCancel={() => onCopyPickerOpenChange(false)}
                  onConfirm={() => onCopyToOtherSections(copyTargetIds)}
                  copying={copyingPeriods}
                />
              )}
            </div>
          )}
        </div>
      </div>

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
            <th className="w-1/3 py-2 font-medium">Subject</th>
            <th className="w-32 py-2 font-medium">Periods/week</th>
            <th className="py-2 font-medium">Teacher</th>
            <th className="w-28 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ subject, periodsPerWeek, qualifiedTeachers, preferredTeacherId, valid }) => (
            <tr key={subject.id} className="border-b border-slate-100">
              <td className="py-2 pr-2 align-top">
                <input
                  type="checkbox"
                  checked={selectedSubjectIds.includes(subject.id)}
                  onChange={() => toggleSelectedSubject(subject.id)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900"
                />
              </td>
              <td className="py-2 pr-2">{subject.name}</td>
              <td className="py-2 pr-2">
                <PeriodsPerWeekInput
                  value={periodsPerWeek}
                  onSave={(val) => onUpdatePeriods(subject.id, val)}
                  disabled={readOnly}
                />
              </td>
              <td className="py-2 pr-2">
                {qualifiedTeachers.length === 0 ? (
                  <span className="text-xs text-slate-400">No qualified teacher yet</span>
                ) : qualifiedTeachers.length === 1 ? (
                  <span className="text-sm text-slate-600">{qualifiedTeachers[0].name}</span>
                ) : (
                  <select
                    value={preferredTeacherId ?? ''}
                    disabled={readOnly || periodsPerWeek <= 0}
                    onChange={(e) =>
                      onSetPreferredTeacher(subject.id, e.target.value ? Number(e.target.value) : null)
                    }
                    title="Which teacher covers this section — pinning one speeds up generation for large schools"
                    className="rounded border border-indigo-200 bg-indigo-50/40 px-1.5 py-1 text-xs text-indigo-700 hover:bg-indigo-50"
                  >
                    <option value="">Any (let solver choose)</option>
                    {qualifiedTeachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
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
            </tr>
          ))}
          <tr className="bg-slate-50 text-slate-600">
            <td className="py-3 pr-2"></td>
            <td className="py-3 pr-2 text-sm font-semibold">Total</td>
            <td className="py-3 pr-2 font-semibold">{totalWeeklyPeriods}</td>
            <td colSpan={2} className="py-3 text-sm text-slate-500">
              Total periods/week configured for the section selected above.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/**
 * Small dropdown-style panel for picking which sections a "copy periods"
 * action should apply to, instead of silently always copying to every
 * other section in the school — a school with several unrelated grades
 * (say, 6 and 11) has no reason to want grade 6's subject plan pushed
 * into grade 11 just because they're both "other sections."
 */
function CopyTargetPicker({ otherSections, copyTargetIds, onCopyTargetIdsChange, onCancel, onConfirm, copying }) {
  const allSelected = copyTargetIds.length === otherSections.length && otherSections.length > 0

  function toggleTarget(id) {
    onCopyTargetIdsChange(
      copyTargetIds.includes(id) ? copyTargetIds.filter((x) => x !== id) : [...copyTargetIds, id]
    )
  }

  function toggleAll() {
    onCopyTargetIdsChange(allSelected ? [] : otherSections.map((cg) => cg.id))
  }

  return (
    <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded-md border border-slate-200 bg-white p-3 shadow-lg">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">Copy to which sections?</span>
        <button type="button" onClick={toggleAll} className="text-xs font-medium text-indigo-600 hover:underline">
          {allSelected ? 'Clear' : 'Select all'}
        </button>
      </div>
      <div className="mt-2 max-h-48 overflow-y-auto">
        {otherSections.map((cg) => (
          <label key={cg.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50">
            <input
              type="checkbox"
              checked={copyTargetIds.includes(cg.id)}
              onChange={() => toggleTarget(cg.id)}
            />
            {cg.grade ? `${cg.grade} · ` : ''}Section {cg.name}
          </label>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-xs font-medium text-slate-500 hover:text-slate-700">
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={copying || copyTargetIds.length === 0}
          className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {copying ? 'Copying…' : `Copy to ${copyTargetIds.length || ''} section${copyTargetIds.length === 1 ? '' : 's'}`}
        </button>
      </div>
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
