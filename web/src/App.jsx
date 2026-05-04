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
  // On login, find the user's house via house_users, or create one.
  useEffect(() => {
    if (!session) { setHouse(null); return }
    async function initHouse() {
      const userId = session.user.id

      // Ensure user row exists in public.users (trigger handles new signups,
      // but existing users before the trigger was added need this)
      await supabase.from('users').upsert(
        { id: userId, email: session.user.email },
        { onConflict: 'id', ignoreDuplicates: true }
      )

      // Look up houses the user is a member of
      const { data: membership } = await supabase
        .from('house_users')
        .select('house_id, houses(*)')
        .eq('user_id', userId)
        .limit(1)
        .single()

      if (membership?.houses) {
        setHouse(membership.houses)
        return
      }

      // No house yet — create one and add the user as owner
      const email = session.user.email
      const defaultName = email.split('@')[0] + "'s house"
      const { data: created, error } = await supabase
        .from('houses')
        .insert({ name: defaultName })
        .select()
        .single()

      if (created) {
        // Register user as owner in house_users
        await supabase.from('house_users').insert({
          house_id: created.id,
          user_id: userId,
          role: 'owner',
        })
        setHouse(created)
      }
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

