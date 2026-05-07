import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { useApp } from '../App.jsx'
import { PROVIDERS, extractPrices } from '../lib/ai.js'
import logger from '../lib/logger.js'
import { defaultCanonicalRateUnit, calcCanonicalRate } from '../lib/units.js'

const PROVIDER_KEYS = Object.keys(PROVIDERS)
const LS_PROVIDER = 'll_ai_provider'
const LS_KEY      = 'll_ai_key'

// ── Single candidate card ─────────────────────────────────────────────────────
function CandidateCard({ row, ingredients, houseMembers, onChange, onIgnore, onSave, saving }) {
  const [mode, setMode] = useState(() => row.match_type === 'existing' ? 'existing' : 'new')
  const [fadingOut, setFadingOut] = useState(false)

  // Kick off fade when saved
  useEffect(() => {
    if (row._saved) { setFadingOut(true) }
  }, [row._saved])

  if (row._ignored) {
    return (
      <div className="candidate-card candidate-card--ignored">
        <span className="candidate-ignored-label">⊘ Ignored — {row.description || '(no description)'}</span>
        <button className="btn ghost small" onClick={onIgnore}>Undo</button>
      </div>
    )
  }

  const isExistingMatch = row.match_type === 'existing'
  const hasMatch = !!row.match_name

  return (
    <div className={`candidate-card ${fadingOut ? 'candidate-card--fading' : ''}`}>

      {/* ── AI match banner ── */}
      {hasMatch && (
        <div className={`match-banner ${isExistingMatch ? 'match-banner--existing' : 'match-banner--new'}`}>
          <span className="match-banner-label">
            {isExistingMatch ? '✓ Matches existing:' : '✦ Suggested name:'}
          </span>
          <button
            className={`match-chip match-chip--primary ${row.matched_ingredient_id || row.new_ingredient_name === row.match_name ? 'match-chip--selected' : ''}`}
            onClick={() => {
              if (isExistingMatch) {
                const found = ingredients.find(i => i.name === row.match_name)
                if (found) { onChange('matched_ingredient_id', String(found.id)); onChange('new_ingredient_name', ''); setMode('existing') }
              } else {
                onChange('new_ingredient_name', row.match_name); onChange('matched_ingredient_id', ''); setMode('new')
              }
            }}
          >{row.match_name}</button>
          {(row.match_alts ?? []).map((alt, i) => {
            const found = isExistingMatch ? ingredients.find(ing => ing.name === alt) : null
            return (
              <button
                key={i}
                className={`match-chip match-chip--alt ${isExistingMatch ? (row.matched_ingredient_id === String(found?.id) ? 'match-chip--selected' : '') : (row.new_ingredient_name === alt ? 'match-chip--selected' : '')}`}
                onClick={() => {
                  if (isExistingMatch && found) {
                    onChange('matched_ingredient_id', String(found.id)); onChange('new_ingredient_name', ''); setMode('existing')
                  } else if (!isExistingMatch) {
                    onChange('new_ingredient_name', alt); onChange('matched_ingredient_id', ''); setMode('new')
                  }
                }}
              >{alt}</button>
            )
          })}
          <span style={{ flex: 1 }} />
          <button className="btn ghost small candidate-ignore-btn" onClick={onIgnore} title="Ignore this item">⊘</button>
        </div>
      )}

      {/* ── Ingredient assignment (manual override) ── */}
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

        {!hasMatch && (
          <button className="btn ghost small candidate-ignore-btn" onClick={onIgnore} title="Ignore this item">⊘</button>
        )}
      </div>

      {/* ── Price sub-fields + per-card save ── */}
      <div className="candidate-fields">
        <label className="candidate-field">
          <span>Description</span>
          <input type="text" value={row.description} onChange={e => onChange('description', e.target.value)} />
        </label>
        <label className="candidate-field candidate-field--xsmall">
          <span>Qty</span>
          <input type="number" step="1" min="1" value={row.quantity ?? 1} onChange={e => onChange('quantity', e.target.value)} />
        </label>
        <label className="candidate-field candidate-field--small">
          <span>Per unit £</span>
          <input type="number" step="0.01" min="0" value={row.price} onChange={e => onChange('price', e.target.value)} />
        </label>
        <label className="candidate-field candidate-field--small">
          <span>Unit / pkg</span>
          <input type="text" value={row.unit} onChange={e => onChange('unit', e.target.value)} placeholder="e.g. 500g" />
        </label>
        <label className="candidate-field candidate-field--small">
          <span>Who for</span>
          <select value={row.for_user_id || ''} onChange={e => onChange('for_user_id', e.target.value)}>
            <option value="">— shared —</option>
            {houseMembers.map(m => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
          </select>
        </label>
        <button
          className="btn small candidate-save-btn"
          onClick={onSave}
          disabled={saving}
          title="Save this item"
        >{saving ? <span className="spinner" /> : 'Save →'}</button>
      </div>
    </div>
  )
}

// ── Candidate list + save ─────────────────────────────────────────────────────
function CandidateTable({ candidates, ingredients, houseMembers, houseId, storeId, onItemSaved, onDone }) {
  const [rows, setRows] = useState(candidates.map(c => ({
    ...c,
    quantity:              Math.max(1, Number(c.quantity ?? 1)),
    matched_ingredient_id: '',
    new_ingredient_name:   c.match_type === 'new' ? (c.match_name || '') : '',
    for_user_id:           '',
    _ignored: false,
    _saved: false,
    _saving: false,
    ...(c.match_type === 'existing' && c.match_name
      ? (() => {
          const found = ingredients.find(i => i.name === c.match_name)
          return found ? { matched_ingredient_id: String(found.id) } : {}
        })()
      : {}),
  })))
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [saveErr, setSaveErr] = useState('')
  const [showSaved, setShowSaved] = useState(false)

  function update(idx, field, val) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r))
  }

  function toggleIgnore(idx) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, _ignored: !r._ignored } : r))
  }

  async function saveRow(idx) {
    const row = rows[idx]
    if (row._ignored || row._saved || row._saving) return

    setRows(prev => prev.map((r, i) => i === idx ? { ...r, _saving: true } : r))

    let ingredientId = row.matched_ingredient_id ? +row.matched_ingredient_id : null

    if (!ingredientId && row.new_ingredient_name?.trim()) {
      const name = row.new_ingredient_name.trim()
      // Default canonical_rate_unit from the item's unit_size_unit
      const canonRateUnit = defaultCanonicalRateUnit(row.unit)
      const { data: newIng, error: ingErr } = await supabase
        .from('ingredients')
        .insert({
          house_id: houseId,
          name,
          name_normalized: name.toLowerCase(),
          has_any: false,
          canonical_rate_unit: canonRateUnit || null,
        })
        .select('id, canonical_rate_unit')
        .single()
      if (ingErr) {
        setSaveErr(`Failed to create "${name}": ${ingErr.message}`)
        setRows(prev => prev.map((r, i) => i === idx ? { ...r, _saving: false } : r))
        return
      }
      ingredientId = newIng.id
    }

    if (!ingredientId || !row.price) {
      setSaveErr(`Item "${row.description || idx + 1}" needs an ingredient and price.`)
      setRows(prev => prev.map((r, i) => i === idx ? { ...r, _saving: false } : r))
      return
    }

    // Fetch canonical_rate_unit from existing ingredient (may differ from new ones above)
    const { data: ingData } = await supabase
      .from('ingredients')
      .select('canonical_rate_unit')
      .eq('id', ingredientId)
      .single()

    const canonRateUnit = ingData?.canonical_rate_unit || defaultCanonicalRateUnit(row.unit)
    const canonRate = calcCanonicalRate(+row.price, row.unit, canonRateUnit)

    const { error } = await supabase.from('ingredient_prices').insert({
      ingredient_id:      ingredientId,
      store_id:           storeId ? +storeId : null,
      price:              +row.price,
      unit_size_unit:     row.unit || null,
      canonical_rate:     canonRate,
      canonical_rate_unit: canonRateUnit || null,
      currency:           'GBP',
      source:             'receipt-ai',
    })

    if (!error) {
      // Mark ingredient as in-stock (has_any) regardless of who it was bought for
      await supabase
        .from('ingredients')
        .update({ has_any: true })
        .eq('id', ingredientId)
      const savedRow = { ...row, _saved: true, _saving: false }
      setRows(prev => prev.map((r, i) => i === idx ? savedRow : r))
      setSavedCount(c => c + 1)
      onItemSaved(savedRow)
      setTimeout(() => {
        setRows(prev => prev.map((r, i) => i === idx ? { ...r, _removedFromActive: true } : r))
      }, 350)
    } else {
      setSaveErr(`Save failed: ${error.message}`)
      setRows(prev => prev.map((r, i) => i === idx ? { ...r, _saving: false } : r))
    }
  }

  async function saveAll() {
    setSaving(true); setSaveErr('')
    const activeIdxs = rows
      .map((r, i) => i)
      .filter(i => !rows[i]._ignored && !rows[i]._saved && !rows[i]._removedFromActive)
    for (const idx of activeIdxs) {
      await saveRow(idx)
    }
    setSaving(false)
  }

  const activeRows   = rows.filter(r => !r._ignored && !r._removedFromActive)
  const savedRows    = rows.filter(r => r._removedFromActive)
  const ignoredCount = rows.filter(r => r._ignored).length
  const pendingCount = activeRows.filter(r => !r._saved).length

  // ── Running price total ────────────────────────────────────────────────────
  const multiPerson = houseMembers.length > 1
  // Line total = qty × per-unit price
  const lineTotal = r => Number(r.quantity ?? 1) * Number(r.price || 0)
  const savedTotal  = savedRows.reduce((sum, r) => sum + lineTotal(r), 0)

  const personTotals = multiPerson ? (() => {
    const map = {}
    for (const r of savedRows) {
      const key = r.for_user_id || '__shared__'
      map[key] = (map[key] || 0) + lineTotal(r)
    }
    return map
  })() : null

  function personLabel(id) {
    if (id === '__shared__') return 'Shared'
    const m = houseMembers.find(m => String(m.id) === String(id))
    return m ? (m.name || m.email) : 'Unknown'
  }

  return (
    <div className="candidates">
      <div className="candidates-header">
        <span className="candidates-summary">
          {pendingCount} to review{ignoredCount > 0 ? `, ${ignoredCount} ignored` : ''}{savedCount > 0 ? `, ${savedCount} saved ✓` : ''}
        </span>
        {savedCount > 0 && (
          <button className="btn ghost small" onClick={() => setShowSaved(v => !v)}>
            {showSaved ? '▲ Hide saved' : `▼ Show saved (${savedCount})`}
          </button>
        )}
      </div>

      {activeRows.map((row) => {
        const idx = rows.indexOf(row)
        return (
          <CandidateCard
            key={idx}
            row={row}
            ingredients={ingredients}
            houseMembers={houseMembers}
            onChange={(field, val) => update(idx, field, val)}
            onIgnore={() => toggleIgnore(idx)}
            onSave={() => saveRow(idx)}
            saving={row._saving}
          />
        )
      })}

      {showSaved && savedRows.length > 0 && (
        <div className="candidates-saved-section">
          <div className="candidates-saved-label">Saved items</div>
          {savedRows.map((row, i) => (
            <div key={i} className="candidate-card candidate-card--done">
              <span className="candidate-saved-badge">✓</span>
              <span className="candidate-done-desc">{row.new_ingredient_name || row.description}</span>
              {row.for_user_id && <span className="candidate-done-for">{personLabel(row.for_user_id)}</span>}
              <span className="candidate-done-price">
                {Number(row.quantity ?? 1) > 1 ? `${row.quantity} × ` : ''}£{Number(row.price).toFixed(2)}{row.unit ? ` / ${row.unit}` : ''}
                {Number(row.quantity ?? 1) > 1 && <> = £{lineTotal(row).toFixed(2)}</>}
              </span>
            </div>
          ))}
        </div>
      )}

      {saveErr && <p className="msg err" style={{ marginTop: '.5rem' }}>{saveErr}</p>}

      {savedRows.length > 0 && (
        <div className="running-total">
          <span className="running-total-label">Running total</span>
          <span className="running-total-amount">£{savedTotal.toFixed(2)}</span>
          {multiPerson && personTotals && Object.keys(personTotals).length > 0 && (
            <span className="running-total-breakdown">
              {Object.entries(personTotals).map(([key, amt]) => (
                <span key={key} className="running-total-payer">
                  {personLabel(key)}: £{amt.toFixed(2)}
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      <div className="candidates-action-bar">
        <button className="btn" onClick={saveAll} disabled={saving || pendingCount === 0}>
          {saving ? <><span className="spinner" /> Saving…</> : `Save all (${pendingCount})`}
        </button>
        {savedCount > 0 && (
          <button className="btn ghost" onClick={() => onDone(savedRows)}>
            Continue to settlement →
          </button>
        )}
      </div>
    </div>
  )
}

// ── Settlement page ───────────────────────────────────────────────────────────
function SettlementPage({ savedItems, aiFees, aiDiscounts, aiReceiptTotal, houseMembers, onBack }) {
  const [fees, setFees] = useState(
    aiFees?.length ? aiFees.map(f => ({ ...f })) : [{ description: '', amount: '' }]
  )
  const [discounts, setDiscounts] = useState(
    aiDiscounts?.length ? aiDiscounts.map(d => ({ ...d })) : []
  )
  const [receiptTotal, setReceiptTotal] = useState(aiReceiptTotal != null ? String(aiReceiptTotal) : '')
  const [whoPaidId, setWhoPaidId] = useState(houseMembers[0]?.id ? String(houseMembers[0].id) : '')
  const [showBreakdown, setShowBreakdown] = useState(false)

  function updateFee(i, f, v)      { setFees(prev => prev.map((x, xi) => xi === i ? { ...x, [f]: v } : x)) }
  function addFee()                 { setFees(prev => [...prev, { description: '', amount: '' }]) }
  function removeFee(i)             { setFees(prev => prev.filter((_, xi) => xi !== i)) }
  function updateDiscount(i, f, v)  { setDiscounts(prev => prev.map((x, xi) => xi === i ? { ...x, [f]: v } : x)) }
  function addDiscount()            { setDiscounts(prev => [...prev, { description: '', amount: '' }]) }
  function removeDiscount(i)        { setDiscounts(prev => prev.filter((_, xi) => xi !== i)) }

  // ── Maths ──────────────────────────────────────────────────────────────────
  const people = houseMembers
  const n = people.length || 1
  const lineTotal = r => Number(r.quantity ?? 1) * Number(r.price || 0)

  const totalFees      = fees.reduce((s, f) => s + Number(f.amount || 0), 0)
  const totalDiscounts = discounts.reduce((s, d) => s + Number(d.amount || 0), 0)
  const feePerPerson      = totalFees / n
  const discountPerPerson = totalDiscounts / n

  const itemCosts = {}
  people.forEach(p => { itemCosts[String(p.id)] = 0 })
  for (const item of savedItems) {
    const lt = lineTotal(item)
    if (!item.for_user_id) {
      people.forEach(p => { itemCosts[String(p.id)] = (itemCosts[String(p.id)] || 0) + lt / n })
    } else {
      itemCosts[String(item.for_user_id)] = (itemCosts[String(item.for_user_id)] || 0) + lt
    }
  }

  const personTotal = {}
  people.forEach(p => {
    personTotal[String(p.id)] = (itemCosts[String(p.id)] || 0) + feePerPerson - discountPerPerson
  })

  const ourTotal   = Object.values(personTotal).reduce((s, v) => s + v, 0)
  const receiptAmt = receiptTotal !== '' ? Number(receiptTotal) : null
  const difference = receiptAmt != null ? receiptAmt - ourTotal : null

  function personName(id) {
    const m = people.find(p => String(p.id) === String(id))
    return m ? (m.name || m.email) : 'Unknown'
  }

  const payer = whoPaidId
  const debts = people
    .filter(p => String(p.id) !== String(payer))
    .map(p => ({ from: personName(p.id), to: personName(payer), amount: Math.max(0, personTotal[String(p.id)] || 0) }))

  // ── Share helpers ───────────────────────────────────────────────────────────
  function buildShareText(withBreakdown) {
    const lines = ['🧾 Receipt settlement']
    if (debts.length > 0) {
      debts.forEach(d => lines.push(`${d.from} owes ${d.to} £${d.amount.toFixed(2)}`))
    } else {
      lines.push(`Total: £${ourTotal.toFixed(2)} (already settled)`)
    }
    if (withBreakdown && people.length > 0) {
      lines.push('', 'Breakdown:')
      people.forEach(p => {
        const pid = String(p.id)
        const myItems = savedItems.filter(r => !r.for_user_id || String(r.for_user_id) === pid)
        if (myItems.length === 0) return
        lines.push(`  ${p.name || p.email}:`)
        myItems.forEach(r => {
          const lt = lineTotal(r)
          const share = r.for_user_id ? lt : lt / n
          const qtyStr = Number(r.quantity ?? 1) > 1 ? `${r.quantity}×£${Number(r.price).toFixed(2)} ` : ''
          lines.push(`    • ${r.new_ingredient_name || r.description} ${qtyStr}£${share.toFixed(2)}${!r.for_user_id ? ` (shared ÷${n})` : ''}`)
        })
        if (feePerPerson > 0) lines.push(`    • Fees share £${feePerPerson.toFixed(2)}`)
        if (discountPerPerson > 0) lines.push(`    • Discount share −£${discountPerPerson.toFixed(2)}`)
        lines.push(`    = £${(personTotal[pid] || 0).toFixed(2)}`)
      })
    }
    return lines.join('\n')
  }

  async function share(withBreakdown) {
    const text = buildShareText(withBreakdown)
    if (navigator.share) {
      try { await navigator.share({ text }); return } catch (_) {}
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  return (
    <div className="settlement">
      <div className="settlement-header">
        <button className="btn ghost small" onClick={onBack}>← Back to items</button>
        <h3 style={{ margin: 0 }}>Settlement</h3>
      </div>

      {/* ── Fees ── */}
      <div className="settlement-section">
        <div className="settlement-section-title">Fees (split equally)</div>
        {fees.map((f, i) => (
          <div key={i} className="settlement-fee-row">
            <input className="settlement-fee-desc" placeholder="e.g. Delivery fee" value={f.description} onChange={e => updateFee(i, 'description', e.target.value)} />
            <span className="settlement-fee-prefix">£</span>
            <input className="settlement-fee-amt" type="number" step="0.01" min="0" value={f.amount} onChange={e => updateFee(i, 'amount', e.target.value)} />
            <button className="btn ghost small" onClick={() => removeFee(i)} title="Remove">✕</button>
          </div>
        ))}
        <button className="btn ghost small" onClick={addFee} style={{ marginTop: '.25rem' }}>+ Add fee</button>
        {totalFees > 0 && <div className="settlement-fee-total">Total fees: £{totalFees.toFixed(2)} → £{feePerPerson.toFixed(2)} each</div>}
      </div>

      {/* ── Unitemised discounts ── */}
      <div className="settlement-section">
        <div className="settlement-section-title">Unitemised discounts (shared equally)</div>
        {discounts.length === 0 && <p style={{ fontSize: '.78rem', color: 'var(--color-text-muted)', margin: 0 }}>No unitemised discounts — item prices already reflect any item-level discounts.</p>}
        {discounts.map((d, i) => (
          <div key={i} className="settlement-fee-row">
            <input className="settlement-fee-desc" placeholder="e.g. Loyalty card discount" value={d.description} onChange={e => updateDiscount(i, 'description', e.target.value)} />
            <span className="settlement-fee-prefix">−£</span>
            <input className="settlement-fee-amt" type="number" step="0.01" min="0" value={d.amount} onChange={e => updateDiscount(i, 'amount', e.target.value)} />
            <button className="btn ghost small" onClick={() => removeDiscount(i)} title="Remove">✕</button>
          </div>
        ))}
        <button className="btn ghost small" onClick={addDiscount} style={{ marginTop: '.25rem' }}>+ Add discount</button>
        {totalDiscounts > 0 && <div className="settlement-fee-total settlement-discount-total">Total discounts: −£{totalDiscounts.toFixed(2)} → −£{discountPerPerson.toFixed(2)} each</div>}
      </div>

      {/* ── Actual receipt total ── */}
      <div className="settlement-section">
        <div className="settlement-section-title">Actual receipt total</div>
        <div className="settlement-actual-row">
          <span>£</span>
          <input type="number" step="0.01" min="0" className="settlement-actual-input" value={receiptTotal} onChange={e => setReceiptTotal(e.target.value)} placeholder={aiReceiptTotal != null ? String(aiReceiptTotal) : '0.00'} />
          {difference != null && (
            <span className={`settlement-diff ${Math.abs(difference) < 0.01 ? 'settlement-diff--ok' : 'settlement-diff--warn'}`}>
              {Math.abs(difference) < 0.01 ? '✓ Matches' : `${difference > 0 ? '+' : ''}£${difference.toFixed(2)} difference`}
            </span>
          )}
        </div>
        {difference != null && Math.abs(difference) >= 0.01 && (
          <p className="settlement-diff-note">Reconciliation options coming soon — using our calculated numbers for settlement.</p>
        )}
      </div>

      {/* ── Calculated totals ── */}
      <div className="settlement-section">
        <div className="settlement-section-title">Calculated totals</div>
        <div className="settlement-totals-grid">
          {people.map(p => (
            <div key={p.id} className="settlement-total-pill">
              <span className="settlement-total-name">{p.name || p.email}</span>
              <span className="settlement-total-amt">£{(personTotal[String(p.id)] || 0).toFixed(2)}</span>
            </div>
          ))}
        </div>
        <div className="settlement-our-total">Our total: £{ourTotal.toFixed(2)}</div>
      </div>

      {/* ── Who paid ── */}
      {people.length > 1 && (
        <div className="settlement-section">
          <div className="settlement-section-title">Who paid the bill?</div>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            {people.map(p => (
              <button key={p.id} className={`btn small ${String(whoPaidId) === String(p.id) ? '' : 'ghost'}`} onClick={() => setWhoPaidId(String(p.id))}>{p.name || p.email}</button>
            ))}
          </div>
        </div>
      )}

      {/* ── Who owes who + share ── */}
      {people.length > 1 && debts.length > 0 && (
        <div className="settlement-section settlement-debts">
          <div className="settlement-section-title">Who owes who</div>
          {debts.map((d, i) => (
            <div key={i} className="settlement-debt-row">
              <span className="settlement-debt-from">{d.from}</span>
              <span className="settlement-debt-arrow">owes</span>
              <span className="settlement-debt-to">{d.to}</span>
              <span className="settlement-debt-amt">£{d.amount.toFixed(2)}</span>
            </div>
          ))}
          <div className="settlement-share-bar">
            <button className="btn small" onClick={() => share(false)}>
              📤 Share
            </button>
            <button className="btn ghost small" onClick={() => share(true)}>
              📋 Share with breakdown
            </button>
          </div>
        </div>
      )}

      {/* ── Item breakdown (collapsible) ── */}
      {people.length > 0 && (
        <div className="settlement-section settlement-section--collapsible">
          <button className="settlement-collapse-toggle" onClick={() => setShowBreakdown(v => !v)}>
            <span className="settlement-section-title" style={{ margin: 0 }}>Item breakdown</span>
            <span className="settlement-collapse-chevron">{showBreakdown ? '▲' : '▼'}</span>
          </button>
          {showBreakdown && (
            <div className="settlement-breakdown-grid" style={{ marginTop: '.5rem' }}>
              {people.map(p => (
                <div key={p.id} className="settlement-person-col">
                  <div className="settlement-person-name">{p.name || p.email}</div>
                  {savedItems.filter(r => !r.for_user_id || String(r.for_user_id) === String(p.id)).map((r, i) => {
                    const lt = lineTotal(r)
                    const share = r.for_user_id ? lt : lt / n
                    return (
                      <div key={i} className="settlement-item-row">
                        <span>{r.new_ingredient_name || r.description}{Number(r.quantity ?? 1) > 1 ? ` ×${r.quantity}` : ''}</span>
                        <span>£{share.toFixed(2)}{!r.for_user_id ? <sup title="shared"> ÷{n}</sup> : ''}</span>
                      </div>
                    )
                  })}
                  {feePerPerson > 0 && <div className="settlement-item-row" style={{ opacity: .65 }}><span>Fees</span><span>£{feePerPerson.toFixed(2)}</span></div>}
                  {discountPerPerson > 0 && <div className="settlement-item-row settlement-item-row--discount"><span>Discount</span><span>−£{discountPerPerson.toFixed(2)}</span></div>}
                  <div className="settlement-person-subtotal">Total: £{(personTotal[String(p.id)] || 0).toFixed(2)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Receipts page ────────────────────────────────────────────────────────
export default function Receipts() {
  const { house, session, receiptSession, setReceiptSession } = useApp()

  // Helper: patch a subset of the persisted receipt session
  function rs(patch) { setReceiptSession(prev => ({ ...prev, ...patch })) }

  // Persisted across tab switches (lives in App context)
  const {
    plainText, candidates, storeId, extractErr,
    inputMode, stores, ingredients, houseMembers, storesLoaded,
    aiFees, aiDiscounts, aiReceiptTotal, savedItems, showSettlement,
  } = receiptSession

  // Not persisted (local only — File objects can't be serialised)
  const [provider, setProvider] = useState(() => localStorage.getItem(LS_PROVIDER) || PROVIDER_KEYS[0])
  const [apiKey, setApiKey]     = useState(() => localStorage.getItem(LS_KEY) || '')
  const [imageFile, setImageFile] = useState(null)

  const [extracting, setExtracting] = useState(false)
  const [extractErrDetail, setExtractErrDetail] = useState(null)
  const [showErrDetail, setShowErrDetail] = useState(false)

  const [textPopup, setTextPopup] = useState(false)
  const [imgPopup, setImgPopup]   = useState(false)

  const fileRef = useRef()
  const currentProvider = PROVIDERS[provider]

  // If user switches to a provider that doesn't support images, reset to text
  useEffect(() => {
    if (!currentProvider?.supportsImage && inputMode === 'image') rs({ inputMode: 'text' })
  }, [provider])

  async function ensureLoaded() {
    if (storesLoaded) return
    const [{ data: s }, { data: i }, { data: hu }] = await Promise.all([
      supabase.from('stores').select('*').eq('house_id', house.id).order('name'),
      supabase.from('ingredients').select('id,name').eq('house_id', house.id).order('name'),
      supabase.from('house_users').select('users(id,name,email)').eq('house_id', house.id),
    ])
    const members = (hu ?? []).map(r => r.users).filter(Boolean)
    const storeList = s ?? []
    rs({
      stores: storeList,
      ingredients: i ?? [],
      houseMembers: members,
      storeId: storeList.length ? storeList[0].id : '',
      storesLoaded: true,
    })
  }

  function saveConfig() {
    localStorage.setItem(LS_PROVIDER, provider)
    localStorage.setItem(LS_KEY, apiKey)
  }

  async function runExtraction() {
    rs({ extractErr: '', candidates: null })
    setExtractErrDetail(null); setShowErrDetail(false)
    if (currentProvider?.requiresApiKey && !apiKey) { rs({ extractErr: 'Enter an API key above' }); return }
    if (inputMode === 'image' && !imageFile) { rs({ extractErr: 'Select an image first' }); return }
    if (inputMode === 'text' && !plainText.trim()) { rs({ extractErr: 'Paste some receipt text first' }); return }
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
        knownIngredients: ingredients.map(i => i.name),
      })
      rs({ candidates: result.items, aiFees: result.fees, aiDiscounts: result.discounts, aiReceiptTotal: result.receipt_total, savedItems: [], showSettlement: false })
    } catch (e) {
      rs({ extractErr: e.message })
      setExtractErrDetail(logger.errors().slice(-5))
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
      {/* ── Settlement view (replaces everything when active) ── */}
      {showSettlement && (
        <SettlementPage
          savedItems={savedItems}
          aiFees={aiFees}
          aiDiscounts={aiDiscounts}
          aiReceiptTotal={aiReceiptTotal}
          houseMembers={houseMembers}
          onBack={() => rs({ showSettlement: false })}
        />
      )}

      {!showSettlement && (
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
            <select value={provider} onChange={e => { setProvider(e.target.value); rs({ candidates: null }) }}>
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
          onClick={() => { rs({ inputMode: 'text', candidates: null }) }}
        >📋 Paste text</button>
        {currentProvider?.supportsImage && (
          <button
            className={`btn small ${inputMode === 'image' ? '' : 'ghost'}`}
            onClick={() => { rs({ inputMode: 'image', candidates: null }) }}
          >📷 Image</button>
        )}
      </div>

      {inputMode === 'text' && (
        <label>
          <span style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
            Paste receipt text
            {plainText.trim() && (
              <button
                type="button"
                className="btn ghost small"
                title="Open in popup"
                style={{ padding: '1px 6px', fontSize: '.7rem', lineHeight: 1.4 }}
                onClick={() => setTextPopup(true)}
              >⤢</button>
            )}
          </span>
          <textarea
            value={plainText}
            onChange={e => { rs({ plainText: e.target.value, candidates: null }) }}
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
            onChange={e => { setImageFile(e.target.files[0] ?? null); rs({ candidates: null }) }}
          />
          {imageFile && (
            <div style={{ position: 'relative', display: 'inline-block', marginTop: '.5rem' }}>
              <img
                src={URL.createObjectURL(imageFile)} alt="preview"
                style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6, objectFit: 'contain', display: 'block' }}
              />
              <button
                type="button"
                className="btn ghost small"
                title="Open image in popup"
                style={{ position: 'absolute', top: 4, right: 4, padding: '1px 6px', fontSize: '.7rem', lineHeight: 1.4, background: 'rgba(0,0,0,.5)', color: '#fff', border: 'none', borderRadius: 4 }}
                onClick={() => setImgPopup(true)}
              >⤢</button>
            </div>
          )}
        </label>
      )}

      {/* ── Text popup ───────────────────────────────────────────────── */}
      {textPopup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setTextPopup(false)}>
          <div style={{ background: 'var(--bg, #1e1e2e)', borderRadius: 10, padding: '1.25rem', maxWidth: '90vw', width: 520, maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: '.75rem', boxShadow: '0 8px 32px rgba(0,0,0,.5)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '.9rem' }}>Receipt text</strong>
              <button className="btn ghost small" onClick={() => setTextPopup(false)}>✕</button>
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowY: 'auto', flex: 1, fontSize: '.82rem', margin: 0, fontFamily: 'monospace', color: 'var(--fg, #cdd6f4)' }}>{plainText}</pre>
          </div>
        </div>
      )}

      {/* ── Image popup ──────────────────────────────────────────────── */}
      {imgPopup && imageFile && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setImgPopup(false)}>
          <div style={{ position: 'relative', maxWidth: '92vw', maxHeight: '92vh' }} onClick={e => e.stopPropagation()}>
            <button className="btn ghost small" onClick={() => setImgPopup(false)}
              style={{ position: 'absolute', top: -12, right: -12, zIndex: 1, background: 'rgba(0,0,0,.6)', color: '#fff', border: 'none', borderRadius: '50%', width: 28, height: 28, padding: 0, fontSize: '1rem' }}>✕</button>
            <img src={URL.createObjectURL(imageFile)} alt="receipt"
              style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 8, objectFit: 'contain', display: 'block' }} />
          </div>
        </div>
      )}

      {extractErr && (
        <div className="extract-err-block">
          <p className="msg err">{extractErr}</p>
          {extractErrDetail?.length > 0 && (
            <button className="err-detail-toggle" onClick={() => setShowErrDetail(v => !v)}>
              {showErrDetail ? '▲ hide detail' : '▼ show detail'}
            </button>
          )}
          {showErrDetail && (
            <pre className="err-detail-pre">
              {extractErrDetail.map((e, i) => JSON.stringify(e, null, 2)).join('\n\n')}
            </pre>
          )}
        </div>
      )}

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
              <select value={storeId} onChange={e => rs({ storeId: e.target.value })}>
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
            onItemSaved={row => rs({ savedItems: [...(savedItems || []), row] })}
            onDone={finalSavedRows => rs({ showSettlement: true, savedItems: finalSavedRows })}
          />
        </>
      )}
      )}
    </>
  )
}  )
}


