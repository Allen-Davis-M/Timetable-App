import { useEffect, useState } from 'react'
import { api } from '../api'

/**
 * The six-step journey from a brand-new section to a generated timetable
 * (periods -> subjects -> teachers -> this section's plan -> constraints
 * (optional) -> generate), as real counts read from App.jsx's own live
 * state. Used by both the always-visible header progress bar (App.jsx)
 * and the detailed step list (OverviewTab.jsx) so the two can never drift
 * apart — before this, OverviewTab computed its own steps locally and the
 * header had no equivalent at all, meaning progress was invisible on
 * every tab except Overview, which is where a new admin spends the least
 * time (the actual setup work happens on Data Entry and Constraints).
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
  // periods/subjects/teachers/constraints are all App.jsx's own state now
  // (see App.jsx's docstrings on why each was lifted out of its
  // originally-owning tab) — read directly here instead of independently
  // re-fetching them, since App.jsx already keeps them live and this hook
  // re-running its own fetch of the same lists on every tab switch was
  // the remaining cause of the header progress bar (and OverviewTab, and
  // ConstraintsTab itself) taking a visible beat to update even after
  // Data Entry's equivalent lag had already been fixed.
  periods = [],
  subjects = [],
  teachers = [],
  constraints = [],
  hasTimetable = false,
  // Same idea for the per-section `requirements` count — reuses
  // DataEntryTab's own cache (also lifted to App.jsx) instead of a third
  // independent fetch of the same section's data.
  requirementsCache = {},
  setRequirementsCache,
}) {
  const loaded = Boolean(schoolId)
  // Only the per-section requirements fetch below can still fail here —
  // everything else this hook reports is passed-in state, not something
  // it fetches itself, so there's nothing else for this to catch.
  const [loadError, setLoadError] = useState(null)

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
      subView: 'setup',
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
      body: constraints.length > 0 ? `${constraints.length} rules added` : "Optional — skip if there's nothing special, you can add rules anytime",
      done: constraints.length > 0,
      optional: true,
      tab: 'constraints',
    },
    {
      key: 'generate',
      title: 'Build the timetable',
      body: hasTimetable ? 'Timetable ready' : 'One click builds a complete, conflict-free schedule',
      done: hasTimetable,
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
