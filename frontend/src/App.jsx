import { useEffect, useState } from 'react'
import { api, getToken, setToken } from './api'
import LandingPage from './components/LandingPage'
import AuthPage from './components/AuthPage'
import AcceptInvitePage from './components/AcceptInvitePage'
import Sidebar from './components/Sidebar'
import FirstRunWelcome from './components/FirstRunWelcome'
import OverviewTab from './components/OverviewTab'
import DataEntryTab from './components/DataEntryTab'
import ConstraintsTab from './components/ConstraintsTab'
import TimetableTab from './components/TimetableTab'
import TeamTab from './components/TeamTab'
import SubstitutionsTab from './components/SubstitutionsTab'

const BASE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'entry', label: 'Data Entry' },
  { id: 'constraints', label: 'Constraints' },
  { id: 'timetable', label: 'Timetable' },
  { id: 'substitutions', label: 'Substitutions' },
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
  // Add-school is a small modal rather than window.prompt() — a native
  // browser dialog looked jarring next to an otherwise fully custom UI,
  // and couldn't show a "please wait" state or a proper error.
  const [addSchoolOpen, setAddSchoolOpen] = useState(false)
  const [newSchoolName, setNewSchoolName] = useState('')
  const [newInstitutionType, setNewInstitutionType] = useState('school') // 'school' | 'college'
  const [creatingSchool, setCreatingSchool] = useState(false)
  // Unauthenticated visitors see LandingPage.jsx first (marketing page,
  // "Get started"/"Sign in" CTAs), not straight-to-login — this flips to
  // true once one of those is clicked, revealing AuthPage. Reset to false
  // on logout so signing out lands back on the marketing page, not a bare
  // login form.
  const [showAuth, setShowAuth] = useState(false)

  // This app has no client-side router (see AcceptInvitePage.jsx's
  // docstring) — an invite link is just `?invite=<token>` on the same
  // URL, checked once on load. Kept in state (not re-read from the URL
  // on every render) so it doesn't reappear if the user navigates within
  // the app after accepting/dismissing it.
  const [inviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite'))
  const [inviteHandled, setInviteHandled] = useState(false)

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
      setError(null)
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
      setError(null)
      setSelectedClassGroupId((prev) =>
        cg.some((c) => c.id === prev) ? prev : cg[0]?.id ?? null
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function submitAddSchool(e) {
    e.preventDefault()
    if (!newSchoolName.trim() || creatingSchool) return
    setCreatingSchool(true)
    try {
      const school = await api.createSchool({
        name: newSchoolName.trim(),
        institution_type: newInstitutionType,
      })
      setError(null)
      await loadSchools()
      setSelectedSchoolId(school.id)
      setAddSchoolOpen(false)
      setNewSchoolName('')
      setNewInstitutionType('school')
    } catch (err) {
      setError(err.message)
    } finally {
      setCreatingSchool(false)
    }
  }

  async function handleAddClassGroup(grade, name) {
    try {
      await api.createClassGroup({ school_id: selectedSchoolId, grade, name })
      setError(null)
      await loadSchoolData(selectedSchoolId)
    } catch (err) {
      setError(err.message)
    }
  }

  // Bulk sibling of handleAddClassGroup — used by BulkAddClassGroups.jsx's
  // range form (e.g. "Grade 1-12" x "Sections A-C" = 36 in one go).
  // Fires every create in parallel and reloads once at the end, rather
  // than calling handleAddClassGroup in a loop (which would reload school
  // data after every single one — wasteful for dozens of creates, and the
  // repeated re-renders would fight with the form's own submitting state).
  async function handleAddClassGroups(pairs) {
    try {
      await Promise.all(
        pairs.map(({ grade, name }) => api.createClassGroup({ school_id: selectedSchoolId, grade, name }))
      )
      setError(null)
      await loadSchoolData(selectedSchoolId)
    } catch (err) {
      setError(err.message)
      // Some may have succeeded before one failed — refresh regardless so
      // the sidebar/list reflects whatever did get created rather than
      // looking stale until the next unrelated reload.
      await loadSchoolData(selectedSchoolId)
    }
  }

  async function handleDeleteClassGroup(classGroup) {
    const label = classGroup.grade ? `${classGroup.grade} - ${classGroup.name}` : classGroup.name
    if (
      !window.confirm(
        `Delete Section ${label}? This also removes its subject requirements and any generated timetable entries for this section. This can't be undone.`
      )
    ) {
      return
    }
    try {
      await api.deleteClassGroup(classGroup.id)
      setError(null)
      // If the deleted section was selected, loadSchoolData's own
      // fallback logic (`cg.some((c) => c.id === prev) ? prev : cg[0]?.id
      // ?? null`) picks another one automatically — nothing extra needed
      // here.
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
    setShowAuth(false)
  }

  function handleInviteAccepted(acceptedUser) {
    setInviteHandled(true)
    // Drop the ?invite=... param so refreshing/navigating later doesn't
    // re-show this screen — replaceState rather than a real navigation
    // since there's no router to do it "properly" with.
    window.history.replaceState(null, '', window.location.pathname)
    setUser(acceptedUser)
  }

  if (inviteToken && !inviteHandled) {
    return <AcceptInvitePage token={inviteToken} onAccepted={handleInviteAccepted} />
  }

  if (checkingSession) {
    // A blank screen while the session check runs read as a frozen/broken
    // app on a slow connection — a small centered spinner at least signals
    // something is happening.
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
      </div>
    )
  }

  if (!user) {
    return showAuth ? (
      <AuthPage onAuthenticated={setUser} onBack={() => setShowAuth(false)} />
    ) : (
      <LandingPage onGetStarted={() => setShowAuth(true)} />
    )
  }

  const selectedSchool = schools.find((s) => s.id === selectedSchoolId)
  const selectedClassGroup = classGroups.find((c) => c.id === selectedClassGroupId)
  const isViewer = selectedSchool?.role === 'viewer'
  const TABS = selectedSchool?.role === 'admin' ? [...BASE_TABS, { id: 'team', label: 'Team' }] : BASE_TABS

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {schools.length > 0 ? (
        <Sidebar
          schoolName={selectedSchool?.name}
          institutionType={selectedSchool?.institution_type}
          schools={schools}
          selectedSchoolId={selectedSchoolId}
          onSelectSchool={setSelectedSchoolId}
          onAddSchool={() => setAddSchoolOpen(true)}
          classGroups={classGroups}
          selectedClassGroupId={selectedClassGroupId}
          onSelectClassGroup={setSelectedClassGroupId}
          onAddClassGroup={handleAddClassGroup}
          onAddClassGroups={handleAddClassGroups}
          onDeleteClassGroup={handleDeleteClassGroup}
          readOnly={isViewer}
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
              {isViewer && (
                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  View only
                </span>
              )}
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
              onClick={() => setAddSchoolOpen(true)}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Create your school
            </button>
          )}

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          {selectedSchool && !selectedClassGroup && (
            isViewer ? (
              <p className="text-sm text-slate-500">
                {selectedSchool.name} doesn't have any grades/sections set up yet. An admin needs
                to add one before there's anything here to view.
              </p>
            ) : (
              <FirstRunWelcome
                schoolName={selectedSchool.name}
                institutionType={selectedSchool.institution_type}
                onAddClassGroup={handleAddClassGroup}
                onAddClassGroups={handleAddClassGroups}
              />
            )
          )}

          {selectedSchool && selectedClassGroup && (
            <>
              {tab === 'overview' && (
                <OverviewTab
                  schoolId={selectedSchoolId}
                  classGroupId={selectedClassGroupId}
                  classGroup={selectedClassGroup}
                  onNavigate={setTab}
                />
              )}
              {tab === 'entry' && (
                <DataEntryTab
                  schoolId={selectedSchoolId}
                  classGroupId={selectedClassGroupId}
                  institutionType={selectedSchool?.institution_type}
                  onClassGroupsChanged={() => loadSchoolData(selectedSchoolId)}
                  readOnly={isViewer}
                />
              )}
              {tab === 'constraints' && <ConstraintsTab schoolId={selectedSchoolId} readOnly={isViewer} />}
              {tab === 'timetable' && (
                <TimetableTab
                  schoolId={selectedSchoolId}
                  classGroup={selectedClassGroup}
                  classGroups={classGroups}
                  teachers={teachers}
                  readOnly={isViewer}
                />
              )}
              {tab === 'substitutions' && (
                <SubstitutionsTab
                  schoolId={selectedSchoolId}
                  classGroups={classGroups}
                  teachers={teachers}
                />
              )}
              {tab === 'team' && selectedSchool?.role === 'admin' && (
                <TeamTab schoolId={selectedSchoolId} />
              )}
            </>
          )}
        </div>
      </div>

      {addSchoolOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={submitAddSchool}
            className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-lg"
          >
            <h2 className="text-lg font-semibold">New school</h2>

            <span className="mb-1 mt-4 block text-xs font-medium text-slate-500">Type</span>
            <div className="flex gap-2">
              {[
                { value: 'school', label: 'School' },
                { value: 'college', label: 'College' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setNewInstitutionType(opt.value)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                    newInstitutionType === opt.value
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              Just sets sensible defaults (terminology, which optional fields show up) — you can
              still use anything either way.
            </p>

            <label className="mb-1 mt-4 block text-xs font-medium text-slate-500" htmlFor="new-school-name">
              {newInstitutionType === 'college' ? 'College name' : 'School name'}
            </label>
            <input
              id="new-school-name"
              autoFocus
              value={newSchoolName}
              onChange={(e) => setNewSchoolName(e.target.value)}
              placeholder={newInstitutionType === 'college' ? 'e.g. Riverside College of Engineering' : 'e.g. Riverside Public School'}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setAddSchoolOpen(false)
                  setNewSchoolName('')
                  setNewInstitutionType('school')
                }}
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newSchoolName.trim() || creatingSchool}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {creatingSchool ? 'Creating…' : 'Create school'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

export default App
