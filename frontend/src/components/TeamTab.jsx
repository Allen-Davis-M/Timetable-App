import { useEffect, useState } from 'react'
import { api } from '../api'

/**
 * Admin-only tab: who has access to this school, and inviting more people.
 * See backend/app/core/access.py for the role model — "admin" (full
 * access) or "viewer" (read-only, every mutating endpoint blocks them
 * with a 403). The owner is always an implicit admin and can't be
 * removed or demoted (backend/app/routers/schools.py enforces this too;
 * the UI just doesn't offer the buttons for it).
 *
 * No email is actually sent when you invite someone — there's no email
 * service wired up yet (see ARCHITECTURE.md). Instead, inviting shows a
 * copyable link right away that you send yourself.
 */
export default function TeamTab({ schoolId }) {
  const [members, setMembers] = useState([])
  const [invites, setInvites] = useState([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [justCreatedLink, setJustCreatedLink] = useState(null)

  async function load() {
    try {
      const [m, i] = await Promise.all([api.listMembers(schoolId), api.listInvites(schoolId)])
      setMembers(m)
      setInvites(i)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
    setJustCreatedLink(null)
  }, [schoolId])

  async function handleInvite(e) {
    e.preventDefault()
    if (!email.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const invite = await api.createInvite(schoolId, email.trim(), role)
      setJustCreatedLink(`${window.location.origin}${window.location.pathname}?invite=${invite.token}`)
      setEmail('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRoleChange(userId, newRole) {
    setError(null)
    try {
      await api.updateMemberRole(schoolId, userId, newRole)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleRemove(userId) {
    setError(null)
    try {
      await api.removeMember(schoolId, userId)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleRevoke(inviteId) {
    setError(null)
    try {
      await api.revokeInvite(schoolId, inviteId)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h3 className="text-lg font-medium">Team</h3>
        <p className="mt-1 text-sm text-slate-500">
          Everyone with access to this school. Admins can do anything; viewers can look but not
          change anything.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-col gap-2">
        {members.map((m) => (
          <div key={m.user_id} className="flex items-center gap-3 rounded-md border border-slate-200 p-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{m.name || m.email}</div>
              <div className="text-xs text-slate-500">{m.email}</div>
            </div>
            {m.is_owner ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                Owner
              </span>
            ) : (
              <>
                <select
                  value={m.role}
                  onChange={(e) => handleRoleChange(m.user_id, e.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                >
                  <option value="admin">Admin</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  onClick={() => handleRemove(m.user_id)}
                  className="text-xs text-slate-400 hover:text-red-600"
                >
                  Remove
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {invites.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-slate-500">Pending invites</h4>
          <div className="flex flex-col gap-2">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 rounded-md border border-dashed border-slate-300 p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{inv.email}</div>
                  <div className="text-xs text-slate-400">Invited as {inv.role}</div>
                </div>
                <button
                  onClick={() =>
                    setJustCreatedLink(`${window.location.origin}${window.location.pathname}?invite=${inv.token}`)
                  }
                  className="text-xs text-slate-400 hover:text-slate-700"
                >
                  Copy link
                </button>
                <button onClick={() => handleRevoke(inv.id)} className="text-xs text-slate-400 hover:text-red-600">
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleInvite} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
        <h4 className="text-sm font-medium">Invite someone</h4>
        <div className="flex gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@school.edu"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-2 text-sm"
          >
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          <button
            disabled={submitting}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? 'Inviting…' : 'Invite'}
          </button>
        </div>
        {justCreatedLink && (
          <div className="rounded-md bg-slate-50 p-3 text-xs">
            <p className="mb-1 text-slate-500">
              Share this link with them — there's no email sent automatically yet:
            </p>
            <code className="break-all text-slate-700">{justCreatedLink}</code>
          </div>
        )}
      </form>
    </div>
  )
}
