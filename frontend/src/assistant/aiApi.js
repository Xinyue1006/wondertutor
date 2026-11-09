// API calls for the read-only AI assistant. The browser never talks to the AI provider directly and holds no keys:
// it only sends the parent's message (and a child choice) to our own backend.
import { useEffect, useState } from 'react'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'

export const getCapabilities = () => api.get('/parent/assistant/capabilities').then((r) => r.data)

export const sendAssistantMessage = ({ conversationId, message, selection }, signal) =>
  api.post('/parent/assistant/messages', { ...(conversationId && { conversationId }), message, ...(selection && { selection }) }, { signal }).then((r) => r.data)

export const deleteConversation = (id) => api.delete(`/parent/assistant/conversations/${encodeURIComponent(id)}`)

// What the assistant may offer for the logged-in parent. null while loading; { enabled: false } if it cannot be reached.
export function useAssistantCapabilities() {
  const { user } = useAuth()
  const [caps, setCaps] = useState(null)
  const userId = user?.id
  useEffect(() => {
    let live = true
    getCapabilities()
      .then((c) => live && setCaps(c))
      .catch(() => live && setCaps({ enabled: false, modes: ['guided'] }))
    return () => { live = false }
  }, [userId])
  return caps
}

// Split "[[child_1]]'s lesson" into text and entity pieces. Only references the SERVER resolved (entities map) get a
// name; anything else is shown as neutral text. Rendered as React text nodes, never as HTML.
export function splitEntities(text, entities = {}) {
  const out = []
  const re = /\[\[([a-z]+_\d+)\]\]/g
  let last = 0
  let m
  while ((m = re.exec(text || ''))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    out.push(entities[m[1]] ? { entity: entities[m[1]] } : { text: 'this record' })
    last = m.index + m[0].length
  }
  if (last < (text || '').length) out.push({ text: text.slice(last) })
  return out
}

// Only in-app parent routes are ever turned into links (cards come from the server, this is a second check)
export const safeRoute = (link) => (typeof link === 'string' && /^\/parent(\/[A-Za-z0-9/_-]*)?(\?[A-Za-z0-9=&_-]*)?$/.test(link) ? link : null)
