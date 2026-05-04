import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { useApp } from '../App.jsx'

export default function Shopping() {
  const { house } = useApp()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [msg, setMsg] = useState({ text: '', ok: true })

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('shopping_list_items')
      .select('*, ingredients(name)')
      .eq('house_id', house.id)
      .order('completed', { ascending: true })
      .order('created_at', { ascending: true })
    setItems(data ?? [])
    setLoading(false)
  }, [house.id])

  useEffect(() => { load() }, [load])

  async function autoGenerate() {
    setGenerating(true)
    const { data, error } = await supabase.rpc('auto_generate_shopping_list', { p_house_id: house.id })
    if (error) { setMsg({ text: error.message, ok: false }) }
    else { setMsg({ text: `${data} item(s) added`, ok: true }); await load() }
    setGenerating(false)
  }

  async function toggleItem(item) {
    const { error } = await supabase
      .from('shopping_list_items')
      .update({ completed: !item.completed })
      .eq('id', item.id)
    if (!error) {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, completed: !item.completed } : i)
        .sort((a, b) => a.completed - b.completed || new Date(a.created_at) - new Date(b.created_at)))
    }
  }

  async function removeItem(id) {
    await supabase.from('shopping_list_items').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const pending   = items.filter(i => !i.completed)
  const completed = items.filter(i =>  i.completed)

  return (
    <>
      <div className="section-title">
        <h2>Shopping list</h2>
        <button className="btn small" onClick={autoGenerate} disabled={generating}>
          {generating ? <><span className="spinner" /> Generating…</> : '⚡ Auto-generate'}
        </button>
      </div>
      <p style={{ fontSize: '.8rem', color: '#888', marginBottom: '.3rem' }}>
        Auto-generate adds all pantry items marked as missing (has_any = off).
      </p>
      {msg.text && <p className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}

      <hr className="divider" />

      {loading && <p className="empty">Loading…</p>}
      {!loading && items.length === 0 && <p className="empty">List is empty — toggle items as missing in Pantry, then auto-generate.</p>}

      {pending.map(item => (
        <div key={item.id} className="card">
          <span className="name">{item.ingredients?.name ?? '—'}</span>
          <span className={`pill ${item.auto_generated ? 'blue' : 'green'}`}>
            {item.auto_generated ? 'auto' : 'manual'}
          </span>
          <button className="btn small" onClick={() => toggleItem(item)}>✓ Got it</button>
          <button className="btn small secondary" onClick={() => removeItem(item.id)}>✕</button>
        </div>
      ))}

      {completed.length > 0 && (
        <>
          <hr className="divider" />
          <h2 style={{ color: '#aaa' }}>Got ({completed.length})</h2>
          {completed.map(item => (
            <div key={item.id} className="card" style={{ opacity: .5 }}>
              <span className="name" style={{ textDecoration: 'line-through' }}>{item.ingredients?.name ?? '—'}</span>
              <button className="btn small secondary" onClick={() => toggleItem(item)}>Undo</button>
              <button className="btn small secondary" onClick={() => removeItem(item.id)}>✕</button>
            </div>
          ))}
        </>
      )}
    </>
  )
}

