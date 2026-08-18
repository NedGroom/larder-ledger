import { useState, useEffect, createContext, useContext } from 'react'
import { supabase } from './lib/supabase.js'
import { loadTheme } from './lib/themes.js'
import SignIn from './components/SignIn.jsx'
import Layout from './components/Layout.jsx'
import HousePicker from './components/HousePicker.jsx'
import Pantry from './pages/Pantry.jsx'
import Meals from './pages/Meals.jsx'
import Planner from './pages/Planner.jsx'
import Stores from './pages/Stores.jsx'
import Shopping from './pages/Shopping.jsx'
import Settings from './pages/Settings.jsx'

// ── App-wide context ─────────────────────────────────────────────────────────
// Shares the current house and user session across all pages.
export const AppContext = createContext(null)
export function useApp() { return useContext(AppContext) }

const TABS = [
  { id: 'pantry',   label: '🧺 Larder' },
  { id: 'meals',    label: '🍲 Dishes' },
  { id: 'calendar', label: '📅 Plan' },
  { id: 'shopping', label: '🛒 Shopping' },
  { id: 'stores',   label: '🏪 Shops' },
]

// ── Persistent receipt-session state (survives tab switches) ─────────────────
// imageFile is intentionally excluded — File objects can't be serialised.
export const defaultReceiptSession = {
  provider:       null,
  plainText:      '',
  candidates:     null,
  storeId:        '',
  extractErr:     '',
  inputMode:      'text',
  stores:         [],
  ingredients:    [],
  houseMembers:   [],
  storesLoaded:   false,
  // AI-extracted receipt-level data
  aiFees:         [],    // [{ description, amount }]
  aiDiscounts:    [],    // [{ description, amount }]
  aiReceiptTotal: null,  // number | null
  aiStoreName:    null,  // shop name read off the receipt
  purchaseDate:   null,  // 'YYYY-MM-DD' — when the shop happened
  receiptListId:  null,  // the shopping_lists row this receipt is filling
  // Settlement flow
  savedItems:     [],    // rows that have been saved (for settlement)
  showSettlement: false,
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [house, setHouse] = useState(null)
  const [userRow, setUserRow] = useState(null)
  const [tab, setTab] = useState('pantry')
  const [receiptSession, setReceiptSession] = useState(defaultReceiptSession)
  const [initErr, setInitErr] = useState('')

  useEffect(() => { loadTheme() }, [])

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  // ── User row + house lookup (no auto-create) ────────────────────────────────
  useEffect(() => {
    if (!session) { setHouse(null); setUserRow(null); setInitErr(''); return }
    async function initUser() {
      const userId = session.user.id

      // Upsert into public.users.
      // `select('*')` rather than naming columns: naming one the database
      // hasn't got yet fails the whole query, and the app then sat on
      // "Loading…" for ever with nothing said. Take whatever exists.
      const { data: uRow, error: uErr } = await supabase
        .from('users')
        .upsert(
          { auth_uid: userId, email: session.user.email, name: session.user.user_metadata?.full_name },
          { onConflict: 'auth_uid' }
        )
        .select('*')
        .single()

      if (uErr || !uRow) {
        setInitErr(uErr?.message || 'Could not load your account.')
        return
      }
      setInitErr('')
      setUserRow(uRow)

      // Find existing house membership
      const { data: membership } = await supabase
        .from('house_users')
        .select('house_id, houses(*)')
        .eq('user_id', uRow.id)
        .limit(1)
        .maybeSingle()

      if (membership?.houses) {
        setHouse(membership.houses)
      }
      // If no membership, house stays null → HousePicker is shown
    }
    initUser()
  }, [session])

  // ── Loading / signed-out states ─────────────────────────────────────────────
  if (session === undefined) return <div className="loading">Loading…</div>
  if (!session) return <SignIn />

  // Never spin for ever: if the account can't be read, say why. Nine times out
  // of ten it's a migration that hasn't been applied to this database yet.
  if (initErr) {
    return (
      <div className="loading">
        <p className="msg err" style={{ maxWidth: 460 }}>{initErr}</p>
        <p className="muted-note" style={{ maxWidth: 460 }}>
          If this mentions a missing column or table, the database is behind the app:
          run <code>supabase db push</code> and apply <code>policies.sql</code>.
        </p>
        <button className="btn small secondary" onClick={() => window.location.reload()}>Try again</button>
        <button className="btn small secondary" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    )
  }
  if (!userRow) return <div className="loading">Loading…</div>
  // No house yet — show picker
  if (!house) return <HousePicker userRow={userRow} onJoined={h => setHouse(h)} />

  const ctx = { session, house, setHouse, userRow, tab, setTab, receiptSession, setReceiptSession }

  return (
    <AppContext.Provider value={ctx}>
      <Layout tabs={TABS} activeTab={tab} onTabChange={setTab}>
        {tab === 'pantry'   && <Pantry />}
        {tab === 'meals'    && <Meals />}
        {tab === 'calendar' && <Planner />}
        {tab === 'stores'   && <Stores />}
        {tab === 'shopping' && <Shopping />}
        {tab === 'settings' && <Settings />}      </Layout>
    </AppContext.Provider>
  )
}

