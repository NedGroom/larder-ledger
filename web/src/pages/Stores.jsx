import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { useApp } from '../App.jsx'

export default function Stores() {
  const { house } = useApp()
  const [stores, setStores] = useState([])
  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)

  // New store form
  const [storeName, setStoreName] = useState('')
  const [storeMsg, setStoreMsg] = useState({ text: '', ok: true })
  const [storeSaving, setStoreSaving] = useState(false)

  // New price form
  const [priceIngId, setPriceIngId] = useState('')
  const [priceStoreId, setPriceStoreId] = useState('')
  const [priceVal, setPriceVal] = useState('')
  const [pkgSize, setPkgSize] = useState('')
  const [pkgSizeUnit, setPkgSizeUnit] = useState('')
  const [priceMsg, setPriceMsg] = useState({ text: '', ok: true })
  const [priceSaving, setPriceSaving] = useState(false)

  // Price list for selected store
  const [viewStoreId, setViewStoreId] = useState('')
  const [prices, setPrices] = useState([])
  const [pricesLoading, setPricesLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: s }, { data: i }] = await Promise.all([
      supabase.from('stores').select('*').eq('house_id', house.id).order('name'),
      supabase.from('ingredients').select('id,name,canonical_unit,canonical_quantity').eq('house_id', house.id).order('name'),
    ])
    setStores(s ?? [])
    setIngredients(i ?? [])
    if (s?.length) {
      setPriceStoreId(s[0].id)
      setViewStoreId(s[0].id)
    }
    if (i?.length) setPriceIngId(i[0].id)
    setLoading(false)
  }, [house.id])

  useEffect(() => { load() }, [load])

  async function loadPrices(storeId) {
    setPricesLoading(true)
    const { data } = await supabase
      .from('ingredient_prices')
      .select('*, ingredients(name)')
      .eq('store_id', storeId)
      .order('noted_at', { ascending: false })
    setPrices(data ?? [])
    setPricesLoading(false)
  }

  useEffect(() => { if (viewStoreId) loadPrices(viewStoreId) }, [viewStoreId])

  async function addStore(e) {
    e.preventDefault()
    if (!storeName.trim()) return
    setStoreSaving(true)
    const { data, error } = await supabase.from('stores')
      .insert({ house_id: house.id, name: storeName.trim() }).select().single()
    if (error) { setStoreMsg({ text: error.message, ok: false }) }
    else {
      setStoreMsg({ text: `"${data.name}" added`, ok: true })
      setStoreName('')
      await load()
    }
    setStoreSaving(false)
  }

  async function addPrice(e) {
    e.preventDefault()
    if (!priceVal || !priceIngId || !priceStoreId) return
    const price = +priceVal
    const size = pkgSize ? +pkgSize : null
    const ing = ingMap[+priceIngId]
    // compute price_per_canonical if we have enough info
    const ppCanonical = (size && price && ing?.canonical_quantity)
      ? +((price / size) * ing.canonical_quantity).toFixed(6)
      : null
    setPriceSaving(true)
    const { error } = await supabase.from('ingredient_prices').insert({
      ingredient_id: +priceIngId,
      store_id: +priceStoreId,
      price,
      unit_size: size,
      unit_size_unit: pkgSizeUnit.trim() || null,
      price_per_canonical: ppCanonical,
      currency: 'GBP',
    })
    if (error) { setPriceMsg({ text: error.message, ok: false }) }
    else {
      setPriceMsg({ text: 'Price recorded', ok: true })
      setPriceVal(''); setPkgSize(''); setPkgSizeUnit('')
      if (+priceStoreId === +viewStoreId) loadPrices(viewStoreId)
    }
    setPriceSaving(false)
  }

  const ingMap = Object.fromEntries(ingredients.map(i => [i.id, i]))

  return (
    <>
      <h2>Add store</h2>
      <form onSubmit={addStore}>
        <label>
          Store name
          <input value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="e.g. Tesco, Lidl" required />
        </label>
        <button className="btn" type="submit" disabled={storeSaving}>
          {storeSaving ? <span className="spinner" /> : '+ Add store'}
        </button>
        {storeMsg.text && <p className={`msg ${storeMsg.ok ? 'ok' : 'err'}`}>{storeMsg.text}</p>}
      </form>

      {stores.length > 0 && (
        <div style={{ marginTop: '.5rem', display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          {stores.map(s => <span key={s.id} className="pill blue">{s.name}</span>)}
        </div>
      )}

      <hr className="divider" />

      <h2>Record price</h2>
      {loading ? <p className="empty">Loading…</p> : stores.length === 0 ? (
        <p className="empty">Add a store first.</p>
      ) : (
        <form onSubmit={addPrice}>
          <div className="field-row">
            <label>
              Ingredient
              <select value={priceIngId} onChange={e => setPriceIngId(e.target.value)}>
                {ingredients.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
            <label>
              Store
              <select value={priceStoreId} onChange={e => setPriceStoreId(e.target.value)}>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
          <div className="field-row">
            <label>
              Price (£)
              <input type="number" step="0.01" min="0" value={priceVal} onChange={e => setPriceVal(e.target.value)} placeholder="1.50" required />
            </label>
          </div>
          <div className="field-row">
            <label>
              Package size
              <input type="number" min="0" step="any" value={pkgSize} onChange={e => setPkgSize(e.target.value)} placeholder="500" />
            </label>
            <label style={{ maxWidth: 90 }}>
              Size unit
              <input value={pkgSizeUnit} onChange={e => setPkgSizeUnit(e.target.value)} placeholder="g / ml" />
            </label>
          </div>
          {(() => {
            const ing = ingMap[+priceIngId]
            if (pkgSize && priceVal && ing?.canonical_quantity && ing?.canonical_unit) {
              const ppC = ((+priceVal / +pkgSize) * ing.canonical_quantity).toFixed(4)
              return <p className="msg ok">→ £{ppC} per {ing.canonical_quantity}{ing.canonical_unit}</p>
            }
            if (pkgSize && priceVal) {
              return <p className="msg ok">→ £{(+priceVal / +pkgSize).toFixed(4)} per {pkgSizeUnit || 'unit'}</p>
            }
            return null
          })()}
          <button className="btn" type="submit" disabled={priceSaving}>
            {priceSaving ? <span className="spinner" /> : 'Save price'}
          </button>
          {priceMsg.text && <p className={`msg ${priceMsg.ok ? 'ok' : 'err'}`}>{priceMsg.text}</p>}
        </form>
      )}

      <hr className="divider" />

      <h2>Prices by store</h2>
      {stores.length > 0 && (
        <>
          <label>
            Store
            <select value={viewStoreId} onChange={e => setViewStoreId(e.target.value)}>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          {pricesLoading && <p className="empty">Loading…</p>}
          {!pricesLoading && prices.length === 0 && <p className="empty">No prices recorded for this store.</p>}
          {prices.map(p => (
            <div key={p.id} className="card">
              <span className="name">{p.ingredients?.name ?? '—'}</span>
              <span className="meta">£{Number(p.price).toFixed(2)}</span>
              {p.unit_size && <span className="pill gray">{p.unit_size}{p.unit_size_unit || ''}</span>}
              {p.price_per_canonical && (
                <span className="meta">£{Number(p.price_per_canonical).toFixed(4)} per {p.unit_size_unit || 'unit'}</span>
              )}
            </div>
          ))}
        </>
      )}
    </>
  )
}

