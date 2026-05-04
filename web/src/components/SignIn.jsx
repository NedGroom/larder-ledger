import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function SignIn() {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [name, setName] = useState('')
  const [nameOrEmail, setNameOrEmail] = useState('') // sign-in field — accepts either
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function resolveEmail(input) {
    if (input.includes('@')) return input
    // looks like a name — resolve to email via RPC
    const { data, error: rpcErr } = await supabase.rpc('get_email_by_name', { p_name: input })
    if (rpcErr) throw new Error(rpcErr.message)
    if (!data) throw new Error('No account found with that name.')
    return data
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (mode === 'signup') {
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } },
        })
        if (err) throw err
      } else {
        const resolvedEmail = await resolveEmail(nameOrEmail.trim())
        const { error: err } = await supabase.auth.signInWithPassword({ email: resolvedEmail, password })
        if (err) throw err
      }
    } catch (err) {
      setError(err.message)
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
          {mode === 'signup' ? (
            <>
              <label>
                Name
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your unique display name" required autoFocus />
              </label>
              <label style={{ marginTop: '.5rem' }}>
                Email
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
              </label>
            </>
          ) : (
            <label>
              Name or email
              <input type="text" value={nameOrEmail} onChange={e => setNameOrEmail(e.target.value)} placeholder="Your name or email" required autoFocus />
            </label>
          )}
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
