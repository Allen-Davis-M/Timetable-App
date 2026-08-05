import { useEffect, useState, useMemo } from 'react'
import { api } from '../api'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function SubstitutionsTab({ schoolId, teachers, classGroups }) {
  const [periods, setPeriods] = useState([])
  const [timetable, setTimetable] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  const [selectedDay, setSelectedDay] = useState(0) // 0 for Monday
  const [absentTeacherIds, setAbsentTeacherIds] = useState([])
  
  // substitutions: record of { entryId: substituteTeacherId }
  const [substitutions, setSubstitutions] = useState({})
  const [logs, setLogs] = useState([])
  
  const [view, setView] = useState('new') // 'new' | 'history'

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      try {
        const [periodsData, timetablesData, logsData] = await Promise.all([
          api.listPeriods(schoolId),
          api.listTimetables(schoolId),
          api.listSubstitutionLogs(schoolId)
        ])
        setPeriods(periodsData)
        setLogs(logsData)
        
        // Find the active timetable (first one that is draft or published)
        const active = timetablesData.find(t => t.status === 'draft' || t.status === 'published')
        if (active) {
          const tt = await api.getTimetable(active.id)
          setTimetable(tt)
        }
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [schoolId])

  const toggleAbsentTeacher = (teacherId) => {
    setAbsentTeacherIds(prev => 
      prev.includes(teacherId) 
        ? prev.filter(id => id !== teacherId)
        : [...prev, teacherId]
    )
    // Clear substitutions that are no longer needed
    setSubstitutions({})
  }

  const handleSubstituteChange = (entryId, teacherId) => {
    setSubstitutions(prev => ({
      ...prev,
      [entryId]: teacherId
    }))
  }

  // Derived state: empty slots
  const emptySlots = useMemo(() => {
    if (!timetable || absentTeacherIds.length === 0) return []
    
    // Find all entries for the selected day where the assigned teacher is absent
    const entries = timetable.entries.filter(e => {
      const period = periods.find(p => p.id === e.period_id)
      return period && period.day_of_week === selectedDay && absentTeacherIds.includes(e.teacher_id)
    })
    
    // Sort by period order
    return entries.sort((a, b) => {
      const pA = periods.find(p => p.id === a.period_id)
      const pB = periods.find(p => p.id === b.period_id)
      return (pA?.order ?? 0) - (pB?.order ?? 0)
    })
  }, [timetable, absentTeacherIds, selectedDay, periods])

  // Get available teachers for a specific period
  const getAvailableTeachers = (periodId) => {
    if (!timetable) return []
    
    // Teachers who are busy in this period
    const busyTeacherIds = new Set(
      timetable.entries
        .filter(e => e.period_id === periodId)
        .map(e => e.teacher_id)
    )
    
    // Available teachers = All - Busy - Absent
    return teachers.filter(t => 
      !busyTeacherIds.has(t.id) && !absentTeacherIds.includes(t.id)
    )
  }

  const saveSubstitutions = async () => {
    if (Object.keys(substitutions).length === 0) return
    
    const changes = Object.entries(substitutions).map(([entryId, subTeacherId]) => {
      const entry = emptySlots.find(e => e.id === parseInt(entryId))
      return {
        period_id: entry.period_id,
        absent_teacher_id: entry.teacher_id,
        substituting_teacher_id: parseInt(subTeacherId),
        class_group_id: entry.class_group_id,
        subject_id: entry.subject_id
      }
    })
    
    try {
      const newLog = await api.saveSubstitutionLog(schoolId, {
        day_of_week: selectedDay,
        changes
      })
      setLogs([newLog, ...logs])
      setAbsentTeacherIds([])
      setSubstitutions({})
      alert('Substitutions saved successfully!')
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <div className="p-8 text-gray-500">Loading data...</div>
  if (error) return <div className="p-8 text-red-600">{error}</div>
  if (!timetable) return <div className="p-8 text-gray-500">No active timetable found. Please generate a timetable first.</div>

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Substitutions</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setView('new')}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              view === 'new' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            New Substitutions
          </button>
          <button
            onClick={() => setView('history')}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              view === 'history' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            History
          </button>
        </div>
      </div>

      {view === 'new' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Left Column: Day & Absent Teachers */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">1. Select Day</h3>
              <select
                value={selectedDay}
                onChange={(e) => {
                  setSelectedDay(parseInt(e.target.value))
                  setAbsentTeacherIds([])
                  setSubstitutions({})
                }}
                className="w-full rounded border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              >
                {DAY_NAMES.map((name, idx) => (
                  <option key={idx} value={idx}>{name}</option>
                ))}
              </select>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">2. Absent Teachers</h3>
              {teachers.length === 0 ? (
                <p className="text-gray-500 text-sm">No teachers available.</p>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                  {teachers.map(t => (
                    <label key={t.id} className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={absentTeacherIds.includes(t.id)}
                        onChange={() => toggleAbsentTeacher(t.id)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                      />
                      <span className="text-gray-700">{t.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Empty Slots & Assignment */}
          <div className="md:col-span-2">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 h-full">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-800">3. Assign Substitutes</h3>
                {emptySlots.length > 0 && (
                  <button
                    onClick={saveSubstitutions}
                    className="bg-indigo-600 text-white px-4 py-2 rounded shadow-sm hover:bg-indigo-700 font-medium transition-colors"
                  >
                    Save & View Summary
                  </button>
                )}
              </div>

              {absentTeacherIds.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p>Select absent teachers to see empty slots.</p>
                </div>
              ) : emptySlots.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p>No classes scheduled for the selected absent teachers on {DAY_NAMES[selectedDay]}.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {emptySlots.map(entry => {
                    const period = periods.find(p => p.id === entry.period_id)
                    const classGroup = classGroups.find(c => c.id === entry.class_group_id)
                    const absentTeacher = teachers.find(t => t.id === entry.teacher_id)
                    const availableTeachers = getAvailableTeachers(entry.period_id)
                    
                    return (
                      <div key={entry.id} className="p-4 border border-gray-200 rounded-lg bg-gray-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <div className="font-semibold text-gray-900">{classGroup?.grade} {classGroup?.name}</div>
                          <div className="text-sm text-gray-600">
                            {period?.label || `Period ${period?.order}`} • Absent: {absentTeacher?.name}
                          </div>
                        </div>
                        <div className="min-w-[200px]">
                          <select
                            value={substitutions[entry.id] || ''}
                            onChange={(e) => handleSubstituteChange(entry.id, e.target.value)}
                            className="w-full rounded border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                          >
                            <option value="">-- Assign Substitute --</option>
                            {availableTeachers.map(t => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800 mb-6">Substitution History</h3>
          {logs.length === 0 ? (
            <p className="text-gray-500">No substitutions recorded yet.</p>
          ) : (
            <div className="space-y-8">
              {logs.map(log => (
                <div key={log.id} className="border-b border-gray-100 pb-8 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-medium text-gray-900">
                      {DAY_NAMES[log.day_of_week]} • {new Date(log.created_at).toLocaleString()}
                    </h4>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {log.changes.map((change, idx) => {
                      const period = periods.find(p => p.id === change.period_id)
                      const classGroup = classGroups.find(c => c.id === change.class_group_id)
                      const absent = teachers.find(t => t.id === change.absent_teacher_id)
                      const sub = teachers.find(t => t.id === change.substituting_teacher_id)
                      
                      return (
                        <div key={idx} className="bg-gray-50 p-3 rounded border border-gray-200 text-sm">
                          <div className="font-semibold text-indigo-700">{classGroup?.grade} {classGroup?.name}</div>
                          <div className="text-gray-600 mb-2">{period?.label || `Period ${period?.order}`}</div>
                          <div className="flex items-center gap-2">
                            <span className="text-red-600 line-through truncate" title={absent?.name}>{absent?.name}</span>
                            <span className="text-gray-400">→</span>
                            <span className="text-green-600 font-medium truncate" title={sub?.name}>{sub?.name}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
