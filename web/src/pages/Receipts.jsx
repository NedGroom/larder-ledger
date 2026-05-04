import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { useApp } from '../App.jsx'
import { PROVIDERS, extractPrices } from '../lib/ai.js'

const PROVIDER_KEYS = Object.keys(PROVIDERS)
const LS_PROVIDER = 'll_ai_provider'
const LS_KEY      = 'll_ai_key'

// ── Candidate confirmation table ──────────────────────────────────────────────
function CandidateTable({ candidates, ingredients, houseId, storeId, onSaved }) {
  // Each row: { description, price, unit, matched_ingredient_id, _saved }
  const [rows, setRows] = useState(candidates.map(c => ({
    ...c,
    matched_ingredient_id: '',
    _saved: false,
  })))
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)

  function update(idx, field, val) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r))
  }

  async function saveAll() {
    setSaving(true)
    let count = 0
    for (const row of rows) {
      if (row._saved || !row.matched_ingredient_id || !row.price) continue
      const { error } = await supabase.from('ingredient_prices').insert({
        ingredient_id: +row.matched_ingredient_id,
        store_id: storeId ? +storeId : null,
        price: +row.price,
        unit_size_unit: row.unit || null,
        currency: 'GBP',
        source: 'receipt-ai',
      })
      if (!error) {
        count++
        setRows(prev => prev.map(r => r === row ? { ...r, _saved: true } : r))
      }
    }
    setSavedCount(count)
    setSaving(false)
    if (count > 0) onSaved(count)
  }

  return (
    <div className="candidates">
      <div className="candidate-row header">
        <span>Description</span>
        <span>Price £</span>
        <span>Unit/pkg</span>
        <span>Link to ingredient</span>
        <span></span>
      </div>
      {rows.map((row, idx) => (
        <div key={idx} className={`candidate-row`} style={row._saved ? { opacity: .45 } : {}}>
          <input type="text" value={row.description} onChange={e => update(idx, 'description', e.target.value)} />
          <input type="number" step="0.01" value={row.price} onChange={e => update(idx, 'price', e.target.value)} />
          <input type="text" value={row.unit} onChange={e => update(idx, 'unit', e.target.value)} />
          <select value={row.matched_ingredient_id} onChange={e => update(idx, 'matched_ingredient_id', e.target.value)}>
            <option value="">— skip —</option>
            {ingredients.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          {row._saved ? <span className="pill green">✓</span> : <span />}
        </div>
      ))}
      <div className="btn-row">
        <button className="btn" onClick={saveAll} disabled={saving}>
          {saving ? <span className="spinner" /> : `Save linked prices`}
        </button>
        {savedCount > 0 && <span className="msg ok">{savedCount} price(s) saved</span>}
      </div>
    </div>
  )
}

// ── Main Receipts page ────────────────────────────────────────────────────────
export default function Receipts() {
  const { house } = useApp()

  // AI config (persisted to localStorage)
  const [provider, setProvider] = useState(() => localStorage.getItem(LS_PROVIDER) || PROVIDER_KEYS[0])
  const [apiKey, setApiKey]     = useState(() => localStorage.getItem(LS_KEY) || '')

  // Input mode
  const [inputMode, setInputMode] = useState('image') // 'image' | 'text'
  const [imageFile, setImageFile] = useState(null)
  const [plainText, setPlainText] = useState('')

  // Store selection for saving prices
  const [stores, setStores] = useState([])
  const [storeId, setStoreId] = useState('')
  const [storesLoaded, setStoresLoaded] = useState(false)

  // Ingredients (for candidate linking)
  const [ingredients, setIngredients] = useState([])

  // Extraction state
  const [extracting, setExtracting] = useState(false)
  const [candidates, setCandidates] = useState(null)
  const [extractErr, setExtractErr] = useState('')

  const fileRef = useRef()

  // Load stores + ingredients once
  async function ensureLoaded() {
    if (storesLoaded) return
    const [{ data: s }, { data: i }] = await Promise.all([
      supabase.from('stores').select('*').eq('house_id', house.id).order('name'),
      supabase.from('ingredients').select('id,name').eq('house_id', house.id).order('name'),
    ])
    setStores(s ?? [])
    setIngredients(i ?? [])
    if (s?.length) setStoreId(s[0].id)
    setStoresLoaded(true)
  }

  function saveConfig() {
    localStorage.setItem(LS_PROVIDER, provider)
    localStorage.setItem(LS_KEY, apiKey)
  }

  async function runExtraction() {
    setExtractErr('')
    setCandidates(null)
    if (!apiKey) { setExtractErr('Enter an AI API key above'); return }
    if (inputMode === 'image' && !imageFile) { setExtractErr('Select an image first'); return }
    if (inputMode === 'text' && !plainText.trim()) { setExtractErr('Paste some receipt text first'); return }
    await ensureLoaded()
    setExtracting(true)
    try {
      let content, contentType, imageMime
      if (inputMode === 'image') {
        imageMime = imageFile.type
        content = await toBase64(imageFile)
        contentType = 'image'
      } else {
        content = plainText
        contentType = 'text'
      }
      const result = await extractPrices({ provider, apiKey, content, contentType, imageMime })
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
        Upload a receipt photo or paste the text. An AI will extract product prices for you to confirm before saving.
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
          <label>
            API key
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-… or your key"
            />
          </label>
        </div>
        <button className="btn ghost small" onClick={saveConfig}>Save to browser</button>
        <p style={{ fontSize: '.75rem', color: '#aaa', marginTop: '.3rem' }}>
          Key is stored only in your browser's localStorage, never sent to our servers.
        </p>
      </div>

      <hr className="divider" />

      {/* ── Input mode ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem' }}>
        <button
          className={`btn small ${inputMode === 'image' ? '' : 'ghost'}`}
          onClick={() => { setInputMode('image'); setCandidates(null) }}
        >📷 Image</button>
        <button
          className={`btn small ${inputMode === 'text' ? '' : 'ghost'}`}
          onClick={() => { setInputMode('text'); setCandidates(null) }}
        >📋 Plain text</button>
      </div>

      {inputMode === 'image' && (
        <label>
          Receipt photo (JPEG / PNG / HEIC)
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ marginTop: 4 }}
            onChange={e => { setImageFile(e.target.files[0] ?? null); setCandidates(null) }}
          />
          {imageFile && (
            <img
              src={URL.createObjectURL(imageFile)}
              alt="preview"
              style={{ marginTop: '.5rem', maxWidth: '100%', maxHeight: 200, borderRadius: 6, objectFit: 'contain' }}
            />
          )}
        </label>
      )}

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

      {extractErr && <p className="msg err">{extractErr}</p>}

      <button className="btn" onClick={runExtraction} disabled={extracting} style={{ marginTop: '.5rem' }}>
        {extracting ? <><span className="spinner" /> Extracting…</> : '✨ Extract prices with AI'}
      </button>

      {/* ── Candidate confirmation ───────────────────────────────────── */}
      {candidates && (
        <>
          <hr className="divider" />
          <h2>Confirm extracted prices ({candidates.length} found)</h2>

          {stores.length > 0 && (
            <label style={{ marginBottom: '.5rem' }}>
              Save prices to store
              <select value={storeId} onChange={e => setStoreId(e.target.value)}>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}

          <p style={{ fontSize: '.8rem', color: '#888' }}>
            Match each line to an ingredient, then click Save. Leave "— skip —" for lines you don't want to save.
          </p>

          <CandidateTable
            candidates={candidates}
            ingredients={ingredients}
            houseId={house.id}
            storeId={storeId}
            onSaved={() => {}}
          />
        </>
      )}
    </>
  )
}

