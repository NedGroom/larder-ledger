import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) setError(err.message)
    setLoading(false)
  }

  return (
    <div className="signin-wrap">
      <div className="signin-box">
        <div className="logo">🥫</div>
        <h1>LarderLedger</h1>
        <form onSubmit={handleSubmit}>
          <label>
            Email
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
          </label>
          <label style={{ marginTop: '.5rem' }}>
            Password
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="password" required />
          </label>
          {error && <p className="msg err">{error}</p>}
          <button className="btn" type="submit" disabled={loading}>
            {loading ? <span className="spinner" /> : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

