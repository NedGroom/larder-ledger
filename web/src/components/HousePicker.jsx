import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

export default function HousePicker({ userRow, onJoined, onBack }) {
  const [publicHouses, setPublicHouses] = useState([])
  const [search, setSearch] = useState('')
  const [privateResult, setPrivateResult] = useState(null) // house found by name search
  const [privateSearched, setPrivateSearched] = useState(false)
  const [passwordInputs, setPasswordInputs] = useState({}) // houseId -> typed password
  const [passwordError, setPasswordError] = useState({})
  const [joining, setJoining] = useState(null)

  // Create new house state
  const [newName, setNewName] = useState('')
  const [newIsPublic, setNewIsPublic] = useState(true)
  const [newPassword, setNewPassword] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  useEffect(() => {
    supabase.from('houses').select('id, name, is_public').eq('is_public', true).order('name')
      .then(({ data }) => setPublicHouses(data || []))
  }, [])

  const filtered = publicHouses.filter(h =>
    h.name.toLowerCase().includes(search.toLowerCase())
  )

  async function findPrivateHouse() {
    setPrivateResult(null)
    setPrivateSearched(true)
    const { data } = await supabase.rpc('find_house_by_name', { p_name: search })
    const found = data?.[0] ?? null
    if (found && !found.is_public) setPrivateResult(found)
  }

  async function join(houseId, isPublic) {
    setJoining(houseId)
    setPasswordError(pe => ({ ...pe, [houseId]: '' }))
    const pwd = isPublic ? null : (passwordInputs[houseId] || '')
    const { data, error } = await supabase.rpc('join_house', { p_house_id: houseId, p_password: pwd })
    if (error || !data) {
      setPasswordError(pe => ({ ...pe, [houseId]: 'Wrong password or error joining.' }))
      setJoining(null)
      return
    }
    // Fetch the house row and return it
    const { data: house } = await supabase.from('houses').select('*').eq('id', houseId).single()
    onJoined(house)
  }

  async function createHouse(e) {
    e.preventDefault()
    setCreateError('')
    if (!newName.trim()) return
    setCreating(true)

    const { data: created, error } = await supabase
      .from('houses')
      .insert({ name: newName.trim(), is_public: newIsPublic, join_password: !newIsPublic ? newPassword : null })
      .select()
      .single()

    if (error || !created) { setCreateError(error?.message || 'Failed to create house.'); setCreating(false); return }

    await supabase.from('house_users').insert({ house_id: created.id, user_id: userRow.id, role: 'owner' })
    onJoined(created)
  }

  function HouseCard({ house }) {
    return (
      <div className="house-card">
        <span className="house-card-name">{house.name}</span>
        <span className="house-card-badge">{house.is_public ? '🔓 Public' : '🔒 Private'}</span>
        {house.is_public ? (
          <button className="btn" disabled={joining === house.id} onClick={() => join(house.id, true)}>
            {joining === house.id ? <span className="spinner" /> : 'Join'}
          </button>
        ) : (
          <div className="house-card-private">
            <input
              type="password"
              placeholder="Password"
              value={passwordInputs[house.id] || ''}
              onChange={e => setPasswordInputs(p => ({ ...p, [house.id]: e.target.value }))}
            />
            <button className="btn" disabled={joining === house.id} onClick={() => join(house.id, false)}>
              {joining === house.id ? <span className="spinner" /> : 'Join'}
            </button>
            {passwordError[house.id] && <p className="msg err">{passwordError[house.id]}</p>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="signin-wrap">
      <div className="house-picker-box">
        {onBack && (
          <button onClick={onBack} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer', fontSize: '.9rem', color: 'var(--color-text-muted)', padding: '0 0 .25rem', display: 'flex', alignItems: 'center', gap: '.3rem' }}>
            ‹ Back to Settings
          </button>
        )}
        {!onBack && <div className="logo">🥫</div>}
        {!onBack && <h1>LarderLedger</h1>}
        <p className="empty">Choose a house to join, or create your own.</p>

        <div className="house-search-row">
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPrivateResult(null); setPrivateSearched(false) }}
            placeholder="Search houses…"
          />
          <button className="btn" type="button" onClick={findPrivateHouse}>Find private house</button>
        </div>

        {/* Private house search result */}
        {privateResult && <HouseCard house={privateResult} />}
        {privateSearched && !privateResult && search && (
          <p className="msg err">No private house found with that name.</p>
        )}

        {/* Public houses list */}
        {filtered.length > 0 && (
          <div className="house-list">
            {filtered.map(h => <HouseCard key={h.id} house={h} />)}
          </div>
        )}
        {filtered.length === 0 && !search && <p className="empty">No public houses yet.</p>}

        <hr className="divider" />
        <h2>Create a new house</h2>
        <form onSubmit={createHouse} className="house-create-form">
          <label>
            House name
            <input value={newName} onChange={e => setNewName(e.target.value)} required />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={newIsPublic} onChange={e => setNewIsPublic(e.target.checked)} />
            Public (anyone can join without a password)
          </label>
          {!newIsPublic && (
            <label>
              Join password
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Password to join" required />
            </label>
          )}
          {createError && <p className="msg err">{createError}</p>}
          <button className="btn" type="submit" disabled={creating}>
            {creating ? <span className="spinner" /> : 'Create house'}
          </button>
        </form>
      </div>
    </div>
  )
}

