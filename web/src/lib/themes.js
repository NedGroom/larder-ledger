export const THEMES = [
  { id: 'forest',   label: 'Forest',   swatch: '#2d6a4f', header: '#2d6a4f', nav: '#1b4332', accent: '#52b788', btn: '#2d6a4f' },
  { id: 'ocean',    label: 'Ocean',    swatch: '#1a5f7a', header: '#1a5f7a', nav: '#0e3d52', accent: '#38bdf8', btn: '#1a5f7a' },
  { id: 'sunset',   label: 'Sunset',   swatch: '#b5451b', header: '#b5451b', nav: '#7c2d12', accent: '#fb923c', btn: '#b5451b' },
  { id: 'lavender', label: 'Lavender', swatch: '#5b4fa8', header: '#5b4fa8', nav: '#3b3175', accent: '#a78bfa', btn: '#5b4fa8' },
  { id: 'slate',    label: 'Slate',    swatch: '#334155', header: '#334155', nav: '#1e293b', accent: '#94a3b8', btn: '#334155' },
  { id: 'rose',     label: 'Rose',     swatch: '#9d174d', header: '#9d174d', nav: '#6d1035', accent: '#f472b6', btn: '#9d174d' },
]

export const DEFAULT_THEME = 'lavender'

export function applyTheme(themeId) {
  const t = THEMES.find(t => t.id === themeId) || THEMES[0]
  const root = document.documentElement
  root.style.setProperty('--color-header', t.header)
  root.style.setProperty('--color-nav', t.nav)
  root.style.setProperty('--color-accent', t.accent)
  root.style.setProperty('--color-btn', t.btn)
  localStorage.setItem('theme', themeId)
}

export function applyDarkMode(dark) {
  document.documentElement.setAttribute('data-dark', dark ? '1' : '0')
  localStorage.setItem('darkMode', dark ? '1' : '0')
}

export function isDarkMode() {
  const stored = localStorage.getItem('darkMode')
  return stored === null ? true : stored === '1'
}

export function loadTheme() {
  applyTheme(localStorage.getItem('theme') || DEFAULT_THEME)
  applyDarkMode(isDarkMode())
}
