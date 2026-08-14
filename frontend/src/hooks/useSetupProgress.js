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
export function useSetupProgress({ schoolId, classGroupId, classGroupLabel, refreshKey }) {
  const [counts, setCounts] = useState({
    periods: 0,
    subjects: 0,
    teachers: 0,
    requirements: 0,
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
    if (!schoolId || !classGroupId) return
    let cancelled = false
    setLoaded(false)
    setLoadError(null)

    async function load() {
      try {
        const [periods, subjects, teachers, requirements, constraints, timetables] = await Promise.all([
          api.listPeriods(schoolId),
          api.listSubjects(schoolId),
          api.listTeachers(schoolId),
          api.listRequirements(classGroupId),
          api.listConstraints(schoolId),
          api.listTimetables(schoolId),
        ])
        if (cancelled) return
        setCounts({
          periods: periods.length,
          subjects: subjects.length,
          teachers: teachers.length,
          requirements: requirements.length,
          constraints: constraints.length,
          hasTimetable: timetables.length > 0,
        })
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
    // learn that a subject/teacher/requirement changed elsewhere on the
    // page, since schoolId/classGroupId alone don't change when that
    // happens and this component doesn't unmount between tab switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, classGroupId, refreshKey])

  const steps = [
    {
      key: 'periods',
      title: "Your school's daily schedule",
      body: counts.periods > 0 ? `${counts.periods} periods set up` : 'Add your period timings — every class is built around this',
      done: counts.periods > 0,
      optional: false,
      tab: 'entry',
    },
    {
      key: 'subjects',
      title: 'Subjects',
      body: counts.subjects > 0 ? `${counts.subjects} subjects added` : 'Add what your school teaches',
      done: counts.subjects > 0,
      optional: false,
      tab: 'entry',
      subView: 'subjects',
    },
    {
      key: 'teachers',
      title: 'Teachers',
      body: counts.teachers > 0 ? `${counts.teachers} teachers added` : 'Add who teaches',
      done: counts.teachers > 0,
      optional: false,
      tab: 'entry',
      subView: 'teachers',
    },
    {
      key: 'plan',
      title: classGroupLabel ? `What ${classGroupLabel} needs` : "This section's plan",
      body: counts.requirements > 0 ? `${counts.requirements} subjects planned` : 'Choose how many periods a week this section needs of each subject',
      done: counts.requirements > 0,
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
