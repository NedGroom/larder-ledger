import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { useApp } from '../App.jsx'
import HousePicker from '../components/HousePicker.jsx'
import { THEMES, applyTheme, applyDarkMode, isDarkMode, DEFAULT_THEME } from '../lib/themes.js'

export default function Settings() {
  const { house, setHouse, userRow, session, setTab } = useApp()
  const [myHouses, setMyHouses] = useState([])
  const [switchLoading, setSwitchLoading] = useState(null)
  const [showPicker, setShowPicker] = useState(false)
  const [currentTheme, setCurrentTheme] = useState(localStorage.getItem('theme') || DEFAULT_THEME)
  const [dark, setDark] = useState(isDarkMode())

  // Account editing
  const [editName, setEditName] = useState(false)
  const [editEmail, setEditEmail] = useState(false)
  const [nameVal, setNameVal] = useState(session?.user?.user_metadata?.full_name || '')
  const [emailVal, setEmailVal] = useState(session?.user?.email || '')
  const [savingName, setSavingName] = useState(false)
  const [savingEmail, setSavingEmail] = useState(false)
  const [nameMsg, setNameMsg] = useState('')
  const [emailMsg, setEmailMsg] = useState('')

  useEffect(() => {
    if (!userRow) return
    supabase
      .from('house_users')
      .select('house_id, role, houses(id, name, is_public)')
      .eq('user_id', userRow.id)
      .then(({ data }) => setMyHouses((data || []).map(r => ({ ...r.houses, role: r.role }))))
  }, [userRow])

  function selectTheme(id) { applyTheme(id); setCurrentTheme(id) }
  function toggleDark(val) { applyDarkMode(val); setDark(val) }

  async function switchHouse(h) {
    setSwitchLoading(h.id); setHouse(h); setSwitchLoading(null)
  }

  function handleJoined(newHouse) {
    setHouse(newHouse); setShowPicker(false)
    setMyHouses(prev => prev.find(h => h.id === newHouse.id) ? prev : [...prev, newHouse])
  }

  async function saveName() {
    setSavingName(true); setNameMsg('')
    const { error } = await supabase.auth.updateUser({ data: { full_name: nameVal } })
    if (!error) await supabase.from('users').update({ name: nameVal }).eq('id', userRow.id)
    setNameMsg(error ? error.message : 'Saved!')
    setSavingName(false)
    if (!error) setTimeout(() => { setNameMsg(''); setEditName(false) }, 1200)
  }

  async function saveEmail() {
    setSavingEmail(true); setEmailMsg('')
    const { error } = await supabase.auth.updateUser({ email: emailVal })
    setEmailMsg(error ? error.message : 'Confirmation sent to new email.')
    setSavingEmail(false)
    if (!error) setTimeout(() => { setEmailMsg(''); setEditEmail(false) }, 2000)
  }

  async function signOut() { await supabase.auth.signOut() }

  if (showPicker) {
    return <HousePicker userRow={userRow} onJoined={handleJoined} onBack={() => setShowPicker(false)} />
  }

  return (
    <div className="settings-page">
      <h1 className="settings-title">Settings</h1>

      {/* ── House ───────────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-label">House</div>
        <div className="settings-group">
          <div className="settings-row">
            <span className="settings-row-icon">🏠</span>
            <span className="settings-row-label">Current house</span>
            <span className="settings-row-value">{house?.name}</span>
          </div>
          {myHouses.filter(h => h.id !== house?.id).map(h => (
            <button key={h.id} className="settings-row settings-row-btn" onClick={() => switchHouse(h)} disabled={switchLoading === h.id}>
              <span className="settings-row-icon">{h.is_public ? '🔓' : '🔒'}</span>
              <span className="settings-row-label">Switch to {h.name}</span>
              <span className="settings-row-chevron">{switchLoading === h.id ? '…' : '›'}</span>
            </button>
          ))}
          <button className="settings-row settings-row-btn" onClick={() => setShowPicker(true)}>
            <span className="settings-row-icon">➕</span>
            <span className="settings-row-label">Join or create a house</span>
            <span className="settings-row-chevron">›</span>
          </button>
        </div>
      </div>

      {/* ── Appearance ──────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-label">Appearance</div>
        <div className="settings-group">
          <div className="settings-row settings-row-static settings-row-toggle">
            <span className="settings-row-icon">🌙</span>
            <span className="settings-row-label">Dark mode</span>
            <label className="dark-toggle">
              <input type="checkbox" checked={dark} onChange={e => toggleDark(e.target.checked)} />
              <span className="dark-toggle-slider" />
            </label>
          </div>
          <div className="settings-row settings-row-static">
            <span className="settings-row-icon">🎨</span>
            <span className="settings-row-label">Colour scheme
              <span className="settings-row-sub">{THEMES.find(t => t.id === currentTheme)?.label}</span>
            </span>
          </div>
          <div className="theme-picker">
            {THEMES.map(t => (
              <button key={t.id} className={`theme-swatch ${currentTheme === t.id ? 'active' : ''}`}
                style={{ background: t.swatch }} onClick={() => selectTheme(t.id)} title={t.label} aria-label={t.label}>
                {currentTheme === t.id && <span className="theme-check">✓</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Account ─────────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-label">Account</div>
        <div className="settings-group">

          {editName ? (
            <div className="settings-row settings-row-edit">
              <div className="settings-row-edit-header">
                <span className="settings-row-icon">👤</span>
                <span style={{ fontWeight: 500, fontSize: '.88rem' }}>Name</span>
              </div>
              <input type="text" value={nameVal} onChange={e => setNameVal(e.target.value)} autoFocus />
              {nameMsg && <p className={`msg ${nameMsg === 'Saved!' ? 'ok' : 'err'}`}>{nameMsg}</p>}
              <div className="settings-row-edit-actions">
                <button className="settings-edit-save" onClick={saveName} disabled={savingName}>{savingName ? '…' : 'Save'}</button>
                <button className="settings-edit-cancel" onClick={() => { setEditName(false); setNameMsg('') }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="settings-row settings-row-btn" onClick={() => setEditName(true)}>
              <span className="settings-row-icon">👤</span>
              <span className="settings-row-label">Name</span>
              <span className="settings-row-value">{session?.user?.user_metadata?.full_name || '—'}</span>
              <span className="settings-row-chevron">›</span>
            </button>
          )}

          {editEmail ? (
            <div className="settings-row settings-row-edit">
              <div className="settings-row-edit-header">
                <span className="settings-row-icon">✉️</span>
                <span style={{ fontWeight: 500, fontSize: '.88rem' }}>Email</span>
              </div>
              <input type="email" value={emailVal} onChange={e => setEmailVal(e.target.value)} autoFocus />
              {emailMsg && <p className={`msg ${emailMsg.startsWith('Confirmation') ? 'ok' : 'err'}`}>{emailMsg}</p>}
              <div className="settings-row-edit-actions">
                <button className="settings-edit-save" onClick={saveEmail} disabled={savingEmail}>{savingEmail ? '…' : 'Save'}</button>
                <button className="settings-edit-cancel" onClick={() => { setEditEmail(false); setEmailMsg('') }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="settings-row settings-row-btn" onClick={() => setEditEmail(true)}>
              <span className="settings-row-icon">✉️</span>
              <span className="settings-row-label">Email</span>
              <span className="settings-row-value">{session?.user?.email}</span>
              <span className="settings-row-chevron">›</span>
            </button>
          )}

          <button className="settings-row settings-row-btn settings-row-danger" onClick={signOut}>
            <span className="settings-row-icon">🚪</span>
            <span className="settings-row-label">Sign out</span>
          </button>
        </div>
      </div>

      {/* ── Coming soon ─────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-label">Coming soon</div>
        <div className="settings-group settings-group-muted">
          {[
            ['🔔', 'Notifications', 'Meal reminders & shopping nudges'],
            ['📊', 'Budget tracker', 'Monthly spend by category'],
            ['🗂️', 'Recipe import', 'Import from URL or PDF'],
            ['👨‍👩‍👧', 'Household members', "Manage who's in your house"],
            ['🔒', 'Change password', ''],
          ].map(([icon, label, sub]) => (
            <div key={label} className="settings-row settings-row-static settings-row-muted">
              <span className="settings-row-icon">{icon}</span>
              <span className="settings-row-label">{label}{sub && <span className="settings-row-sub">{sub}</span>}</span>
              <span className="settings-row-chevron muted">›</span>
            </div>
          ))}
        </div>
      </div>

      <p className="settings-version">LarderLedger · v0.1</p>
    </div>
  )
}
