import { useEffect, useState } from 'react'
import { api } from '../api'

/**
 * Landing tab for a selected section: a 3-step status summary (data entry →
 * constraints → generate) with quick links into each tab.
 */
export default function OverviewTab({ schoolId, classGroup, onNavigate }) {
  const [subjectCount, setSubjectCount] = useState(0)
  const [teacherCount, setTeacherCount] = useState(0)
  const [constraintCount, setConstraintCount] = useState(0)
  const [hasTimetable, setHasTimetable] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [subjects, teachers, constraints, timetables] = await Promise.all([
          api.listSubjects(schoolId),
          api.listTeachers(schoolId),
          api.listConstraints(schoolId),
          api.listTimetables(schoolId),
        ])
        setSubjectCount(subjects.length)
        setTeacherCount(teachers.length)
        setConstraintCount(constraints.length)
        setHasTimetable(timetables.length > 0)
      } catch {
        // Overview is a summary view; individual tabs surface real errors.
      }
    }
    load()
  }, [schoolId])

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h3 className="text-lg font-medium">
          {classGroup.grade ? `${classGroup.grade} · ` : ''}Section {classGroup.name}
        </h3>
        <p className="mt-1.5 text-sm text-slate-500">
          Set up subjects and teachers, describe any scheduling constraints, then
          generate the weekly timetable.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StepCard
          step="Step 1"
          title="Data entry"
          body={`${subjectCount} subjects · ${teacherCount} teachers assigned`}
          buttonLabel="Open"
          buttonStyle="secondary"
          onClick={() => onNavigate('entry')}
        />
        <StepCard
          step="Step 2"
          title="Constraints"
          body={`${constraintCount} rules described in plain English`}
          buttonLabel="Open"
          buttonStyle="secondary"
          onClick={() => onNavigate('constraints')}
        />
        <StepCard
          step="Step 3"
          title="Generate"
          body={hasTimetable ? 'Timetable generated' : 'Not generated yet'}
          buttonLabel="Open"
          buttonStyle="primary"
          onClick={() => onNavigate('timetable')}
        />
      </div>
    </div>
  )
}

function StepCard({ step, title, body, buttonLabel, buttonStyle, onClick }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{step}</span>
      <div className="font-medium">{title}</div>
      <p className="text-sm text-slate-500">{body}</p>
      <button
        onClick={onClick}
        className={`mt-1 w-fit rounded-md px-3 py-1.5 text-sm font-medium ${
          buttonStyle === 'primary'
            ? 'bg-slate-900 text-white hover:bg-slate-700'
            : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
        }`}
      >
        {buttonLabel}
      </button>
    </div>
  )
}
