import { useEffect, useId, useRef, useState } from 'react'
import { hasLessonPoint } from '../lib/lessonLocationInput'

const DEFAULT_CENTER = [3.139, 101.6869]

function CoordinateField({ label, value, disabled, onChange, id }) {
  const [draft, setDraft] = useState(value ?? '')
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setDraft(value ?? '') }, [value])
  return <label className="block min-w-0 text-sm font-semibold text-navy" htmlFor={id}>{label}
    <input id={id} type="text" inputMode="decimal" disabled={disabled} value={draft} className="input mt-1 min-w-0"
      onFocus={() => { focused.current = true }} onBlur={() => { focused.current = false; setDraft(value ?? '') }}
      onChange={e => {
        const raw = e.target.value
        setDraft(raw)
        const parsed = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim()) ? Number(raw) : null
        onChange(Number.isFinite(parsed) ? parsed : null)
      }} />
  </label>
}

// Loading tiles is an explicit choice. The address is never sent to a geocoder.
function VenueMap({ value, onPoint, disabled, initialCenter, focusPoint }) {
  const container = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const leafletRef = useRef(null)
  const initialViewport = useRef(initialCenter)
  const latest = useRef({ value, onPoint, disabled })
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const { latitude, longitude } = value
  useEffect(() => { latest.current = { value, onPoint, disabled } }, [value, onPoint, disabled])

  useEffect(() => {
    let disposed = false
    let resizeObserver
    Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(([module]) => {
      if (disposed) return
      const L = module.default || module
      leafletRef.current = L
      const center = hasLessonPoint(latest.current.value) ? [latest.current.value.latitude, latest.current.value.longitude]
        : Array.isArray(initialViewport.current) && hasLessonPoint({ latitude: initialViewport.current[0], longitude: initialViewport.current[1] }) ? initialViewport.current : DEFAULT_CENTER
      const map = L.map(container.current, { scrollWheelZoom: false }).setView(center, hasLessonPoint(latest.current.value) ? 17 : 11)
      mapRef.current = map
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).on('tileerror', () => { if (!disposed) setError('Map tiles could not load. You can still use GPS or enter coordinates below.') }).addTo(map)
      map.on('click', event => { if (!latest.current.disabled) latest.current.onPoint(event.latlng.lat, event.latlng.lng) })
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => map.invalidateSize())
        resizeObserver.observe(container.current)
      }
      setReady(true)
    }).catch(() => { if (!disposed) setError('The map could not load. Use GPS or enter coordinates below.') })
    return () => {
      disposed = true
      resizeObserver?.disconnect()
      mapRef.current?.remove()
      mapRef.current = null
      markerRef.current = null
    }
  }, []) // One map per mounted picker; current event callbacks live in latest.

  useEffect(() => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!ready || !map || !L) return
    if (!hasLessonPoint({ latitude, longitude })) {
      markerRef.current?.remove()
      markerRef.current = null
      return
    }
    const point = [latitude, longitude]
    if (!markerRef.current) {
      const marker = L.marker(point, {
        draggable: !disabled, title: 'Actual lesson venue — drag to the entrance', alt: 'Lesson venue pin',
        icon: L.divIcon({ className: '', html: '<span style="display:block;width:24px;height:24px;background:#164eaf;border:3px solid white;border-radius:50%;box-shadow:0 1px 6px #0008"></span>', iconSize: [24, 24], iconAnchor: [12, 12] }),
      }).addTo(map)
      marker.on('dragend', () => {
        const next = marker.getLatLng()
        latest.current.onPoint(next.lat, next.lng)
      })
      markerRef.current = marker
    } else {
      markerRef.current.setLatLng(point)
      if (disabled) markerRef.current.dragging.disable()
      else markerRef.current.dragging.enable()
    }
    if (!map.getBounds().contains(point)) map.setView(point, Math.max(map.getZoom(), 16))
  }, [latitude, longitude, disabled, ready])

  useEffect(() => {
    if (ready && focusPoint) mapRef.current?.setView(focusPoint, 17)
  }, [focusPoint, ready])

  return <div className="space-y-2">
    {!ready && !error && <p role="status" className="text-sm text-slate-500">Loading the map…</p>}
    <div ref={container} role="region" aria-label="Choose lesson venue on map" className="relative z-0 h-64 w-full rounded-xl border border-slate-200 sm:h-72" />
    {error && <p role="status" className="text-sm text-amber-800">{error}</p>}
    <p className="text-xs text-slate-500">Tap the entrance to place the pin, or drag the pin to adjust it. Use + to zoom in.</p>
  </div>
}

export default function LessonLocationPicker({ value, onChange, disabled = false, initialCenter }) {
  const id = useId()
  const [mapOpen, setMapOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [gpsMessage, setGpsMessage] = useState('')
  const [focusPoint, setFocusPoint] = useState(null)
  const mounted = useRef(true)
  const latest = useRef({ value, onChange, disabled })
  useEffect(() => { latest.current = { value, onChange, disabled } }, [value, onChange, disabled])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const update = patch => {
    if ('latitude' in patch || 'longitude' in patch) { setFocusPoint(null); setGpsMessage('') }
    onChange({ ...value, ...patch, confirmed: false })
  }
  function choosePoint(latitude, longitude) {
    setGpsMessage('')
    update({ latitude: Number(latitude.toFixed(7)), longitude: Number(longitude.toFixed(7)) })
  }
  function locate() {
    setGpsMessage('')
    if (!navigator.geolocation) return setGpsMessage('GPS is unavailable. Open the map or enter the venue coordinates below.')
    setLocating(true)
    navigator.geolocation.getCurrentPosition(position => {
      if (!mounted.current) return
      setLocating(false)
      if (latest.current.disabled) return
      const { latitude, longitude, accuracy } = position.coords
      setFocusPoint([latitude, longitude])
      if (!Number.isFinite(accuracy) || accuracy > 100) {
        latest.current.onChange({ ...latest.current.value, confirmed: false })
        setGpsMessage(`GPS accuracy is ${Number.isFinite(accuracy) ? Math.round(accuracy) + ' m' : 'unknown'}. Open the map and choose the actual entrance, or enter accurate coordinates. This GPS estimate has not been selected.`)
        return
      }
      latest.current.onChange({ ...latest.current.value, latitude: Number(latitude.toFixed(7)), longitude: Number(longitude.toFixed(7)), confirmed: false })
      setGpsMessage(`GPS point selected (accuracy about ${Math.round(accuracy)} m). Check that it is the lesson entrance before confirming.`)
    }, () => {
      if (!mounted.current) return
      setLocating(false)
      setGpsMessage('Could not get your location. Allow location access over HTTPS, or open the map / enter coordinates instead.')
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 })
  }
  const validPoint = hasLessonPoint(value)
  const canConfirm = validPoint && value.address.trim().length >= 10 && value.address.trim().length <= 191

  return <div className="min-w-0 space-y-4">
    <p className="text-sm text-slate-600">Give the actual lesson address and entrance pin. This is shared with the selected tutor for these lessons; it does not change your profile area or tutor matching.</p>
    <div>
      <label htmlFor={`${id}-address`} className="block text-sm font-bold text-navy">Full lesson address</label>
      <textarea id={`${id}-address`} rows={3} maxLength={191} disabled={disabled} value={value.address} className="input mt-1 w-full resize-y"
        placeholder="Unit / house number, building, street, postcode and town" onChange={e => update({ address: e.target.value })} />
    </div>
    <div className="space-y-2">
      <p className="text-xs text-slate-500">Opening the map shares your IP address and viewed map area with OpenStreetMap tile servers. Your typed street address is not sent to a map search or AI.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled} className="btn-outline min-h-11 max-w-full px-3" onClick={() => setMapOpen(open => !open)}>{mapOpen ? 'Hide map' : 'Open map to choose the entrance'}</button>
        <button type="button" disabled={disabled || locating} className="btn-outline min-h-11 max-w-full px-3" onClick={locate}>{locating ? 'Finding your location…' : 'Use my current location'}</button>
      </div>
      <p className="text-xs text-slate-500">Use current location only when you are physically at the lesson venue.</p>
    </div>
    {mapOpen && <VenueMap value={value} onPoint={choosePoint} disabled={disabled} initialCenter={initialCenter} focusPoint={focusPoint} />}
    {gpsMessage && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{gpsMessage}</p>}
    <details className="rounded-xl border border-slate-200 p-3">
      <summary className="min-h-8 cursor-pointer text-sm font-semibold text-navy">Enter coordinates instead (if the map is unavailable)</summary>
      <p className="mb-3 text-xs text-slate-500">Use the exact venue coordinates from a trusted map, rather than the town or area centre.</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <CoordinateField id={`${id}-lat`} label="Latitude (−90 to 90)" value={value.latitude} disabled={disabled} onChange={latitude => update({ latitude })} />
        <CoordinateField id={`${id}-lng`} label="Longitude (−180 to 180)" value={value.longitude} disabled={disabled} onChange={longitude => update({ longitude })} />
      </div>
    </details>
    <p role="status" className="text-sm text-slate-600">{validPoint ? `Selected pin: ${value.latitude.toFixed(6)}, ${value.longitude.toFixed(6)}` : 'No lesson pin selected yet.'}</p>
    <label className="flex items-start gap-3 rounded-xl bg-brand-50 p-3 text-sm text-navy">
      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" disabled={disabled || !canConfirm} checked={value.confirmed === true}
        onChange={e => onChange({ ...value, confirmed: e.target.checked })} />
      <span>I confirm the address and pin identify the actual lesson venue. The tutor will use this pin for GPS check-in.</span>
    </label>
  </div>
}
