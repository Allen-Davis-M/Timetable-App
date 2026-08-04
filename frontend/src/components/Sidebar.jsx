import { useMemo, useState } from 'react'

/**
 * Left nav: school branding + switcher, then a Grade > Section tree built
 * from class groups grouped by their `grade` field. Ungrouped class groups
 * (grade is null) show under an "Ungrouped" heading so nothing silently
 * disappears from the tree.
 */
export default function Sidebar({
  schoolName,
  schools,
  selectedSchoolId,
  onSelectSchool,
  onAddSchool,
  classGroups,
  selectedClassGroupId,
  onSelectClassGroup,
  onAddClassGroup,
  readOnly = false,
}) {
  const [expanded, setExpanded] = useState({})
  const [addingGrade, setAddingGrade] = useState(false)
  const [newGrade, setNewGrade] = useState('')
  const [newSection, setNewSection] = useState('')
  const [submittingSection, setSubmittingSection] = useState(false)

  const grades = useMemo(() => {
    const map = new Map()
    for (const cg of classGroups) {
      const key = cg.grade || 'Ungrouped'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(cg)
    }
    return Array.from(map.entries())
  }, [classGroups])

  function toggle(grade) {
    setExpanded((prev) => ({ ...prev, [grade]: !prev[grade] }))
  }

  async function handleAddSubmit(e) {
    e.preventDefault()
    if (!newGrade.trim() || !newSection.trim() || submittingSection) return
    setSubmittingSection(true)
    try {
      await onAddClassGroup(newGrade.trim(), newSection.trim())
      setNewGrade('')
      setNewSection('')
      setAddingGrade(false)
    } finally {
      setSubmittingSection(false)
    }
  }

  return (
    <aside className="flex w-68 flex-none flex-col gap-4 border-r border-slate-200 bg-white p-3.5" style={{ width: 272 }}>
      <div className="flex items-center gap-2.5 px-1">
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-slate-900 text-sm font-semibold text-slate-900">
          {schoolName?.[0]?.toUpperCase() || 'S'}
        </div>
        <div className="min-w-0">
          {schools.length > 1 ? (
            <select
              value={selectedSchoolId ?? ''}
              onChange={(e) => onSelectSchool(Number(e.target.value))}
              className="w-full truncate bg-transparent text-sm font-semibold focus:outline-none"
            >
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="truncate text-sm font-semibold leading-tight">{schoolName}</div>
          )}
          <div className="text-xs text-slate-500">Admin</div>
        </div>
      </div>

      <div className="h-px bg-slate-200" />

      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
          Grades &amp; sections
        </span>
        {!readOnly && (
          <button
            onClick={() => setAddingGrade((v) => !v)}
            className="text-xs text-slate-400 hover:text-slate-700"
            title="Add grade / section"
          >
            + Add
          </button>
        )}
      </div>

      {!readOnly && addingGrade && (
        <form onSubmit={handleAddSubmit} className="flex flex-col gap-1.5 rounded-md bg-slate-50 p-2">
          <label htmlFor="sidebar-new-grade" className="sr-only">Grade / Year</label>
          <input
            id="sidebar-new-grade"
            value={newGrade}
            onChange={(e) => setNewGrade(e.target.value)}
            placeholder="Grade 8, or Semester 3"
            disabled={submittingSection}
            className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-60"
          />
          <label htmlFor="sidebar-new-section" className="sr-only">Section / Division</label>
          <input
            id="sidebar-new-section"
            value={newSection}
            onChange={(e) => setNewSection(e.target.value)}
            placeholder="A, or Div B"
            disabled={submittingSection}
            className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-60"
          />
          <button
            disabled={submittingSection}
            className="rounded bg-slate-900 py-1 text-xs font-medium text-white disabled:opacity-60"
          >
            {submittingSection ? 'Adding…' : 'Add section'}
          </button>
        </form>
      )}

      <div className="flex flex-1 flex-col gap-px overflow-y-auto">
        {grades.map(([grade, sections]) => (
          <div key={grade}>
            <div
              onClick={() => toggle(grade)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggle(grade)
                }
              }}
              className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1.5 text-sm hover:bg-slate-50"
            >
              <span
                className="inline-flex opacity-60 transition-transform"
                style={{ transform: expanded[grade] ? 'rotate(90deg)' : 'rotate(0deg)' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
              <span>{grade}</span>
            </div>
            {expanded[grade] !== false && (
              <div className="mb-0.5 flex flex-col gap-px pl-6">
                {sections.map((cg) => {
                  const selected = cg.id === selectedClassGroupId
                  return (
                    <div
                      key={cg.id}
                      onClick={() => onSelectClassGroup(cg.id)}
                      role="button"
                      tabIndex={0}
                      aria-current={selected ? 'true' : undefined}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onSelectClassGroup(cg.id)
                        }
                      }}
                      className={`cursor-pointer rounded px-2.5 py-1.5 text-sm ${
                        selected
                          ? 'border-l-2 border-slate-900 bg-slate-100 font-medium text-slate-900'
                          : 'border-l-2 border-transparent text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      Section {cg.name}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
        {grades.length === 0 && (
          <p className="px-1 py-2 text-xs text-slate-400">
            No grades yet — add one above to get started.
          </p>
        )}
      </div>

      <div className="h-px bg-slate-200" />
      <button
        onClick={onAddSchool}
        className="px-1 text-left text-xs text-slate-400 hover:text-slate-700"
      >
        + Add another school
      </button>
    </aside>
  )
}
