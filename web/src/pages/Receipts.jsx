import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { useApp } from '../App.jsx'
import { PROVIDERS, extractPrices } from '../lib/ai.js'

const PROVIDER_KEYS = Object.keys(PROVIDERS)
const LS_PROVIDER = 'll_ai_provider'
const LS_KEY      = 'll_ai_key'

// ── Single candidate card ─────────────────────────────────────────────────────
function CandidateCard({ row, ingredients, houseMembers, onChange, onIgnore }) {
  // mode: 'existing' | 'new'
  const [mode, setMode] = useState('existing')

  if (row._ignored) {
    return (
      <div className="candidate-card candidate-card--ignored">
        <span className="candidate-ignored-label">⊘ Ignored — {row.description || '(no description)'}</span>
        <button className="btn ghost small" onClick={onIgnore}>Undo</button>
      </div>
    )
  }

  return (
    <div className={`candidate-card ${row._saved ? 'candidate-card--saved' : ''}`}>
      {/* ── Ingredient assignment ── */}
      <div className="candidate-assign-row">
        <div className="candidate-assign-tabs">
          <button
            className={`assign-tab ${mode === 'existing' ? 'active' : ''}`}
            onClick={() => { setMode('existing'); onChange('matched_ingredient_id', ''); onChange('new_ingredient_name', '') }}
          >Existing</button>
          <button
            className={`assign-tab ${mode === 'new' ? 'active' : ''}`}
            onClick={() => { setMode('new'); onChange('matched_ingredient_id', '') }}
          >+ New</button>
        </div>

        {mode === 'existing' ? (
          <select
            className="candidate-ingredient-select"
            value={row.matched_ingredient_id}
            onChange={e => onChange('matched_ingredient_id', e.target.value)}
          >
            <option value="">— link to ingredient —</option>
            {ingredients.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        ) : (
          <input
            type="text"
            className="candidate-ingredient-select"
            placeholder="New ingredient name"
            value={row.new_ingredient_name || ''}
            onChange={e => onChange('new_ingredient_name', e.target.value)}
          />
        )}

        <button className="btn ghost small candidate-ignore-btn" onClick={onIgnore} title="Ignore this item">⊘</button>
      </div>

      {/* ── Price sub-fields ── */}
      <div className="candidate-fields">
        <label className="candidate-field">
          <span>Description</span>
          <input type="text" value={row.description} onChange={e => onChange('description', e.target.value)} />
        </label>
        <label className="candidate-field candidate-field--small">
          <span>Price £</span>
          <input type="number" step="0.01" min="0" value={row.price} onChange={e => onChange('price', e.target.value)} />
        </label>
        <label className="candidate-field candidate-field--small">
          <span>Unit / pkg</span>
          <input type="text" value={row.unit} onChange={e => onChange('unit', e.target.value)} placeholder="e.g. 500g" />
        </label>
        <label className="candidate-field candidate-field--small">
          <span>Paid by</span>
          <select value={row.paid_by_user_id || ''} onChange={e => onChange('paid_by_user_id', e.target.value)}>
            <option value="">— shared —</option>
            {houseMembers.map(m => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
          </select>
        </label>
      </div>

      {row._saved && <div className="candidate-saved-badge">✓ Saved</div>}
    </div>
  )
}

// ── Candidate list + save ─────────────────────────────────────────────────────
function CandidateTable({ candidates, ingredients, houseMembers, houseId, storeId, onSaved }) {
  const [rows, setRows] = useState(candidates.map(c => ({
    ...c,
    matched_ingredient_id: '',
    new_ingredient_name: '',
    paid_by_user_id: '',
    _ignored: false,
    _saved: false,
  })))
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [saveErr, setSaveErr] = useState('')

  function update(idx, field, val) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r))
  }

  function toggleIgnore(idx) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, _ignored: !r._ignored } : r))
  }

  async function saveAll() {
    setSaving(true); setSaveErr(''); let count = 0; let skipped = 0
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx]
      if (row._ignored || row._saved) continue

      let ingredientId = row.matched_ingredient_id ? +row.matched_ingredient_id : null

      // Create new ingredient if needed
      if (!ingredientId && row.new_ingredient_name?.trim()) {
        const name = row.new_ingredient_name.trim()
        const { data: newIng, error: ingErr } = await supabase
          .from('ingredients')
          .insert({ house_id: houseId, name, name_normalized: name.toLowerCase(), has_any: false })
          .select('id')
          .single()
        if (ingErr) { setSaveErr(`Failed to create "${name}": ${ingErr.message}`); continue }
        ingredientId = newIng.id
      }

      if (!ingredientId || !row.price) { skipped++; continue }

      const { error } = await supabase.from('ingredient_prices').insert({
        ingredient_id: ingredientId,
        store_id: storeId ? +storeId : null,
        price: +row.price,
        unit_size_unit: row.unit || null,
        currency: 'GBP',
        source: 'receipt-ai',
      })
      if (!error) {
        count++
        setRows(prev => prev.map((r, i) => i === idx ? { ...r, _saved: true } : r))
      }
    }
    setSavedCount(count)
    if (skipped > 0) setSaveErr(`${skipped} item${skipped !== 1 ? 's' : ''} skipped — no ingredient linked or no price.`)
    setSaving(false)
    if (count > 0) onSaved(count)
  }

  const activeCount = rows.filter(r => !r._ignored && !r._saved).length
  const ignoredCount = rows.filter(r => r._ignored).length

  return (
    <div className="candidates">
      <div className="candidates-summary">
        {activeCount} to save{ignoredCount > 0 ? `, ${ignoredCount} ignored` : ''}
      </div>
      {rows.map((row, idx) => (
        <CandidateCard
          key={idx}
          row={row}
          ingredients={ingredients}
          houseMembers={houseMembers}
          onChange={(field, val) => update(idx, field, val)}
          onIgnore={() => toggleIgnore(idx)}
        />
      ))}
      {saveErr && <p className="msg err">{saveErr}</p>}
      <div className="btn-row" style={{ marginTop: '.75rem' }}>
        <button className="btn" onClick={saveAll} disabled={saving || activeCount === 0}>
          {saving ? <span className="spinner" /> : `Save ${activeCount} price${activeCount !== 1 ? 's' : ''}`}
        </button>
        {savedCount > 0 && <span className="msg ok">{savedCount} saved ✓</span>}
      </div>
    </div>
  )
}

// ── Main Receipts page ────────────────────────────────────────────────────────
export default function Receipts() {
  const { house, session } = useApp()

  const [provider, setProvider] = useState(() => localStorage.getItem(LS_PROVIDER) || PROVIDER_KEYS[0])
  const [apiKey, setApiKey]     = useState(() => localStorage.getItem(LS_KEY) || '')

  const [inputMode, setInputMode] = useState('text') // default text since Copilot is default provider
  const [imageFile, setImageFile] = useState(null)
  const [plainText, setPlainText] = useState('')

  const [stores, setStores]         = useState([])
  const [storeId, setStoreId]       = useState('')
  const [ingredients, setIngredients] = useState([])
  const [houseMembers, setHouseMembers] = useState([])
  const [storesLoaded, setStoresLoaded] = useState(false)

  const [extracting, setExtracting] = useState(false)
  const [candidates, setCandidates] = useState(null)
  const [extractErr, setExtractErr] = useState('')

  const fileRef = useRef()
  const currentProvider = PROVIDERS[provider]

  // If user switches to a provider that doesn't support images, reset to text
  useEffect(() => {
    if (!currentProvider?.supportsImage && inputMode === 'image') setInputMode('text')
  }, [provider])

  async function ensureLoaded() {
    if (storesLoaded) return
    const [{ data: s }, { data: i }, { data: hu }] = await Promise.all([
      supabase.from('stores').select('*').eq('house_id', house.id).order('name'),
      supabase.from('ingredients').select('id,name').eq('house_id', house.id).order('name'),
      supabase.from('house_users').select('users(id,name,email)').eq('house_id', house.id),
    ])
    setStores(s ?? [])
    setIngredients(i ?? [])
    setHouseMembers((hu ?? []).map(r => r.users).filter(Boolean))
    if (s?.length) setStoreId(s[0].id)
    setStoresLoaded(true)
  }

  function saveConfig() {
    localStorage.setItem(LS_PROVIDER, provider)
    localStorage.setItem(LS_KEY, apiKey)
  }

  async function runExtraction() {
    setExtractErr(''); setCandidates(null)
    if (currentProvider?.requiresApiKey && !apiKey) { setExtractErr('Enter an API key above'); return }
    if (inputMode === 'image' && !imageFile) { setExtractErr('Select an image first'); return }
    if (inputMode === 'text' && !plainText.trim()) { setExtractErr('Paste some receipt text first'); return }
    await ensureLoaded()
    setExtracting(true)
    try {
      let content, contentType, imageMime
      if (inputMode === 'image') {
        imageMime = imageFile.type; content = await toBase64(imageFile); contentType = 'image'
      } else {
        content = plainText; contentType = 'text'
      }
      const result = await extractPrices({
        provider, apiKey,
        sessionToken: session?.access_token,
        content, contentType, imageMime,
      })
      setCandidates(result)
    } catch (e) {
      setExtractErr(e.message)
    }
    setExtracting(false)
  }

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  return (
    <>
      <h2>Receipt → prices</h2>
      <p style={{ fontSize: '.82rem', color: '#888', marginBottom: '.75rem' }}>
        Paste receipt text or upload a photo. AI extracts the prices for you to review before saving.
      </p>

      {/* ── AI provider config ───────────────────────────────────────── */}
      <div className="card-body">
        <h3 style={{ marginTop: 0 }}>AI provider</h3>
        <div className="field-row">
          <label>
            Provider
            <select value={provider} onChange={e => { setProvider(e.target.value); setCandidates(null) }}>
              {PROVIDER_KEYS.map(k => <option key={k} value={k}>{PROVIDERS[k].name}</option>)}
            </select>
          </label>
          {currentProvider?.requiresApiKey && (
            <label>
              API key
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-… or your key"
              />
            </label>
          )}
        </div>
        {currentProvider?.requiresApiKey && (
          <>
            <button className="btn ghost small" onClick={saveConfig}>Save to browser</button>
            <p style={{ fontSize: '.75rem', color: '#aaa', marginTop: '.3rem' }}>
              Key stored only in your browser's localStorage, never sent to our servers.
            </p>
          </>
        )}
        {!currentProvider?.requiresApiKey && (
          <p style={{ fontSize: '.8rem', color: '#aaa', marginTop: '.3rem' }}>
            ✓ No API key needed — uses a shared secure token.
          </p>
        )}
      </div>

      <hr className="divider" />

      {/* ── Input mode ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem' }}>
        <button
          className={`btn small ${inputMode === 'text' ? '' : 'ghost'}`}
          onClick={() => { setInputMode('text'); setCandidates(null) }}
        >📋 Paste text</button>
        {currentProvider?.supportsImage && (
          <button
            className={`btn small ${inputMode === 'image' ? '' : 'ghost'}`}
            onClick={() => { setInputMode('image'); setCandidates(null) }}
          >📷 Image</button>
        )}
      </div>

      {inputMode === 'text' && (
        <label>
          Paste receipt text
          <textarea
            value={plainText}
            onChange={e => { setPlainText(e.target.value); setCandidates(null) }}
            placeholder={"Milk 2L          £1.25\nFree range eggs  £2.49\n..."}
            rows={8}
          />
        </label>
      )}

      {inputMode === 'image' && (
        <label>
          Receipt photo (JPEG / PNG / HEIC)
          <input
            ref={fileRef} type="file" accept="image/*"
            style={{ marginTop: 4 }}
            onChange={e => { setImageFile(e.target.files[0] ?? null); setCandidates(null) }}
          />
          {imageFile && (
            <img
              src={URL.createObjectURL(imageFile)} alt="preview"
              style={{ marginTop: '.5rem', maxWidth: '100%', maxHeight: 200, borderRadius: 6, objectFit: 'contain' }}
            />
          )}
        </label>
      )}

      {extractErr && <p className="msg err">{extractErr}</p>}

      <button className="btn" onClick={runExtraction} disabled={extracting} style={{ marginTop: '.5rem' }}>
        {extracting ? <><span className="spinner" /> Extracting…</> : '✨ Extract prices with AI'}
      </button>

      {/* ── Candidate confirmation ───────────────────────────────────── */}
      {candidates && (
        <>
          <hr className="divider" />
          <h2>Review extracted items ({candidates.length} found)</h2>

          {stores.length > 0 && (
            <label style={{ marginBottom: '.75rem', display: 'block' }}>
              Store these prices under
              <select value={storeId} onChange={e => setStoreId(e.target.value)}>
                <option value="">— no store —</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}

          <p style={{ fontSize: '.8rem', color: '#888', marginBottom: '.5rem' }}>
            Link each item to an existing ingredient or create a new one. Hit ⊘ to ignore lines you don't need.
          </p>

          <CandidateTable
            candidates={candidates}
            ingredients={ingredients}
            houseMembers={houseMembers}
            houseId={house.id}
            storeId={storeId}
            onSaved={() => {}}
          />
        </>
      )}
    </>
  )
}

