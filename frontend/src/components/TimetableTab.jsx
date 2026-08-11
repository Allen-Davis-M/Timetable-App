import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api'
import SubstitutionsTab from './SubstitutionsTab'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const POLL_INTERVAL_MS = 1500

/**
 * Generates a timetable for the whole school (every section + every
 * teacher together, so there are no cross-section conflicts — see
 * backend/app/services/solver.py, which already reads every class group
 * in the school in one solve) and displays it as a day x period grid,
 * either for the currently selected section or for a chosen teacher
 * across all their sections.
 *
 * Generation runs as a background job on the backend (see
 * backend/app/routers/timetables.py) because a large school's solve can
 * take up to a minute — too long to hold an HTTP request open. So instead
 * of awaiting one blocking call, we kick the job off, get back a
 * "generating" row immediately, and poll GET /api/timetables/{id} on an
 * interval until status is no longer "generating".
 *
 * The Export links download the whole school's timetable as a single
 * file (every section + every teacher, one sheet/page each — see
 * backend/app/services/export.py), not just whatever's currently shown
 * on screen, since that's what an admin printing schedules actually
 * wants.
 *
 * Once a timetable is generated, individual slots can be hand-edited in
 * the "By Section" view: click the lock icon to pin a slot so the next
 * regenerate leaves it exactly where it is (see PATCH
 * /api/timetables/entries/{id} in backend/app/routers/timetables.py, and
 * the locked-entry handling in backend/app/services/solver.py), or drag
 * an unlocked entry to a different period to move it by hand. Both go
 * through the same PATCH endpoint, which rejects the change with a
 * message if it would double-book the class, the teacher, or the room —
 * that message is what ends up in `error` and shown below the grid.
 * Editing is section-view-only: the "By Teacher" view mixes entries from
 * several different classes, where "move this" is ambiguous.
 *
 * `page` toggles between this generated-schedule view and Substitutions
 * (SubstitutionsTab) — they used to be separate top-level tabs, but
 * Substitutions is really a sibling lens on the same generated timetable
 * (same data: entries, periods, teachers), not a distinct workflow, so it
 * lives here as a second view instead of adding to the top nav's tab
 * count.
 */
export default function TimetableTab({ schoolId, classGroup, classGroups, teachers, readOnly = false }) {
  const [page, setPage] = useState('schedule') // 'schedule' | 'substitutions'
  const [periods, setPeriods] = useState([])
  const [timetable, setTimetable] = useState(null) // latest TimetableOut from the backend
  const [generating, setGenerating] = useState(false)
  const [view, setView] = useState('section') // 'section' | 'teacher'
  const [selectedTeacherId, setSelectedTeacherId] = useState(teachers[0]?.id ?? null)
  const [error, setError] = useState(null)
  const [dragEntryId, setDragEntryId] = useState(null)
  // Which export format is currently downloading, if any — guards against
  // a double-click firing two downloads with no visual feedback either way.
  const [exporting, setExporting] = useState(null) // null | 'xlsx' | 'pdf'
  const pollRef = useRef(null)

  async function handleExport(format) {
    if (exporting) return
    setExporting(format)
    try {
      await api.downloadTimetableExport(timetable.id, format)
    } catch (err) {
      setError(err.message)
    } finally {
      setExporting(null)
    }
  }

  useEffect(() => {
    api.listPeriods(schoolId).then(setPeriods).catch((err) => setError(err.message))
    setTimetable(null)
    stopPolling()
    return stopPolling
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId])

  useEffect(() => {
    // Re-syncs whenever the teacher list changes — not just when nothing
    // is selected. Without the "still valid" check, switching schools
    // could leave selectedTeacherId pointing at a teacher that doesn't
    // exist in the new school's list at all (a stale id from before),
    // silently rendering an empty "By Teacher" grid with no indication
    // why, until the admin happened to reselect manually.
    const stillValid = teachers.some((t) => t.id === selectedTeacherId)
    if (!stillValid) setSelectedTeacherId(teachers[0]?.id ?? null)
  }, [teachers, selectedTeacherId])

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  function pollUntilDone(timetableId) {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const updated = await api.getTimetable(timetableId)
        setTimetable(updated)
        if (updated.status !== 'generating') {
          stopPolling()
          setGenerating(false)
        }
      } catch (err) {
        stopPolling()
        setGenerating(false)
        setError(err.message)
      }
    }, POLL_INTERVAL_MS)
  }

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    setTimetable(null)
    try {
      const created = await api.generateTimetable(schoolId)
      setTimetable(created)
      if (created.status === 'generating') {
        pollUntilDone(created.id)
      } else {
        setGenerating(false)
      }
    } catch (err) {
      setError(err.message)
      setGenerating(false)
    }
  }

  async function refreshTimetable() {
    if (!timetable) return
    try {
      setTimetable(await api.getTimetable(timetable.id))
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleToggleLock(entry) {
    setError(null)
    try {
      await api.updateTimetableEntry(entry.id, { locked: !entry.locked })
      await refreshTimetable()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDrop(day, order) {
    const entryId = dragEntryId
    setDragEntryId(null)
    if (!entryId) return
    const targetPeriod = periodAt(day, order)
    if (!targetPeriod) return
    // Drop targets are never batched slots — batched cells don't attach
    // onDrop at all (see the isBatched guard on <td> below) — so taking
    // the first match here is safe.
    const targetEntry = entriesFor(day, order)[0] ?? null
    if (targetEntry && targetEntry.id === entryId) return // dropped back on itself
    if (targetEntry && targetEntry.locked) {
      setError("That slot is locked — unlock it before swapping something into it.")
      return
    }
    setError(null)
    try {
      if (targetEntry) {
        // Target cell is already occupied — a plain move would look like
        // a double-booking (the other entry is still "there" until it
        // moves too), so swap both entries' periods in one request instead.
        await api.swapTimetableEntries(entryId, targetEntry.id)
      } else {
        await api.updateTimetableEntry(entryId, { period_id: targetPeriod.id })
      }
      await refreshTimetable()
    } catch (err) {
      setError(err.message)
    }
  }

  const days = [...new Set(periods.map((p) => p.day_of_week))].sort((a, b) => a - b)
  const orders = [...new Set(periods.map((p) => p.order))].sort((a, b) => a - b)

  function periodAt(day, order) {
    return periods.find((p) => p.day_of_week === day && p.order === order)
  }

  // Returns every entry in this slot, not just one — a lab-batch-split
  // subject (Subject.lab_batch_count >= 2, see backend/app/services/
  // solver.py) produces several simultaneous entries at the same class
  // group + period, one per batch, each with its own teacher and room.
  // The normal, unsplit case is just an array of 0 or 1.
  function entriesFor(day, order) {
    const period = periodAt(day, order)
    if (!period || !timetable) return []
    if (view === 'section') {
      return timetable.entries.filter(
        (e) => e.period_id === period.id && e.class_group_id === classGroup.id
      )
    }
    return timetable.entries.filter(
      (e) => e.period_id === period.id && e.teacher_id === selectedTeacherId
    )
  }

  const classGroupName = (id) => classGroups.find((c) => c.id === id)?.name

  const isGenerating = generating || timetable?.status === 'generating'
  const failed = !isGenerating && timetable?.status === 'failed'
  const solved = !isGenerating && timetable?.status === 'draft'

  return (
    <div className="flex flex-col gap-5">
      <div className="inline-flex w-fit rounded-md border border-slate-300 p-0.5 text-xs">
        <button
          onClick={() => setPage('schedule')}
          className={`rounded px-3 py-1.5 font-medium ${page === 'schedule' ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}
        >
          Schedule
        </button>
        <button
          onClick={() => setPage('substitutions')}
          className={`rounded px-3 py-1.5 font-medium ${page === 'substitutions' ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}
        >
          Substitutions
        </button>
      </div>

      {page === 'substitutions' ? (
        <SubstitutionsTab schoolId={schoolId} classGroups={classGroups} teachers={teachers} />
      ) : (
        <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium">Generate timetable</h3>
          <p className="mt-1 text-sm text-slate-500">
            Solves for the whole school at once, so teachers shared across
            sections never overlap. Large schools can take up to a minute —
            feel free to switch tabs while it runs. In the By Section view
            you can drag a slot onto a free cell to move it, drag it onto
            another slot to swap the two, or click 🔓 to lock it in place
            before regenerating.
          </p>
        </div>
        {!readOnly && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleGenerate}
            disabled={isGenerating}
            className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isGenerating ? 'Generating…' : 'Generate Timetable'}
          </motion.button>
        )}
      </div>

      <div className="h-px bg-slate-200" />

      {isGenerating && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-slate-500"
        >
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
          Solving the schedule — this runs in the background, so it's safe
          to keep working elsewhere and come back.
        </motion.div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {failed && (
        <div className="max-w-xl rounded-lg border border-amber-300 bg-amber-50 p-5">
          <div className="font-medium text-amber-900">
            We couldn't build a conflict-free timetable
          </div>
          {/* error_message is newline-joined when the solver diagnosed one
              or more specific causes (see _diagnose_infeasibility in
              backend/app/services/solver.py) — rendered as a list so each
              cause reads as its own point instead of a run-on sentence. */}
          {(() => {
            const lines = (timetable.error_message || 'Generation failed for an unknown reason.')
              .split('\n')
              .filter(Boolean)
            if (lines.length > 1) {
              return (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
                  {lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )
            }
            return <p className="mt-2 text-sm text-amber-800">{lines[0]}</p>
          })()}
        </div>
      )}

      {solved && (
        <motion.div
          key={timetable.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-md border border-slate-300 p-0.5 text-xs">
                <button
                  onClick={() => setView('section')}
                  className={`rounded px-3 py-1 ${view === 'section' ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}
                >
                  By Section
                </button>
                <button
                  onClick={() => setView('teacher')}
                  className={`rounded px-3 py-1 ${view === 'teacher' ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}
                >
                  By Teacher
                </button>
              </div>
              {view === 'teacher' && (
                <select
                  value={selectedTeacherId ?? ''}
                  onChange={(e) => setSelectedTeacherId(Number(e.target.value))}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                >
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Export:</span>
              <button
                onClick={() => handleExport('xlsx')}
                disabled={!!exporting}
                className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                {exporting === 'xlsx' ? 'Preparing…' : 'Excel'}
              </button>
              <button
                onClick={() => handleExport('pdf')}
                disabled={!!exporting}
                className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                {exporting === 'pdf' ? 'Preparing…' : 'PDF'}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="border border-slate-200 px-3 py-2 text-left font-medium">Period</th>
                  {days.map((d) => (
                    <th key={d} className="border border-slate-200 px-3 py-2 text-left font-medium">
                      {DAY_NAMES[d]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order}>
                    <td className="border border-slate-200 px-3 py-2 font-medium text-slate-500">
                      Period {order + 1}
                    </td>
                    {days.map((d) => {
                      const entries = entriesFor(d, order)
                      const period = periodAt(d, order)
                      const editable = view === 'section' && !readOnly
                      // Lab-batch slots (2+ simultaneous entries) aren't
                      // drag/lock-editable in this version — see
                      // solver.py's note on locked entries not being
                      // honored for batched subjects. Editing a single
                      // batch out of several needs its own interaction
                      // (which one? does it drag the whole session or one
                      // batch?) that hasn't been designed yet, so these
                      // slots are view-only for now rather than allowing
                      // an edit that wouldn't survive regeneration anyway.
                      const isBatched = entries.length > 1
                      const singleEntry = entries.length === 1 ? entries[0] : null
                      return (
                        <td
                          key={d}
                          className={`border border-slate-200 px-3 py-2 transition-colors ${editable ? 'align-top' : ''} ${
                            singleEntry || isBatched ? 'hover:bg-slate-50' : ''
                          }`}
                          onDragOver={editable && !isBatched ? (e) => e.preventDefault() : undefined}
                          onDrop={editable && !isBatched ? () => handleDrop(d, order) : undefined}
                        >
                          {!period ? (
                            <span className="text-slate-300">—</span>
                          ) : isBatched ? (
                            <div className="flex flex-col gap-1.5">
                              {entries
                                .slice()
                                .sort((a, b) => (a.lab_batch ?? 0) - (b.lab_batch ?? 0))
                                .map((e) => (
                                  <div key={e.id} className="border-l-2 border-slate-200 pl-1.5">
                                    <div className="font-medium">
                                      {e.subject_name}
                                      {e.lab_batch && (
                                        <span className="ml-1 text-xs font-normal text-slate-400">
                                          Batch {e.lab_batch}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      {view === 'section' ? e.teacher_name : `Sec ${classGroupName(e.class_group_id)}`}
                                    </div>
                                    {e.room_name && <div className="text-xs text-slate-400">{e.room_name}</div>}
                                  </div>
                                ))}
                            </div>
                          ) : singleEntry ? (
                            <div
                              draggable={editable && !singleEntry.locked}
                              onDragStart={editable ? () => setDragEntryId(singleEntry.id) : undefined}
                              onDragEnd={() => setDragEntryId(null)}
                              className={editable && !singleEntry.locked ? 'cursor-move' : ''}
                            >
                              <div className="flex items-start justify-between gap-1">
                                <div className="font-medium">{singleEntry.subject_name}</div>
                                {editable && (
                                  <button
                                    onClick={() => handleToggleLock(singleEntry)}
                                    title={singleEntry.locked ? 'Unlock (movable, may change on regenerate)' : 'Lock (kept in place on regenerate)'}
                                    className={`text-xs leading-none ${singleEntry.locked ? 'text-amber-600' : 'text-slate-300 hover:text-slate-500'}`}
                                  >
                                    {singleEntry.locked ? '🔒' : '🔓'}
                                  </button>
                                )}
                              </div>
                              <div className="text-xs text-slate-500">
                                {view === 'section' ? singleEntry.teacher_name : `Sec ${classGroupName(singleEntry.class_group_id)}`}
                              </div>
                              {singleEntry.room_name && (
                                <div className="text-xs text-slate-400">{singleEntry.room_name}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-300">Free</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {!isGenerating && !timetable && (
        <div className="flex flex-col items-center justify-center gap-1 py-16 text-center text-slate-500">
          <p className="text-sm">No timetable generated yet for this school.</p>
          <p className="text-xs">Add subjects and constraints, then hit Generate.</p>
        </div>
      )}
        </>
      )}
    </div>
  )
}
