import { useMemo, useState } from 'react'

const COMMON_SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F']
const GRADE_NUMBERS = Array.from({ length: 12 }, (_, i) => i + 1)

/**
 * Range-based alternative to adding one grade/section at a time. Defaults
 * to a simple, click-only UI (from/to dropdowns + section chips) that
 * covers the common case with zero typing; "More options" reveals the
 * original free-text form (custom prefix, non-sequential section names via
 * comma list, letter ranges like "A-D") for schools that don't fit the
 * common pattern.
 *
 * Shared between FirstRunWelcome.jsx (a brand-new school with nothing
 * yet, where this is now the default/primary path since most schools
 * have several grades at once) and Sidebar.jsx (adding more later)
 * rather than duplicated, so the parsing/expansion logic and preview
 * behavior can't drift between the two. `existing` (only meaningful in
 * the Sidebar case) is used to skip combinations that already exist
 * rather than creating duplicates or erroring on a unique-constraint
 * conflict the admin didn't ask for.
 */
export default function BulkAddClassGroups({ onAddClassGroups, existing = [], onDone, institutionType }) {
  const defaultPrefix = institutionType === 'college' ? 'Semester' : 'Grade'
  const [advanced, setAdvanced] = useState(false)

  // Simple mode state
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(10)
  const [selectedSections, setSelectedSections] = useState(() => new Set(['A', 'B', 'C']))
  const [customSection, setCustomSection] = useState('')

  // Advanced mode state (original free-text form)
  const [prefix, setPrefix] = useState(defaultPrefix)
  const [advFrom, setAdvFrom] = useState('1')
  const [advTo, setAdvTo] = useState('12')
  const [advSections, setAdvSections] = useState('A')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const simpleSectionsText = [...selectedSections].sort().join(', ')

  const pairs = useMemo(
    () =>
      advanced
        ? buildPairs(prefix, advFrom, advTo, advSections)
        : buildPairs(defaultPrefix, String(from), String(to), simpleSectionsText),
    [advanced, prefix, advFrom, advTo, advSections, defaultPrefix, from, to, simpleSectionsText]
  )
  const existingKeys = useMemo(
    () => new Set(existing.map((cg) => `${cg.grade || ''}::${cg.name}`)),
    [existing]
  )
  const newPairs = pairs.filter((p) => !existingKeys.has(`${p.grade}::${p.name}`))
  const skippedCount = pairs.length - newPairs.length

  function toggleSection(letter) {
    setSelectedSections((prev) => {
      const next = new Set(prev)
      if (next.has(letter)) next.delete(letter)
      else next.add(letter)
      return next
    })
  }

  function addCustomSection() {
    const value = customSection.trim().toUpperCase()
    if (!value) return
    setSelectedSections((prev) => new Set(prev).add(value))
    setCustomSection('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (newPairs.length === 0 || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onAddClassGroups(newPairs)
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const numberLabel = institutionType === 'college' ? 'semester' : 'grade'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
      {!advanced ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">From {numberLabel}</label>
              <select
                value={from}
                onChange={(e) => setFrom(Number(e.target.value))}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              >
                {GRADE_NUMBERS.map((n) => (
                  <option key={n} value={n}>
                    {defaultPrefix} {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">To {numberLabel}</label>
              <select
                value={to}
                onChange={(e) => setTo(Number(e.target.value))}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              >
                {GRADE_NUMBERS.map((n) => (
                  <option key={n} value={n}>
                    {defaultPrefix} {n}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-500">Sections in each {numberLabel}</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {COMMON_SECTIONS.map((letter) => (
                <button
                  key={letter}
                  type="button"
                  onClick={() => toggleSection(letter)}
                  className={`h-8 w-8 rounded-md text-sm font-medium ${
                    selectedSections.has(letter)
                      ? 'bg-indigo-600 text-white'
                      : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {letter}
                </button>
              ))}
              {[...selectedSections]
                .filter((s) => !COMMON_SECTIONS.includes(s))
                .map((letter) => (
                  <button
                    key={letter}
                    type="button"
                    onClick={() => toggleSection(letter)}
                    className="h-8 rounded-md bg-indigo-600 px-2.5 text-sm font-medium text-white"
                  >
                    {letter} ×
                  </button>
                ))}
              <input
                value={customSection}
                onChange={(e) => setCustomSection(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addCustomSection()
                  }
                }}
                placeholder="Other"
                className="h-8 w-16 rounded-md border border-slate-300 px-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setAdvanced(true)}
            className="w-fit text-xs font-medium text-indigo-600 hover:underline"
          >
            My grades don't follow a pattern
          </button>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">Prefix (optional)</label>
              <input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="Grade, Semester, ..."
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">Sections</label>
              <input
                value={advSections}
                onChange={(e) => setAdvSections(e.target.value)}
                placeholder="A-D, or A, B, C"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">From</label>
              <input
                type="number"
                value={advFrom}
                onChange={(e) => setAdvFrom(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">To</label>
              <input
                type="number"
                value={advTo}
                onChange={(e) => setAdvTo(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setAdvanced(false)}
            className="w-fit text-xs font-medium text-indigo-600 hover:underline"
          >
            Back to simple setup
          </button>
        </>
      )}

      <p className="text-xs text-slate-500">
        {pairs.length === 0
          ? 'Choose a range and at least one section to see a preview.'
          : newPairs.length === 0
          ? 'All of these already exist — nothing new to add.'
          : `This creates ${newPairs.length} section${newPairs.length === 1 ? '' : 's'}` +
            (skippedCount > 0 ? ` (${skippedCount} already exist and will be skipped).` : '.')}
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        disabled={newPairs.length === 0 || submitting}
        className="w-fit rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {submitting ? 'Creating…' : `Create ${newPairs.length || ''} section${newPairs.length === 1 ? '' : 's'}`.trim()}
      </button>
    </form>
  )
}

/**
 * Expands "A-D" into ['A','B','C','D'] (single-letter range, case as
 * typed) or falls back to splitting on commas for anything else — so
 * "A, B, C" and "North, South" both work as an explicit list.
 */
function expandSections(text) {
  const trimmed = text.trim()
  const rangeMatch = trimmed.match(/^([A-Za-z])\s*-\s*([A-Za-z])$/)
  if (rangeMatch) {
    const [, startChar, endChar] = rangeMatch
    const start = startChar.charCodeAt(0)
    const end = endChar.charCodeAt(0)
    if (end >= start && end - start < 26) {
      const out = []
      for (let c = start; c <= end; c++) out.push(String.fromCharCode(c))
      return out
    }
  }
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function buildPairs(prefix, fromStr, toStr, sectionsText) {
  const from = Number(fromStr)
  const to = Number(toStr)
  const sectionList = expandSections(sectionsText)
  if (!Number.isInteger(from) || !Number.isInteger(to) || from > to || to - from > 200 || sectionList.length === 0) {
    return []
  }
  const pairs = []
  for (let n = from; n <= to; n++) {
    const grade = prefix.trim() ? `${prefix.trim()} ${n}` : String(n)
    for (const section of sectionList) {
      pairs.push({ grade, name: section })
    }
  }
  return pairs
}
