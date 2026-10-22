// State shared by the matching wizard, the chatbot panel and the results page.
// Both entry points fill the SAME criteria object and call the SAME backend matching service,
// so a parent can start in the chatbot and finish in the wizard (or the other way round).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api, { errorMessage } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { preferencesToCriteria } from '../lib/preferences'
import { childSubjects } from '../lib/subjects'

const Ctx = createContext(null)

export const EMPTY_CRITERIA = {
  childId: null,
  subject: '',
  level: '',
  grade: null,
  days: [],
  timePreset: null, // 'MORNING' | 'AFTERNOON' | 'EVENING' (UI only)
  timeStart: null,
  timeEnd: null,
  mode: 'EITHER',
  location: '',
  budgetMin: null, // null = no budget preference
  budgetMax: null,
  gender: 'ANY',
  characteristics: [],
  notes: '',
}

// Strip UI-only/empty values before sending to the API
function toPayload(c) {
  return {
    childId: c.childId || null,
    subject: c.subject,
    level: c.level,
    grade: c.grade || null,
    days: c.days,
    timeStart: c.timeStart || null,
    timeEnd: c.timeEnd || null,
    mode: c.mode,
    location: c.location || null,
    budgetMin: c.budgetMin,
    budgetMax: c.budgetMax,
    gender: c.gender,
    characteristics: c.characteristics,
    notes: c.notes || null,
  }
}

export function MatchingProvider({ children }) {
  const { user } = useAuth()
  const [catalog, setCatalog] = useState(null)
  const [kids, setKids] = useState([])
  const [kidsLoaded, setKidsLoaded] = useState(false)
  const [criteria, setCriteria] = useState(EMPTY_CRITERIA)
  const [result, setResult] = useState(null)
  const [chatOpen, setChatOpen] = useState(false)
  // Set when the option lists or the children could not be loaded, so pages can offer "Try again" instead of spinning
  const [loadError, setLoadError] = useState('')

  const refreshChildren = useCallback(async () => {
    const res = await api.get('/parent/children')
    setKids(res.data.children)
    setKidsLoaded(true)
    return res.data.children
  }, [])

  const loadShared = useCallback(() => {
    setLoadError('')
    api.get('/parent/catalog').then((r) => {
      setCatalog(r.data)
      // The parent's saved preferences (signup / My Profile) are the starting point of every search
      setCriteria((c) => ({ ...c, ...preferencesToCriteria(r.data.preferences) }))
    }).catch((e) => setLoadError(errorMessage(e)))
    refreshChildren().catch((e) => setLoadError(errorMessage(e)))
  }, [refreshChildren])

  // Keyed on who is logged in (not the user object), so editing the profile name does not reload everything
  const userId = user?.id
  const isParent = user?.role === 'PARENT'
  useEffect(() => {
    if (isParent) loadShared()
  }, [userId, isParent, loadShared])

  const patchCriteria = useCallback((patch) => setCriteria((c) => ({ ...c, ...patch })), [])

  // Pre-fill subject/level/grade from one of the parent's children
  const applyChild = useCallback((child) => {
    setCriteria((c) => ({
      ...c,
      childId: child.id,
      level: child.educationLevel,
      grade: child.grade,
      subject: childSubjects(child)[0] || c.subject,
    }))
  }, [])

  const runMatching = useCallback(
    async (source, override) => {
      const res = await api.post('/parent/matching', { source, criteria: toPayload(override || criteria) })
      setResult(res.data)
      return res.data
    },
    [criteria],
  )

  const value = useMemo(
    () => ({
      catalog, kids, kidsLoaded, refreshChildren, criteria, setCriteria, patchCriteria, applyChild,
      result, setResult, runMatching, chatOpen, setChatOpen, loadError, reloadShared: loadShared,
    }),
    [catalog, kids, kidsLoaded, refreshChildren, criteria, patchCriteria, applyChild, result, runMatching, chatOpen, loadError, loadShared],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useMatching = () => useContext(Ctx)
