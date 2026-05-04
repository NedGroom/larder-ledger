import { useState, useEffect, createContext, useContext } from 'react'
import { supabase } from './lib/supabase.js'
import SignIn from './components/SignIn.jsx'
import Layout from './components/Layout.jsx'
import Pantry from './pages/Pantry.jsx'
import Meals from './pages/Meals.jsx'
import Calendar from './pages/Calendar.jsx'
import Stores from './pages/Stores.jsx'
import Shopping from './pages/Shopping.jsx'
import Receipts from './pages/Receipts.jsx'

// ── App-wide context ─────────────────────────────────────────────────────────
// Shares the current house and user session across all pages.
export const AppContext = createContext(null)
export function useApp() { return useContext(AppContext) }

const TABS = [
  { id: 'pantry',   label: '🥕 Pantry' },
  { id: 'meals',    label: '🍲 Meals' },
  { id: 'calendar', label: '📅 Calendar' },
  { id: 'stores',   label: '🏪 Stores' },
  { id: 'shopping', label: '🛒 Shopping' },
  { id: 'receipts', label: '📷 Receipts' },
]

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [house, setHouse] = useState(null)
  const [tab, setTab] = useState('pantry')

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  // ── House auto-select ───────────────────────────────────────────────────────
  // On login, pick the first existing house or create one named after the user.
  useEffect(() => {
    if (!session) { setHouse(null); return }
    async function initHouse() {
      const { data, error } = await supabase.from('houses').select('*').limit(1).single()
      if (data) { setHouse(data); return }
      // No house yet — create one
      const email = session.user.email
      const defaultName = email.split('@')[0] + "'s house"
      const { data: created } = await supabase.from('houses').insert({ name: defaultName }).select().single()
      setHouse(created)
    }
    initHouse()
  }, [session])

  // ── Loading / signed-out states ─────────────────────────────────────────────
  if (session === undefined) return <div className="loading">Loading…</div>
  if (!session) return <SignIn />
  if (!house) return <div className="loading">Setting up your house…</div>

  const ctx = { session, house, tab, setTab }

  return (
    <AppContext.Provider value={ctx}>
      <Layout tabs={TABS} activeTab={tab} onTabChange={setTab}>
        {tab === 'pantry'   && <Pantry />}
        {tab === 'meals'    && <Meals />}
        {tab === 'calendar' && <Calendar />}
        {tab === 'stores'   && <Stores />}
        {tab === 'shopping' && <Shopping />}
        {tab === 'receipts' && <Receipts />}
      </Layout>
    </AppContext.Provider>
  )
}

