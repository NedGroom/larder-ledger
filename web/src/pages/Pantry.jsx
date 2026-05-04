import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { useApp } from '../App.jsx'

export default function Pantry() {
  const { house } = useApp()
  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [hasAny, setHasAny] = useState(false)
  const [msg, setMsg] = useState({ text: '', ok: true })
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('ingredients')
      .select('*')
      .eq('house_id', house.id)
      .order('name')
    setIngredients(data ?? [])
    setLoading(false)
  }, [house.id])

  useEffect(() => { load() }, [load])

  async function addIngredient(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    const { error } = await supabase.from('ingredients').insert({
      house_id: house.id,
      name: name.trim(),
      name_normalized: name.trim().toLowerCase(),
      canonical_unit: unit.trim() || null,
      has_any: hasAny,
    })
    if (error) {
      setMsg({ text: error.message, ok: false })
    } else {
      setMsg({ text: `"${name.trim()}" added`, ok: true })
      setName(''); setUnit(''); setHasAny(false)
      await load()
    }
    setSaving(false)
  }

  async function toggleHasAny(ing) {
    const { error } = await supabase
      .from('ingredients')
      .update({ has_any: !ing.has_any })
      .eq('id', ing.id)
    if (!error) {
      setIngredients(prev => prev.map(i => i.id === ing.id ? { ...i, has_any: !ing.has_any } : i))
    }
  }

  const filtered = ingredients.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <>
      <div className="section-title">
        <h2>Add ingredient</h2>
      </div>
      <form onSubmit={addIngredient}>
        <div className="field-row">
          <label>
            Name
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Pasta" required />
          </label>
          <label style={{ maxWidth: 110 }}>
            Unit
            <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="g / ml / unit" />
          </label>
        </div>
        <div className="toggle-wrap" style={{ marginTop: '.5rem' }}>
          <label className="toggle">
            <input type="checkbox" checked={hasAny} onChange={e => setHasAny(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
          <span>In stock</span>
        </div>
        <button className="btn" type="submit" disabled={saving}>
          {saving ? <span className="spinner" /> : '+ Add'}
        </button>
        {msg.text && <p className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}
      </form>

      <hr className="divider" />

      <div className="section-title">
        <h2>Pantry ({ingredients.length})</h2>
      </div>
      <input
        type="search" placeholder="Search…" value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: '.5rem' }}
      />
      {loading && <p className="empty">Loading…</p>}
      {!loading && filtered.length === 0 && <p className="empty">No ingredients yet.</p>}
      {filtered.map(ing => (
        <div key={ing.id} className="card">
          <span className="name">{ing.name}</span>
          {ing.canonical_unit && <span className="meta">{ing.canonical_unit}</span>}
          <span className={`pill ${ing.has_any ? 'green' : 'red'}`}>
            {ing.has_any ? 'In stock' : 'Missing'}
          </span>
          <div className="toggle-wrap" style={{ margin: 0 }}>
            <label className="toggle">
              <input
                type="checkbox"
                checked={ing.has_any}
                onChange={() => toggleHasAny(ing)}
              />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>
      ))}
    </>
  )
}

