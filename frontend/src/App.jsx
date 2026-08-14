import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
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
import SetupProgressBar from './components/SetupProgressBar'
import { useSetupProgress } from './hooks/useSetupProgress'

// Substitutions used to be its own tab here, but it's really a sibling
// view of the generated schedule (same data — entries, periods, teachers
// — different lens), not a distinct workflow, so it now lives as a
// Schedule/Substitutions toggle inside TimetableTab.jsx instead of adding
// to this top-level count.
const BASE_TABS = [
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
  // Which of Data Entry's three sub-pages (subjects/teachers/plan) is
  // active — lifted up here rather than kept local to DataEntryTab so
  // the header progress bar and OverviewTab's step cards can jump
  // straight to e.g. "Teachers" instead of just landing on Data Entry
  // and making the admin find the right sub-page themselves.
  const [dataEntrySubView, setDataEntrySubView] = useState('subjects')
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

  async function handleUpdateClassGroup(classGroupId, data) {
    try {
      await api.updateClassGroup(classGroupId, data)
      setError(null)
      await loadSchoolData(selectedSchoolId)
    } catch (err) {
      setError(err.message)
    }
  }

  // Renames a grade heading for every section under it at once — "grade"
  // is just a shared string, not its own row, so fixing a shared typo
  // (or relabeling "Grade 8" to "Grade VIII") shouldn't require editing
  // each section individually. oldGrade is the sidebar's grouping key,
  // which is the literal string "Ungrouped" for sections with no grade.
  async function handleRenameGrade(oldGrade, newGrade) {
    try {
      const targets = classGroups.filter((cg) => (cg.grade || 'Ungrouped') === oldGrade)
      await Promise.all(
        targets.map((cg) => api.updateClassGroup(cg.id, { grade: newGrade.trim() || null }))
      )
      setError(null)
      await loadSchoolData(selectedSchoolId)
    } catch (err) {
      setError(err.message)
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

  const selectedSchool = schools.find((s) => s.id === selectedSchoolId)
  const selectedClassGroup = classGroups.find((c) => c.id === selectedClassGroupId)

  // Single source of truth for "how close is this section to a
  // generated timetable" — shared by the header's compact bar, the
  // Constraints/Timetable tabs' muted-until-ready styling below, and
  // OverviewTab's detailed step cards (see useSetupProgress.js). Called
  // unconditionally (rules-of-hooks) — before login or without a
  // selected section, schoolId/classGroupId are null and the hook just
  // never fires its fetch.
  const setupProgress = useSetupProgress({
    schoolId: selectedClassGroup ? selectedSchoolId : null,
    classGroupId: selectedClassGroupId,
    classGroupLabel: selectedClassGroup ? `Section ${selectedClassGroup.name}` : null,
    // Re-fetch whenever the admin switches top-level tabs or Data Entry
    // sub-pages — App.jsx itself never unmounts, so without this the
    // header bar would only ever reflect counts from the moment a
    // section was first selected, never noticing subjects/teachers/
    // periods added afterward.
    refreshKey: `${tab}:${dataEntrySubView}`,
  })

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

  const isViewer = selectedSchool?.role === 'viewer'
  const TABS = selectedSchool?.role === 'admin' ? [...BASE_TABS, { id: 'team', label: 'Team' }] : BASE_TABS

  // Jumps to a tab and, for Data Entry, straight to the right sub-page
  // (subjects/teachers/plan) instead of leaving the admin to find it —
  // used by both the header progress bar and OverviewTab's step cards.
  function handleNavigate(tabId, subView) {
    setTab(tabId)
    if (subView) setDataEntrySubView(subView)
  }

  // Data Entry has two distinct modes: school-wide (Subjects/Teachers,
  // reached via the sidebar's "Subjects & Teachers" item, no section
  // implied) and section-scoped (a section's plan, reached by clicking
  // that section in the sidebar). Whichever mode is active determines
  // whether the sidebar should show a section as selected — showing one
  // while browsing the whole school's teacher list is exactly the
  // "why does the sidebar say Section 8-B while I'm looking at every
  // teacher" confusion this avoids.
  const inSchoolWideDataEntry = tab === 'entry' && (dataEntrySubView === 'subjects' || dataEntrySubView === 'teachers')

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
          selectedClassGroupId={inSchoolWideDataEntry ? null : selectedClassGroupId}
          onSelectClassGroup={(id) => {
            setSelectedClassGroupId(id)
            setDataEntrySubView('plan')
          }}
          onAddClassGroup={handleAddClassGroup}
          onAddClassGroups={handleAddClassGroups}
          onDeleteClassGroup={handleDeleteClassGroup}
          onUpdateClassGroup={handleUpdateClassGroup}
          onRenameGrade={handleRenameGrade}
          onGoToSchoolSetup={() => {
            setTab('entry')
            setDataEntrySubView('subjects')
          }}
          schoolSetupActive={inSchoolWideDataEntry}
          readOnly={isViewer}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-6 py-3">
          {selectedSchool ? (
            <div className="mr-4 flex items-center gap-1.5 text-sm">
              <span className="font-semibold">{selectedSchool.name}</span>
              {isViewer && (
                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  View only
                </span>
              )}
            </div>
          ) : (
            <span className="mr-4 text-sm text-slate-500">Create a school to get started</span>
          )}

          {selectedSchool && (
            <div className="ml-auto flex items-center gap-3">
              <SetupProgressBar progress={setupProgress} onNavigate={handleNavigate} />
              <nav className="flex gap-1 text-sm">
                {TABS.map((t) => {
                  // Constraints/Timetable can't do anything useful until
                  // the basics exist (no subjects/teachers means an empty
                  // Constraints screen and a Timetable tab that can only
                  // fail) — muted rather than hidden or disabled, so
                  // someone who wants to peek still can.
                  const muted = ['constraints', 'timetable'].includes(t.id) && !setupProgress.allRequiredDone
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className={`relative rounded-md px-3 py-1.5 font-medium ${
                        tab === t.id ? 'text-white' : muted ? 'text-slate-300 hover:bg-slate-100 hover:text-slate-500' : 'text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      {tab === t.id && (
                        <motion.span
                          layoutId="tab-active-pill"
                          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                          className="absolute inset-0 rounded-md bg-indigo-600"
                        />
                      )}
                      <span className="relative z-10">{t.label}</span>
                    </button>
                  )
                })}
              </nav>
            </div>
          )}

          <button onClick={handleLogout} className="ml-2 text-xs text-slate-400 hover:text-slate-700">
            Sign out
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-10 py-8">
          {schools.length === 0 && (
            <button
              onClick={() => setAddSchoolOpen(true)}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Create your school
            </button>
          )}

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          {selectedSchool && (
            // No exit animation (and no AnimatePresence) here on purpose:
            // an in-flight async update on the outgoing tab (e.g. Data
            // Entry's periods/week field saving right as you switch tabs)
            // can re-render it mid-exit, which can prevent Framer
            // Motion's exit-complete callback from ever firing — leaving
            // a zero-opacity but still-laid-out copy of the old tab stuck
            // in the DOM forever, pushing the new content down. Plain
            // key-based remounting has no exit phase to get stuck in, so
            // this can't happen; the enter animation below still plays.
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
            >
                {/* Overview is the one tab that still needs a section to
                    do anything (it tracks one section's progress toward a
                    generated timetable), so a school with none yet sees
                    the "add your first section" flow here instead of it
                    blocking every other tab — Subjects/Teachers and even
                    Constraints are school-wide and don't need one. */}
                {tab === 'overview' && (
                  selectedClassGroup ? (
                    <OverviewTab
                      schoolId={selectedSchoolId}
                      classGroupId={selectedClassGroupId}
                      classGroup={selectedClassGroup}
                      onNavigate={handleNavigate}
                    />
                  ) : isViewer ? (
                    <p className="text-sm text-slate-500">
                      {selectedSchool.name} doesn't have any grades/sections set up yet. An admin
                      needs to add one before there's anything here to view.
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
                {tab === 'entry' && (
                  <DataEntryTab
                    schoolId={selectedSchoolId}
                    classGroupId={selectedClassGroupId}
                    institutionType={selectedSchool?.institution_type}
                    onClassGroupsChanged={() => loadSchoolData(selectedSchoolId)}
                    readOnly={isViewer}
                    subView={dataEntrySubView}
                    onSubViewChange={setDataEntrySubView}
                  />
                )}
                {tab === 'constraints' && <ConstraintsTab schoolId={selectedSchoolId} readOnly={isViewer} />}
                {tab === 'timetable' && (
                  selectedClassGroup ? (
                    <TimetableTab
                      schoolId={selectedSchoolId}
                      classGroup={selectedClassGroup}
                      classGroups={classGroups}
                      teachers={teachers}
                      readOnly={isViewer}
                    />
                  ) : (
                    <p className="text-sm text-slate-500">
                      No grades/sections yet — the timetable is generated per section, so add one
                      from the sidebar first.
                    </p>
                  )
                )}
                {tab === 'team' && selectedSchool?.role === 'admin' && (
                  <TeamTab schoolId={selectedSchoolId} />
                )}
            </motion.div>
          )}
        </div>
      </div>

      <AnimatePresence>
      {addSchoolOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
        >
          <motion.form
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
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
                      ? 'border-indigo-600 bg-indigo-600 text-white'
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
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
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
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {creatingSchool ? 'Creating…' : 'Create school'}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  )
}

export default App
