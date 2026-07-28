import { useEffect, useState } from 'react'
import { api, getToken, setToken } from './api'
import AuthPage from './components/AuthPage'
import Sidebar from './components/Sidebar'
import OverviewTab from './components/OverviewTab'
import DataEntryTab from './components/DataEntryTab'
import ConstraintsTab from './components/ConstraintsTab'
import TimetableTab from './components/TimetableTab'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'entry', label: 'Data Entry' },
  { id: 'constraints', label: 'Constraints' },
  { id: 'timetable', label: 'Timetable' },
]

/**
 * Top-level shell. Owns: the logged-in user, which school/section is
 * selected, and which tab is active. Everything else is fetched by the
 * individual tab components so this file doesn't become a god-component.
 */
function App() {
  const [user, setUser] = useState(null)
  const [checkingSession, setCheckingSession] = useState(true)

  const [schools, setSchools] = useState([])
  const [selectedSchoolId, setSelectedSchoolId] = useState(null)
  const [classGroups, setClassGroups] = useState([])
  const [selectedClassGroupId, setSelectedClassGroupId] = useState(null)
  const [teachers, setTeachers] = useState([])
  const [tab, setTab] = useState('overview')
  const [error, setError] = useState(null)

  // On load, if a token is already stored, validate it via /auth/me instead
  // of bouncing straight to the login screen.
  useEffect(() => {
    async function checkSession() {
      if (!getToken()) {
        setCheckingSession(false)
        return
      }
      try {
        setUser(await api.me())
      } catch {
        setToken(null)
      } finally {
        setCheckingSession(false)
      }
    }
    checkSession()
  }, [])

  useEffect(() => {
    if (!user) return
    loadSchools()
  }, [user])

  useEffect(() => {
    if (!selectedSchoolId) return
    loadSchoolData(selectedSchoolId)
  }, [selectedSchoolId])

  async function loadSchools() {
    try {
      const list = await api.listSchools()
      setSchools(list)
      if (list.length > 0) setSelectedSchoolId((prev) => prev ?? list[0].id)
    } catch (err) {
      setError(err.message)
    }
  }

  async function loadSchoolData(schoolId) {
    try {
      const [cg, t] = await Promise.all([
        api.listClassGroups(schoolId),
        api.listTeachers(schoolId),
      ])
      setClassGroups(cg)
      setTeachers(t)
      setSelectedClassGroupId((prev) =>
        cg.some((c) => c.id === prev) ? prev : cg[0]?.id ?? null
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleAddSchool() {
    const name = prompt("New school's name?")
    if (!name?.trim()) return
    try {
      const school = await api.createSchool({ name: name.trim() })
      await loadSchools()
      setSelectedSchoolId(school.id)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleAddClassGroup(grade, name) {
    try {
      await api.createClassGroup({ school_id: selectedSchoolId, grade, name })
      await loadSchoolData(selectedSchoolId)
    } catch (err) {
      setError(err.message)
    }
  }

  function handleLogout() {
    setToken(null)
    setUser(null)
    setSchools([])
    setSelectedSchoolId(null)
    setClassGroups([])
    setSelectedClassGroupId(null)
  }

  if (checkingSession) return null

  if (!user) {
    return <AuthPage onAuthenticated={setUser} />
  }

  const selectedSchool = schools.find((s) => s.id === selectedSchoolId)
  const selectedClassGroup = classGroups.find((c) => c.id === selectedClassGroupId)

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {schools.length > 0 ? (
        <Sidebar
          schoolName={selectedSchool?.name}
          schools={schools}
          selectedSchoolId={selectedSchoolId}
          onSelectSchool={setSelectedSchoolId}
          onAddSchool={handleAddSchool}
          classGroups={classGroups}
          selectedClassGroupId={selectedClassGroupId}
          onSelectClassGroup={setSelectedClassGroupId}
          onAddClassGroup={handleAddClassGroup}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-6 py-3">
          {selectedSchool && selectedClassGroup ? (
            <div className="mr-4 flex items-center gap-1.5 text-sm">
              <span className="text-slate-500">{selectedSchool.name}</span>
              <span className="text-slate-300">›</span>
              <span className="text-slate-500">{selectedClassGroup.grade || 'Ungrouped'}</span>
              <span className="text-slate-300">›</span>
              <span className="font-semibold">Section {selectedClassGroup.name}</span>
            </div>
          ) : (
            <span className="mr-4 text-sm text-slate-500">
              {schools.length === 0 ? 'Create a school to get started' : 'Add a grade/section to get started'}
            </span>
          )}

          {selectedClassGroup && (
            <nav className="ml-auto flex gap-1 text-sm">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`rounded-md px-3 py-1.5 font-medium ${
                    tab === t.id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          )}

          <button onClick={handleLogout} className="ml-2 text-xs text-slate-400 hover:text-slate-700">
            Sign out
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-10 py-8">
          {schools.length === 0 && (
            <button
              onClick={handleAddSchool}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Create your school
            </button>
          )}

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          {selectedSchool && selectedClassGroup && (
            <>
              {tab === 'overview' && (
                <OverviewTab
                  schoolId={selectedSchoolId}
                  classGroup={selectedClassGroup}
                  onNavigate={setTab}
                />
              )}
              {tab === 'entry' && (
                <DataEntryTab schoolId={selectedSchoolId} classGroupId={selectedClassGroupId} />
              )}
              {tab === 'constraints' && <ConstraintsTab schoolId={selectedSchoolId} />}
              {tab === 'timetable' && (
                <TimetableTab
                  schoolId={selectedSchoolId}
                  classGroup={selectedClassGroup}
                  classGroups={classGroups}
                  teachers={teachers}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
