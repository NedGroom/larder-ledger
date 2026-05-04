import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { useApp } from '../App.jsx'

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfWeek(year, month) {
  // 0=Sun…6=Sat, we want Mon-first so shift
  return (new Date(year, month, 1).getDay() + 6) % 7
}

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December']
const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

export default function Calendar() {
  const { house } = useApp()
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [meals, setMeals] = useState([])

  const load = useCallback(async () => {
    // Load meals with a planned_date in this month
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const to   = `${year}-${String(month + 1).padStart(2, '0')}-${String(getDaysInMonth(year, month)).padStart(2, '0')}`
    const { data } = await supabase
      .from('meals')
      .select('id, name, dish_type, planned_date')
      .eq('house_id', house.id)
      .gte('planned_date', from)
      .lte('planned_date', to)
    setMeals(data ?? [])
  }, [house.id, year, month])

  useEffect(() => { load() }, [load])

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  // Build a map: date string -> meals[]
  const mealsByDate = {}
  meals.forEach(m => {
    if (!mealsByDate[m.planned_date]) mealsByDate[m.planned_date] = []
    mealsByDate[m.planned_date].push(m)
  })

  const daysInMonth = getDaysInMonth(year, month)
  const firstDow = getFirstDayOfWeek(year, month)
  const todayStr = today.toISOString().slice(0, 10)

  // Build grid cells: nulls for padding + day numbers
  const cells = Array(firstDow).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <>
      <div className="section-title">
        <h2>Meal calendar</h2>
      </div>

      {/* Month navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '.75rem' }}>
        <button className="btn small secondary" onClick={prevMonth}>‹</button>
        <strong style={{ flex: 1, textAlign: 'center' }}>{MONTH_NAMES[month]} {year}</strong>
        <button className="btn small secondary" onClick={nextMonth}>›</button>
      </div>

      {/* Day-of-week headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 2 }}>
        {DAY_NAMES.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: '.72rem', color: '#888', fontWeight: 600, padding: '2px 0' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {cells.map((day, idx) => {
          if (!day) return <div key={`pad-${idx}`} style={{ minHeight: 60 }} />
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const dayMeals = mealsByDate[dateStr] ?? []
          const isToday = dateStr === todayStr
          return (
            <div
              key={dateStr}
              style={{
                minHeight: 60,
                border: isToday ? '2px solid #2d6a4f' : '1px solid #e0e0e0',
                borderRadius: 6,
                padding: '3px 4px',
                background: isToday ? '#f0faf4' : '#fff',
              }}
            >
              <div style={{ fontSize: '.75rem', fontWeight: isToday ? 700 : 400, color: isToday ? '#2d6a4f' : '#555' }}>
                {day}
              </div>
              {dayMeals.map(m => (
                <div
                  key={m.id}
                  title={m.name}
                  style={{
                    fontSize: '.68rem',
                    background: '#d8f3dc',
                    color: '#1b4332',
                    borderRadius: 3,
                    padding: '1px 3px',
                    marginTop: 2,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {m.name}
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {meals.length === 0 && (
        <p className="empty" style={{ marginTop: '1rem' }}>
          No meals planned this month. Go to Meals and press Plan on a meal.
        </p>
      )}
    </>
  )
}

