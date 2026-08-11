import { useState } from 'react'
import BulkAddClassGroups from './BulkAddClassGroups'

/**
 * Shown instead of the tab area when a school has zero grades/sections yet
 * (App.jsx: `selectedSchool && !selectedClassGroup`). This exists because
 * every other tab (Overview, Data Entry, Constraints, Timetable) needs a
 * selected class group to render anything meaningful — Data Entry's
 * "requirements" list, Overview's checklist, and Timetable's grid are all
 * scoped to one section — so a school with no sections at all previously
 * just saw a tiny "Add a grade/section to get started" hint buried in the
 * header, with no explanation of what happens after that, or why a
 * section has to exist before periods/subjects/teachers (which are
 * actually school-wide, not per-section) can be entered.
 *
 * This screen front-loads that explanation and puts the same "add a
 * grade/section" form Sidebar.jsx already has front and center instead of
 * as a small "+ Add" toggle, so a brand-new admin's very first action has
 * an obvious, unmissable place to happen. Once a section is added, App.jsx
 * selects it automatically and OverviewTab's checklist takes over guiding
 * the rest of the setup (periods -> subjects & teachers -> this section's
 * requirements -> constraints (optional) -> generate).
 */
export default function FirstRunWelcome({ schoolName, institutionType, onAddClassGroup, onAddClassGroups }) {
  const [grade, setGrade] = useState('')
  const [section, setSection] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState('single') // 'single' | 'range'

  async function handleSubmit(e) {
    e.preventDefault()
    if (!grade.trim() || !section.trim()) return
    setSubmitting(true)
    try {
      await onAddClassGroup(grade.trim(), section.trim())
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold">Welcome to {schoolName}</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          A timetable is built one year/section at a time. Add your first one below to get
          started — you'll fill in periods, subjects, and teachers right after.
        </p>
      </div>

      <ol className="flex flex-col gap-2 text-sm text-slate-500">
        <li className="flex items-center gap-2.5">
          <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-indigo-600 text-[11px] font-semibold text-white">1</span>
          Add a year and section — e.g. "Grade 8" / "A" for a school, or "Semester 3" / "Div B" for a college — right here
        </li>
        <li className="flex items-center gap-2.5">
          <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-500">2</span>
          Set up periods, subjects, and teachers for the school
        </li>
        <li className="flex items-center gap-2.5">
          <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-500">3</span>
          Say how many periods/week this section needs of each subject
        </li>
        <li className="flex items-center gap-2.5">
          <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-500">4</span>
          Generate the timetable
        </li>
      </ol>

      <div className="flex gap-1 text-xs">
        <button
          type="button"
          onClick={() => setMode('single')}
          className={`rounded-md px-2.5 py-1 font-medium ${mode === 'single' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          Add one
        </button>
        <button
          type="button"
          onClick={() => setMode('range')}
          className={`rounded-md px-2.5 py-1 font-medium ${mode === 'range' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          Add a range (e.g. Grade 1-12)
        </button>
      </div>

      {mode === 'single' ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-5">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Grade / Year</label>
            <input
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              placeholder={institutionType === 'college' ? 'Semester 3' : 'Grade 8'}
              autoFocus
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Section / Division</label>
            <input
              value={section}
              onChange={(e) => setSection(e.target.value)}
              placeholder="A, or Div B"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <button
            disabled={submitting || !grade.trim() || !section.trim()}
            className="mt-1 w-fit rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? 'Adding…' : 'Add section and continue'}
          </button>
        </form>
      ) : (
        <BulkAddClassGroups onAddClassGroups={onAddClassGroups} institutionType={institutionType} />
      )}

      <p className="text-xs text-slate-400">
        Have more than one year/section? Add the rest later from the sidebar, or use "Add a
        range" above to create several at once.
      </p>
    </div>
  )
}
