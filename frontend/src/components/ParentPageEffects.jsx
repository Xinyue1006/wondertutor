import { createContext, useContext } from 'react'
import Icon from './ui/Icon'
import './ParentPageEffects.css'

const ParentEffects = createContext(false)

// Visual enhancement only: no route remounts, timers, observers or data changes.
export default function ParentPageEffects({ children }) {
  return <ParentEffects.Provider value={true}><div className="parent-page-effects">{children}</div></ParentEffects.Provider>
}

export function ParentHeaderDecor({ compact = false }) {
  const enabled = useContext(ParentEffects)
  if (!enabled) return null
  return <div aria-hidden="true" className={`parent-header-art${compact ? ' parent-header-art--compact' : ''}`}>
    <svg className="parent-decor-trail" viewBox="0 0 120 72" fill="none" focusable="false">
      <path d="M8 48C22 68 56 67 73 45S107 25 113 37" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 6" strokeLinecap="round" />
      <circle cx="15" cy="15" r="2" fill="currentColor" stroke="none" />
    </svg>
    <Icon name="book" className="parent-decor-book" strokeWidth={1.35} />
    <Icon name="cap" className="parent-decor-cap" strokeWidth={1.35} />
    <Icon name="edit" className="parent-decor-pencil" strokeWidth={1.4} />
  </div>
}
