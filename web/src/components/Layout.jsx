import { useApp } from '../App.jsx'
import { supabase } from '../lib/supabase.js'

export default function Layout({ tabs, activeTab, onTabChange, children }) {
  const { session, house } = useApp()

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <>
      <header>
        <span style={{ fontSize: '1.3rem' }}>🥫</span>
        <h1>LarderLedger</h1>
        <div className="header-right">
          <span>{house?.name}</span>
          <button className="signout-btn" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <nav>
        {tabs.map(t => (
          <button
            key={t.id}
            className={activeTab === t.id ? 'active' : ''}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="page">{children}</div>
    </>
  )
}

