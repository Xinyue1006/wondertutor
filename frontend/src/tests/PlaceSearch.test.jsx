import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

vi.mock('../api/client', () => ({ default: { get: vi.fn() }, errorMessage: (e) => e.message }))
import api from '../api/client'
import PlaceSearch from '../components/PlaceSearch'

const POPULAR = [
  { label: 'Kepong, Kuala Lumpur', kind: 'area', state: 'Kuala Lumpur' },
  { label: 'Shah Alam, Selangor', kind: 'town', state: 'Selangor' },
]
const KOTA = [
  { label: 'Kota Kinabalu, Sabah', kind: 'town', state: 'Sabah' },
  { label: '88000 Kota Kinabalu, Sabah', kind: 'postcode', state: 'Sabah' },
]

// Answers like the server: nothing typed -> the popular places; something typed -> matches
function serve({ known = [] } = {}) {
  api.get.mockImplementation(async (_url, { params }) => {
    const q = (params?.q || '').toLowerCase()
    if (!q) return { data: { popular: true, results: POPULAR } }
    if (known.includes(params.q)) return { data: { popular: false, results: [{ label: params.q, kind: 'town', state: 'Sabah' }] } }
    if (q.startsWith('kota')) return { data: { popular: false, results: KOTA } }
    return { data: { popular: false, results: [] } }
  })
}

// A tiny form: keeps the value and shows what would be saved
function Harness({ initial = '', props = {} }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <PlaceSearch value={value} onChange={setValue} {...props} />
      <output data-testid="saved">{value}</output>
    </>
  )
}
const saved = () => screen.getByTestId('saved').textContent

beforeEach(() => vi.clearAllMocks())

describe('place picker', () => {
  test('shows the popular places as soon as it is clicked', async () => {
    serve()
    render(<Harness />)
    await userEvent.click(screen.getByRole('combobox'))
    expect(await screen.findByText('Popular places')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Kepong, Kuala Lumpur/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Shah Alam, Selangor/ })).toBeInTheDocument()
  })

  test('narrows as you type, anywhere in Malaysia, and picking one saves its label', async () => {
    serve()
    render(<Harness />)
    await userEvent.type(screen.getByRole('combobox'), 'kota')
    expect(await screen.findByRole('option', { name: /88000 Kota Kinabalu, Sabah/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: /^Kota Kinabalu, Sabah/ }))
    expect(saved()).toBe('Kota Kinabalu, Sabah')
    expect(screen.getByRole('combobox')).toHaveValue('Kota Kinabalu, Sabah')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  test('works with the keyboard: arrows move, Enter picks, and Enter never submits the form', async () => {
    serve()
    const submit = vi.fn((e) => e.preventDefault())
    render(<form onSubmit={submit}><Harness /></form>)
    await userEvent.type(screen.getByRole('combobox'), 'kota')
    await screen.findByRole('option', { name: /88000/ })
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(saved()).toBe('88000 Kota Kinabalu, Sabah')
    expect(submit).not.toHaveBeenCalled()
  })

  test('text that was only typed is not saved; the saved place comes back when you leave', async () => {
    serve()
    render(<Harness initial="Kepong, Kuala Lumpur" props={{}} />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    const box = screen.getByRole('combobox')
    await userEvent.clear(box)
    await userEvent.type(box, 'kota')
    await userEvent.tab()
    expect(saved()).toBe('Kepong, Kuala Lumpur')
    expect(box).toHaveValue('Kepong, Kuala Lumpur')
  })

  test('a place that is not in the data can still be used, with a clear warning', async () => {
    serve()
    render(<Harness />)
    await userEvent.type(screen.getByRole('combobox'), 'Taman Melawati')
    await userEvent.click(await screen.findByRole('option', { name: /My place is not listed: use “Taman Melawati”/ }))
    expect(saved()).toBe('Taman Melawati')
    expect(screen.getByText(/cannot place “Taman Melawati” on the map/)).toBeInTheDocument()
  })

  test('a saved place that is not on the map is warned about, a known one is not', async () => {
    serve({ known: ['Kota Kinabalu, Sabah'] })
    const { unmount } = render(<Harness initial="Kota Kinabalu, Sabah" />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(screen.queryByText(/cannot place/)).not.toBeInTheDocument()
    unmount()
    serve()
    render(<Harness initial="Taman Melawati" />)
    expect(await screen.findByText(/cannot place “Taman Melawati” on the map/)).toBeInTheDocument()
  })

  test('the clear button empties it, and an error is shown under the box', async () => {
    serve()
    render(<Harness initial="Kota Kinabalu, Sabah" props={{ error: 'Something is wrong' }} />)
    expect(screen.getByText('Something is wrong')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Clear home area/ }))
    expect(saved()).toBe('')
  })

  test('says so when nothing matches, and when the places cannot be loaded', async () => {
    serve()
    render(<Harness />)
    await userEvent.type(screen.getByRole('combobox'), 'zzzz')
    expect(await screen.findByText(/No place matches “zzzz”/)).toBeInTheDocument()
    api.get.mockRejectedValue(new Error('offline'))
    await userEvent.clear(screen.getByRole('combobox'))
    await userEvent.type(screen.getByRole('combobox'), 'abc')
    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument()
  })

  test('can be switched off (online lessons need no place)', () => {
    serve()
    render(<Harness props={{ disabled: true }} />)
    expect(screen.getByRole('combobox')).toBeDisabled()
  })
})
