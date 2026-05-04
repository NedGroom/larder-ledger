import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function SignIn() {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (mode === 'signup') {
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      })
      if (err) setError(err.message)
      // no email confirmation needed — session is set automatically
    } else {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) setError(err.message)
    }

    setLoading(false)
  }

  function toggleMode() {
    setMode(m => m === 'signin' ? 'signup' : 'signin')
    setError('')
  }

  return (
    <div className="signin-wrap">
      <div className="signin-box">
        <div className="logo">🥫</div>
        <h1>LarderLedger</h1>
        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <label>
              Name
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" required autoFocus />
            </label>
          )}
          <label style={mode === 'signup' ? { marginTop: '.5rem' } : {}}>
            Email
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus={mode === 'signin'} />
          </label>
          <label style={{ marginTop: '.5rem' }}>
            Password
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="password" required />
          </label>
          {error && <p className="msg err">{error}</p>}
          <button className="btn" type="submit" disabled={loading}>
            {loading ? <span className="spinner" /> : mode === 'signin' ? 'Sign in' : 'Sign up'}
          </button>
        </form>
        <p style={{ marginTop: '1rem', textAlign: 'center', fontSize: '.875rem' }}>
          {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button type="button" onClick={toggleMode} style={{ background: 'none', border: 'none', color: 'var(--accent, #4f8)', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}>
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}
