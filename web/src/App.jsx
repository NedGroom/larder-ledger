import { useState, useEffect, createContext, useContext } from 'react'
import { supabase } from './lib/supabase.js'
import { loadTheme } from './lib/themes.js'
import SignIn from './components/SignIn.jsx'
import Layout from './components/Layout.jsx'
import HousePicker from './components/HousePicker.jsx'
import Pantry from './pages/Pantry.jsx'
import Meals from './pages/Meals.jsx'
import Calendar from './pages/Calendar.jsx'
import Stores from './pages/Stores.jsx'
import Shopping from './pages/Shopping.jsx'
import Receipts from './pages/Receipts.jsx'
import Settings from './pages/Settings.jsx'

// ── App-wide context ─────────────────────────────────────────────────────────
// Shares the current house and user session across all pages.
export const AppContext = createContext(null)
export function useApp() { return useContext(AppContext) }

const TABS = [
  { id: 'pantry',   label: '🧺 Larder' },
  { id: 'meals',    label: '🍲 Meals' },
  { id: 'calendar', label: '📅 Calendar' },
  { id: 'shopping', label: '🛒 Shopping List' },
  { id: 'stores',   label: '🏪 Shops' },
  { id: 'receipts', label: '📷 Import Receipt' },
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

  useEffect(() => { loadTheme() }, [])

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  // ── User row + house lookup (no auto-create) ────────────────────────────────
  useEffect(() => {
    if (!session) { setHouse(null); setUserRow(null); return }
    async function initUser() {
      const userId = session.user.id

      // Upsert into public.users
      const { data: uRow } = await supabase
        .from('users')
        .upsert(
          { auth_uid: userId, email: session.user.email, name: session.user.user_metadata?.full_name },
          { onConflict: 'auth_uid' }
        )
        .select('id')
        .single()

      if (!uRow) return
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
  if (!userRow) return <div className="loading">Loading…</div>
  // No house yet — show picker
  if (!house) return <HousePicker userRow={userRow} onJoined={h => setHouse(h)} />

  const ctx = { session, house, setHouse, userRow, tab, setTab, receiptSession, setReceiptSession }

  return (
    <AppContext.Provider value={ctx}>
      <Layout tabs={TABS} activeTab={tab} onTabChange={setTab}>
        {tab === 'pantry'   && <Pantry />}
        {tab === 'meals'    && <Meals />}
        {tab === 'calendar' && <Calendar />}
        {tab === 'stores'   && <Stores />}
        {tab === 'shopping' && <Shopping />}
        {tab === 'receipts' && <Receipts />}
        {tab === 'settings' && <Settings />}      </Layout>
    </AppContext.Provider>
  )
}

