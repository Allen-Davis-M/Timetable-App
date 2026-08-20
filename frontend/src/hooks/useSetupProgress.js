import { useEffect, useState } from 'react'
import { api } from '../api'

/**
 * The six-step journey from a brand-new section to a generated timetable
 * (periods -> subjects -> teachers -> this section's plan -> constraints
 * (optional) -> generate), as real counts fetched from the backend. Used
 * by both the always-visible header progress bar (App.jsx) and the
 * detailed step list (OverviewTab.jsx) so the two can never drift apart —
 * before this, OverviewTab computed its own steps locally and the header
 * had no equivalent at all, meaning progress was invisible on every tab
 * except Overview, which is where a new admin spends the least time (the
 * actual setup work happens on Data Entry and Constraints).
 *
 * Subjects and teachers are two separate steps, not one combined
 * "subjects & teachers" step — they're two separate pages in Data Entry
 * (SubjectsSection.jsx / TeachersSection.jsx) now, so the progress
 * tracking matches the real structure of the work instead of glossing
 * over it.
 */
export function useSetupProgress({
  schoolId,
  classGroupId,
  classGroupLabel,
  refreshKey,
  // periods/subjects/teachers are App.jsx's own state now (see App.jsx's
  // docstring on why they were lifted out of DataEntryTab) — read
  // directly here instead of independently re-fetching them, since
  // App.jsx already keeps them live and this hook re-running its own
  // fetch of the exact same three lists on every tab switch was the
  // remaining cause of the header progress bar (and OverviewTab) taking
  // several seconds to update even after Data Entry itself got fast.
  // Only constraints/timetables have no equivalent lifted state anywhere
  // else, so those are the only two this hook still fetches itself.
  periods = [],
  subjects = [],
  teachers = [],
  // Same idea for the per-section `requirements` count — reuses
  // DataEntryTab's own cache (also lifted to App.jsx) instead of a third
  // independent fetch of the same section's data.
  requirementsCache = {},
  setRequirementsCache,
}) {
  const [counts, setCounts] = useState({
    constraints: 0,
    hasTimetable: false,
  })
  const [loaded, setLoaded] = useState(false)
  // Same reasoning as the old OverviewTab: a failed fetch must not render
  // as "0 of everything, all still to do" — that's indistinguishable from
  // a genuinely brand-new section and could tell an already-set-up admin
  // to redo work they've already done.
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    if (!schoolId) return
    let cancelled = false
    setLoadError(null)

    async function load() {
      try {
        const [constraints, timetables] = await Promise.all([
          api.listConstraints(schoolId),
          api.listTimetables(schoolId),
        ])
        if (cancelled) return
        setCounts((prev) => ({
          ...prev,
          constraints: constraints.length,
          hasTimetable: timetables.length > 0,
        }))
      } catch (err) {
        if (!cancelled) setLoadError(err.message)
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // `refreshKey` (App.jsx passes the active tab) exists purely to force
    // a re-fetch at natural checkpoints — this hook has no other way to
    // learn that a constraint/timetable changed elsewhere on the page,
    // since schoolId alone doesn't change when that happens and this
    // component doesn't unmount between tab switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, refreshKey])

  // Cache-aware, same pattern as DataEntryTab.jsx's own loadRequirements:
  // a section already visited in Data Entry is already in the shared
  // cache, so this resolves with no network call at all; a section this
  // admin hasn't opened yet gets fetched once and the result is written
  // back into the *shared* cache, so DataEntryTab benefits too if they
  // visit it next.
  const requirementsCount = (classGroupId && requirementsCache[classGroupId]?.length) || 0
  useEffect(() => {
    if (!schoolId || !classGroupId || requirementsCache[classGroupId]) return
    let cancelled = false

    async function loadRequirements() {
      try {
        const requirements = await api.listRequirements(classGroupId)
        if (cancelled) return
        setRequirementsCache((prev) => ({ ...prev, [classGroupId]: requirements }))
      } catch (err) {
        if (!cancelled) setLoadError(err.message)
      }
    }
    loadRequirements()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, classGroupId, requirementsCache])

  const steps = [
    {
      key: 'periods',
      title: "Your school's daily schedule",
      body: periods.length > 0 ? `${periods.length} periods set up` : 'Add your period timings — every class is built around this',
      done: periods.length > 0,
      optional: false,
      tab: 'entry',
    },
    {
      key: 'subjects',
      title: 'Subjects',
      body: subjects.length > 0 ? `${subjects.length} subjects added` : 'Add what your school teaches',
      done: subjects.length > 0,
      optional: false,
      tab: 'entry',
      subView: 'subjects',
    },
    {
      key: 'teachers',
      title: 'Teachers',
      body: teachers.length > 0 ? `${teachers.length} teachers added` : 'Add who teaches',
      done: teachers.length > 0,
      optional: false,
      tab: 'entry',
      subView: 'teachers',
    },
    {
      key: 'plan',
      title: classGroupLabel ? `What ${classGroupLabel} needs` : "This section's plan",
      body: requirementsCount > 0 ? `${requirementsCount} subjects planned` : 'Choose how many periods a week this section needs of each subject',
      done: requirementsCount > 0,
      optional: false,
      tab: 'entry',
      subView: 'plan',
    },
    {
      key: 'constraints',
      title: 'Any special rules?',
      body: counts.constraints > 0 ? `${counts.constraints} rules added` : "Optional — skip if there's nothing special, you can add rules anytime",
      done: counts.constraints > 0,
      optional: true,
      tab: 'constraints',
    },
    {
      key: 'generate',
      title: 'Build the timetable',
      body: counts.hasTimetable ? 'Timetable ready' : 'One click builds a complete, conflict-free schedule',
      done: counts.hasTimetable,
      optional: false,
      tab: 'timetable',
    },
  ]

  const requiredSteps = steps.filter((s) => !s.optional)
  const doneRequiredCount = requiredSteps.filter((s) => s.done).length
  const currentStep = steps.find((s) => !s.optional && !s.done)
  const allRequiredDone = requiredSteps.every((s) => s.done)

  return { steps, requiredSteps, doneRequiredCount, currentStep, allRequiredDone, loaded, loadError }
}
