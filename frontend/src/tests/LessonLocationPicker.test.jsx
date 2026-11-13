import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import LessonLocationPicker from '../components/LessonLocationPicker'
import { hasLessonPoint, lessonLocationError } from '../lib/lessonLocationInput'

const leaflet = vi.hoisted(() => {
  const handlers = {}
  const map = { setView: vi.fn().mockReturnThis(), on: vi.fn((name, fn) => { handlers[name] = fn }), remove: vi.fn(), invalidateSize: vi.fn(), getBounds: () => ({ contains: () => true }), getZoom: () => 17 }
  const marker = { addTo: vi.fn().mockReturnThis(), on: vi.fn(), remove: vi.fn(), setLatLng: vi.fn(), dragging: { enable: vi.fn(), disable: vi.fn() } }
  return { map: vi.fn(() => map), handlers, marker: vi.fn(() => marker), tileLayer: vi.fn(() => ({ on: vi.fn().mockReturnThis(), addTo: vi.fn() })), divIcon: vi.fn() }
})
vi.mock('leaflet', () => ({ default: leaflet }))

function Picker({ initial = { address: '', latitude: null, longitude: null, confirmed: false }, initialCenter }) {
  const [value, onChange] = useState(initial)
  return <LessonLocationPicker value={value} onChange={onChange} initialCenter={initialCenter} />
}
beforeEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

test('the area viewport is never a selected venue, and tiles wait for the user to open the map', async () => {
  render(<Picker initialCenter={[3.2, 101.5]} />)
  expect(leaflet.map).not.toHaveBeenCalled()
  expect(screen.getByText('No lesson pin selected yet.')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Full lesson address'), { target: { value: '12 Jalan Test, 50000 Kuala Lumpur' } })
  expect(screen.getByRole('checkbox')).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: /Open map/ }))
  await waitFor(() => expect(leaflet.map).toHaveBeenCalled())
  expect(leaflet.marker).not.toHaveBeenCalled()
  expect(screen.getByRole('checkbox')).toBeDisabled()
  act(() => leaflet.handlers.click({ latlng: { lat: 3.1412, lng: 101.6123 } }))
  await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled())
  expect(screen.getByText('Selected pin: 3.141200, 101.612300')).toBeInTheDocument()
})

test('changing either the street address or coordinates requires confirmation again', () => {
  render(<Picker initial={{ address: '12 Jalan Test, 50000 Kuala Lumpur', latitude: 3.1, longitude: 101.6, confirmed: true }} />)
  const confirmation = screen.getByRole('checkbox')
  expect(confirmation).toBeChecked()
  fireEvent.change(screen.getByLabelText('Full lesson address'), { target: { value: '13 Jalan Test, 50000 Kuala Lumpur' } })
  expect(screen.getByRole('textbox', { name: 'Full lesson address', exact: true })).toHaveValue('13 Jalan Test, 50000 Kuala Lumpur')
  expect(confirmation).not.toBeChecked()
  fireEvent.click(confirmation)
  expect(confirmation).toBeChecked()
  fireEvent.change(screen.getByLabelText('Latitude (−90 to 90)'), { target: { value: '3.12' } })
  expect(confirmation).not.toBeChecked()
  expect(screen.getByText('Selected pin: 3.120000, 101.600000')).toBeInTheDocument()
})

test('GPS is explicit, rejects an inaccurate estimate and permits a precise point after confirmation', () => {
  const getCurrentPosition = vi.fn()
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
  render(<Picker initial={{ address: '12 Jalan Test, 50000 Kuala Lumpur', latitude: null, longitude: null, confirmed: false }} />)
  expect(getCurrentPosition).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Use my current location' }))
  act(() => getCurrentPosition.mock.calls[0][0]({ coords: { latitude: 3.1, longitude: 101.6, accuracy: 250 } }))
  expect(screen.getByRole('checkbox')).toBeDisabled()
  expect(screen.getByText(/This GPS estimate has not been selected/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Use my current location' }))
  act(() => getCurrentPosition.mock.calls[1][0]({ coords: { latitude: 3.12, longitude: 101.62, accuracy: 12 } }))
  expect(screen.getByRole('checkbox')).toBeEnabled()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(leaflet.map).not.toHaveBeenCalled()
})

test('location validation rejects blank, nonnumeric and out-of-range points, including falsely confirmed areas', () => {
  expect(hasLessonPoint({ latitude: null, longitude: null })).toBe(false)
  expect(hasLessonPoint({ latitude: '3.1', longitude: '101.6' })).toBe(false)
  expect(hasLessonPoint({ latitude: 91, longitude: 181 })).toBe(false)
  expect(hasLessonPoint({ latitude: 0, longitude: 0 })).toBe(true)
  expect(lessonLocationError({ address: '12 Jalan Test', latitude: 3.1, longitude: 101.6, confirmed: false })).toMatch(/Confirm/)
  expect(lessonLocationError({ address: '12 Jalan Test', latitude: 3.1, longitude: 101.6, confirmed: true })).toBe('')
})
