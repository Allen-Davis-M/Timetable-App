import { useMemo, useState } from 'react'

/**
 * Range-based alternative to adding one grade/section at a time. Takes a
 * prefix ("Grade", "Semester", or blank) with a numeric from/to range, and
 * a section list (either a letter range like "A-D" or a comma-separated
 * list like "A, B, C" for schools with non-sequential section names), and
 * creates the full cross-product in one submit — e.g. "Grade 1-12" x
 * "A-C" creates 36 sections in one go instead of 36 separate form
 * submissions.
 *
 * Shared between FirstRunWelcome.jsx (a brand-new school with nothing
 * yet) and Sidebar.jsx (adding more later) rather than duplicated, so the
 * parsing/expansion logic and preview behavior can't drift between the
 * two. `existing` (only meaningful in the Sidebar case) is used to skip
 * combinations that already exist rather than creating duplicates or
 * erroring on a unique-constraint conflict the admin didn't ask for.
 */
export default function BulkAddClassGroups({ onAddClassGroups, existing = [], onDone, institutionType }) {
  const [prefix, setPrefix] = useState(institutionType === 'college' ? 'Semester' : 'Grade')
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState('12')
  const [sections, setSections] = useState('A')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const pairs = useMemo(() => buildPairs(prefix, from, to, sections), [prefix, from, to, sections])
  const existingKeys = useMemo(
    () => new Set(existing.map((cg) => `${cg.grade || ''}::${cg.name}`)),
    [existing]
  )
  const newPairs = pairs.filter((p) => !existingKeys.has(`${p.grade}::${p.name}`))
  const skippedCount = pairs.length - newPairs.length

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

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Prefix (optional)</label>
          <input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="Grade, Semester, ..."
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Sections</label>
          <input
            value={sections}
            onChange={(e) => setSections(e.target.value)}
            placeholder="A-D, or A, B, C"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">From</label>
          <input
            type="number"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">To</label>
          <input
            type="number"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
      </div>

      <p className="text-xs text-slate-500">
        {pairs.length === 0
          ? 'Enter a valid range and section list to see a preview.'
          : newPairs.length === 0
          ? 'All of these already exist — nothing new to add.'
          : `This creates ${newPairs.length} section${newPairs.length === 1 ? '' : 's'}` +
            (skippedCount > 0 ? ` (${skippedCount} already exist and will be skipped).` : '.')}
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        disabled={newPairs.length === 0 || submitting}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
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
