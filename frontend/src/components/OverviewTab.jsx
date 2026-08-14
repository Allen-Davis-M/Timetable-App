import { useState } from 'react'
import { useSetupProgress } from '../hooks/useSetupProgress'

/**
 * Landing tab for a selected section: walks a new admin through the real
 * order of operations (periods -> subjects -> teachers -> this section's
 * plan -> constraints (optional) -> generate) one step at a time rather
 * than as six equally-weighted cards. Only the current step is shown by
 * default (progress bar + one big card, one obvious button); the full
 * list is available behind "Show all steps" for anyone who wants the
 * overview, but isn't the default view.
 *
 * Step data comes from useSetupProgress, shared with the header's
 * compact progress bar (App.jsx) and SetupProgressBar.jsx — so this
 * detailed view and the always-visible header summary can't disagree
 * about what's left.
 */
export default function OverviewTab({ schoolId, classGroupId, classGroup, onNavigate }) {
  const [showAll, setShowAll] = useState(false)

  const { steps, requiredSteps, doneRequiredCount, currentStep, allRequiredDone, loaded, loadError } =
    useSetupProgress({
      schoolId,
      classGroupId,
      classGroupLabel: classGroup ? `Section ${classGroup.name}` : null,
    })

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h3 className="text-lg font-medium">
          {classGroup.grade ? `${classGroup.grade} · ` : ''}Section {classGroup.name}
        </h3>
        <p className="mt-1.5 text-sm text-slate-500">
          {allRequiredDone
            ? 'Everything needed to generate a timetable is set up for this section.'
            : "Let's get this section ready, one step at a time."}
        </p>
      </div>

      {loadError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Couldn't load this section's status ({loadError}) — what's shown below may not reflect
          what's actually set up. Try switching sections and back, or check your connection.
        </p>
      )}

      {!allRequiredDone && (
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all"
              style={{ width: `${(doneRequiredCount / requiredSteps.length) * 100}%` }}
            />
          </div>
          <span className="flex-none text-xs font-medium text-slate-500">
            {doneRequiredCount} of {requiredSteps.length} done
          </span>
        </div>
      )}

      {loaded && currentStep && !showAll && (
        <StepRow step={currentStep} current onClick={() => onNavigate(currentStep.tab, currentStep.subView)} big />
      )}

      {allRequiredDone && !showAll && (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-5">
          <p className="text-sm font-medium text-emerald-800">
            This section is ready — the timetable can be generated.
          </p>
          <button
            onClick={() => onNavigate('timetable')}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {steps.find((s) => s.key === 'generate')?.done ? 'Review timetable' : 'Build the timetable'}
          </button>
        </div>
      )}

      {showAll && (
        <div className="flex flex-col gap-2.5">
          {steps.map((step, i) => (
            <StepRow
              key={step.key}
              index={i + 1}
              step={step}
              current={loaded && step.key === currentStep?.key}
              onClick={() => onNavigate(step.tab, step.subView)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowAll((v) => !v)}
        className="w-fit text-xs font-medium text-slate-400 hover:text-slate-600 hover:underline"
      >
        {showAll ? 'Show just the next step' : 'Show all steps'}
      </button>
    </div>
  )
}

function StepRow({ index, step, current, onClick, big }) {
  if (big) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-indigo-600 bg-indigo-50/60 p-5">
        <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
          Do this next
        </span>
        <div>
          <p className="text-base font-medium">{step.title}</p>
          <p className="mt-1 text-sm text-slate-500">{step.body}</p>
        </div>
        <button
          onClick={onClick}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Continue
        </button>
      </div>
    )
  }

  return (
    <div
      className={`flex items-center gap-4 rounded-lg border p-4 ${
        current ? 'border-indigo-600 bg-indigo-50/60' : 'border-slate-200'
      }`}
    >
      <div
        className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs font-semibold ${
          step.done
            ? 'bg-emerald-600 text-white'
            : current
              ? 'bg-indigo-600 text-white'
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
            <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
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
            ? 'bg-indigo-600 text-white hover:bg-indigo-700'
            : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
        }`}
      >
        {step.done ? 'Review' : 'Open'}
      </button>
    </div>
  )
}
