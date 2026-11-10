import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { MatchingProvider, useMatching } from '../assistant/MatchingContext'

const state = vi.hoisted(() => ({ user: { id: 1, role: 'PARENT' } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }))
vi.mock('../api/client', () => ({
  default: { get: vi.fn(async (url) => ({ data: url.includes('children') ? { children: [] } : { preferences: {} } })) },
  errorMessage: () => 'Failed',
}))

function Probe() {
  const { result, criteria, setResult, patchCriteria } = useMatching()
  return <><span>{result?.privateMarker || 'No prior results'}</span><span>{criteria.subject || 'No subject'}</span>
    <button onClick={() => { setResult({ privateMarker: 'First family search' }); patchCriteria({ subject: 'Mathematics' }) }}>Search</button></>
}

test('switching parent accounts clears temporary AI results and search criteria', async () => {
  const tree = () => <MatchingProvider><Probe /></MatchingProvider>
  const view = render(tree())
  fireEvent.click(screen.getByText('Search'))
  expect(screen.getByText('First family search')).toBeInTheDocument()
  state.user = { id: 2, role: 'PARENT' }
  view.rerender(tree())
  await waitFor(() => expect(screen.getByText('No prior results')).toBeInTheDocument())
  expect(screen.getByText('No subject')).toBeInTheDocument()
  expect(screen.queryByText('First family search')).not.toBeInTheDocument()
})
