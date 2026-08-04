import { useEffect, useState } from 'react'
import { api } from '../api'

/**
 * Landing tab for a selected section: an onboarding checklist that walks a
 * new admin through the real order of operations (periods -> subjects &
 * teachers -> this section's requirements -> constraints (optional) ->
 * generate), not just a static 3-card summary. Each step shows done/not
 * done based on real counts, and the first incomplete *required* step
 * (constraints is the only optional one) is highlighted so there's always
 * one obvious next action instead of five equally-weighted cards.
 *
 * This exists because periods and subjects/teachers/class-requirements are
 * silent prerequisites for generation with no guidance anywhere else in
 * the app: DataEntryTab collapses the periods setup behind a toggle (see
 * its own docstring), and a school with none of this filled in just gets
 * a raw "No qualified teacher found..." or "no periods defined" error the
 * first time it tries to generate. Surfacing the checklist here means a
 * new admin sees the full path before they hit those errors, not after.
 */
export default function OverviewTab({ schoolId, classGroupId, classGroup, onNavigate }) {
  const [periodCount, setPeriodCount] = useState(0)
  const [subjectCount, setSubjectCount] = useState(0)
  const [teacherCount, setTeacherCount] = useState(0)
  const [requirementCount, setRequirementCount] = useState(0)
  const [constraintCount, setConstraintCount] = useState(0)
  const [hasTimetable, setHasTimetable] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // If these calls fail, the checklist would otherwise render every step
  // as "0 configured / not done" — indistinguishable from a genuinely
  // empty new school, and could tell an admin to "set up periods" they
  // actually already have. Track the failure explicitly instead of
  // swallowing it, so the checklist can say "couldn't load" rather than
  // confidently lying about the school's real state.
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
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
        setPeriodCount(periods.length)
        setSubjectCount(subjects.length)
        setTeacherCount(teachers.length)
        setRequirementCount(requirements.length)
        setConstraintCount(constraints.length)
        setHasTimetable(timetables.length > 0)
      } catch (err) {
        setLoadError(err.message)
      } finally {
        setLoaded(true)
      }
    }
    load()
  }, [schoolId, classGroupId])

  const steps = [
    {
      key: 'periods',
      title: 'Set up periods',
      body: periodCount > 0 ? `${periodCount} periods defined` : 'No periods yet — every school needs its weekly period grid before anything else',
      done: periodCount > 0,
      optional: false,
      target: 'entry',
    },
    {
      key: 'subjects',
      title: 'Add subjects & teachers',
      body: `${subjectCount} subjects · ${teacherCount} teachers`,
      done: subjectCount > 0 && teacherCount > 0,
      optional: false,
      target: 'entry',
    },
    {
      key: 'requirements',
      title: `This section's requirements`,
      body: requirementCount > 0 ? `${requirementCount} subjects assigned periods/week` : `Section ${classGroup.name} doesn't need any subjects yet`,
      done: requirementCount > 0,
      optional: false,
      target: 'entry',
    },
    {
      key: 'constraints',
      title: 'Constraints',
      body: constraintCount > 0 ? `${constraintCount} rules described in plain English` : 'Optional — skip if this section has no special rules',
      done: constraintCount > 0,
      optional: true,
      target: 'constraints',
    },
    {
      key: 'generate',
      title: 'Generate',
      body: hasTimetable ? 'Timetable generated' : 'Not generated yet',
      done: hasTimetable,
      optional: false,
      target: 'timetable',
    },
  ]

  // The first step that's both required and not done — this is the one
  // thing to highlight as "do this next". Once every required step is
  // done, nothing is current (the checklist just shows all-green).
  const currentKey = steps.find((s) => !s.optional && !s.done)?.key
  const allRequiredDone = steps.every((s) => s.optional || s.done)

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h3 className="text-lg font-medium">
          {classGroup.grade ? `${classGroup.grade} · ` : ''}Section {classGroup.name}
        </h3>
        <p className="mt-1.5 text-sm text-slate-500">
          {allRequiredDone
            ? 'Everything needed to generate a timetable is set up for this section.'
            : 'Follow these steps in order — each one unlocks the next.'}
        </p>
      </div>

      {loadError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Couldn't load this section's status ({loadError}) — the checklist below may not reflect
          what's actually set up. Try switching sections and back, or check your connection.
        </p>
      )}

      <div className="flex flex-col gap-2.5">
        {steps.map((step, i) => (
          <StepRow
            key={step.key}
            index={i + 1}
            step={step}
            current={loaded && step.key === currentKey}
            onClick={() => onNavigate(step.target)}
          />
        ))}
      </div>
    </div>
  )
}

function StepRow({ index, step, current, onClick }) {
  return (
    <div
      className={`flex items-center gap-4 rounded-lg border p-4 ${
        current ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
      }`}
    >
      <div
        className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs font-semibold ${
          step.done
            ? 'bg-emerald-600 text-white'
            : current
              ? 'bg-slate-900 text-white'
              : 'bg-slate-100 text-slate-400'
        }`}
      >
        {step.done ? '✓' : index}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{step.title}</span>
          {step.optional && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Optional
            </span>
          )}
          {current && (
            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
              Do this next
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm text-slate-500">{step.body}</p>
      </div>

      <button
        onClick={onClick}
        className={`flex-none rounded-md px-3 py-1.5 text-sm font-medium ${
          current
            ? 'bg-slate-900 text-white hover:bg-slate-700'
            : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
        }`}
      >
        {step.done ? 'Review' : 'Open'}
      </button>
    </div>
  )
}
