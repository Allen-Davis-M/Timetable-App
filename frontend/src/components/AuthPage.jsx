import { useState } from 'react'
import { api, setToken } from '../api'

/**
 * Login / signup screen. Email+password is fully functional. Google
 * sign-in is shown (per the design) but marked "coming soon" — it needs a
 * Google Cloud OAuth client (client ID/secret) that only the project owner
 * can create; wiring it up later is an additive change, not a rework.
 */
export default function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const isLogin = mode === 'login'

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = isLogin
        ? await api.login({ email, password })
        : await api.signup({ email, password, name: name || null })
      setToken(result.access_token)
      onAuthenticated(result.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-8">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-lg font-semibold text-slate-900">Timetable</div>
          <h1 className="mt-2 text-2xl font-semibold">
            {isLogin ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {isLogin
              ? "Sign in to manage your school's timetables"
              : 'Set up your school in a couple of minutes'}
          </p>
        </div>

        <button
          type="button"
          disabled
          title="Google sign-in is coming soon"
          className="mb-4 flex w-full cursor-not-allowed items-center justify-center gap-2.5 rounded-md border border-slate-300 py-2.5 text-sm font-medium text-slate-400"
        >
          <svg width="17" height="17" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.1 0-11-4.9-11-11s4.9-11 11-11c2.8 0 5.3 1.1 7.3 2.8l5.7-5.7C33.6 6.5 29 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.4-3.5z" />
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.6 15.9 18.9 13 24 13c2.8 0 5.3 1.1 7.3 2.8l5.7-5.7C33.6 6.5 29 4.5 24 4.5c-7.6 0-14.1 4.3-17.5 10.6z" />
            <path fill="#4CAF50" d="M24 43.5c5 0 9.5-1.9 12.9-5l-6-5c-2 1.4-4.5 2.2-6.9 2.2-5.3 0-9.7-3.4-11.3-8l-6.6 5.1C9.8 39.1 16.3 43.5 24 43.5z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6 5C40.5 35.7 43.5 30.4 43.5 24c0-1.2-.1-2.3-.4-3.5z" />
          </svg>
          Continue with Google (coming soon)
        </button>

        <div className="mb-4 flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
          <div className="h-px flex-1 bg-slate-200" />
          or
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {!isLogin && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@school.edu"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 rounded-md bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {loading ? 'Please wait…' : isLogin ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm">
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => setMode(isLogin ? 'signup' : 'login')}
            className="text-slate-900 underline underline-offset-2"
          >
            {isLogin ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}
