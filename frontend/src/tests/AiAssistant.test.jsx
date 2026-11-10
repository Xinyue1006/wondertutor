// AI Assistant mode in the Book Robot panel: privacy notice, plain-text rendering of server references, child choices,
// guided fallback, cancel/late-reply handling, and temporary results. The backend is mocked.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'

let currentUser = { id: 1, role: 'PARENT', fullName: 'Tan Xin Yue' }
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: currentUser }) }))
vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  errorMessage: (e) => e?.response?.data?.message || e.message,
}))

import api from '../api/client'
import { MatchingProvider, useMatching } from '../assistant/MatchingContext'
import AssistantWidget from '../assistant/AssistantWidget'

const catalog = { subjects: ['Mathematics'], locations: [], characteristics: [], homeLocation: null }

function ResultsPage() {
  const { result } = useMatching()
  return <div>RESULTS {result?.temporary ? 'TEMPORARY' : ''} {result?.total}</div>
}

function setup({ enabled = true } = {}) {
  api.get.mockImplementation((url) => {
    if (url.includes('assistant/capabilities')) return Promise.resolve({ data: { enabled, modes: enabled ? ['ai', 'guided'] : ['guided'] } })
    if (url.includes('catalog')) return Promise.resolve({ data: catalog })
    return Promise.resolve({ data: { children: [] } })
  })
  api.delete.mockResolvedValue({ data: { ok: true } })
  return render(
    <MemoryRouter initialEntries={['/parent']}>
      <MatchingProvider>
        <Routes>
          <Route path="/parent" element={<AssistantWidget />} />
          <Route path="/parent/find-tutor/results" element={<ResultsPage />} />
        </Routes>
      </MatchingProvider>
    </MemoryRouter>,
  )
}

async function openPanel() {
  await userEvent.click(screen.getByRole('button', { name: /Open AI Tutor Assistant/ }))
  return screen.findByRole('complementary', { name: 'AI Tutor Assistant' })
}

const reply = (over = {}) => ({ data: { conversationId: 'conv_abcdefghijklmnop', messageId: 'm1', status: 'answer', text: 'ok', entities: {}, cards: [], sources: [], criteria: null, matchResult: null, asOf: new Date().toISOString(), ...over } })

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  currentUser = { id: 1, role: 'PARENT', fullName: 'Tan Xin Yue' }
})

test('a privacy notice comes before the first AI message, with a guided alternative', async () => {
  setup()
  const panel = await openPanel()
  expect(await within(panel).findByText(/sent to an external AI service/i)).toBeInTheDocument()
  expect(within(panel).queryByLabelText('Question for the AI assistant')).not.toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: /Use Guided Tutor Search instead/ }))
  expect(within(panel).getByRole('tab', { name: 'Guided Tutor Search' })).toHaveAttribute('aria-selected', 'true')
})

test('answers render server names for references as plain text, never HTML', async () => {
  setup()
  api.post.mockResolvedValueOnce(reply({ text: "[[child_1]]'s lesson <img src=x onerror=alert(1)> with [[tutor_9]]", entities: { child_1: 'Sarah' }, sources: [{ id: 'booking:booking_1', kind: 'booking', label: 'Booking', link: '/parent/bookings' }] }))
  const panel = await openPanel()
  await userEvent.click(await within(panel).findByRole('button', { name: /I understand/ }))
  await userEvent.type(within(panel).getByLabelText('Question for the AI assistant'), 'next lesson?{enter}')
  expect(await within(panel).findByText('Sarah')).toBeInTheDocument()
  expect(within(panel).getByText(/<img src=x/)).toBeInTheDocument() // shown as text
  expect(panel.querySelector('img[src="x"]')).toBeNull()
  expect(within(panel).getByText(/this record/)).toBeInTheDocument() // unresolved reference is not given a name
  expect(within(panel).getByText(/AI-generated answer/)).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledWith('/parent/assistant/messages', { message: 'next lesson?' }, expect.anything())
})

test('child choices send an explicit selection in the same conversation', async () => {
  setup()
  localStorage.setItem('wt-ai-notice-v1:1', '1')
  api.post
    .mockResolvedValueOnce(reply({ status: 'clarification', text: 'Which child do you mean?', cards: [{ type: 'child_choices', title: 'Which child?', choices: [{ ref: 'child_1', name: 'Mia', label: 'Mia (Primary 2)' }, { ref: 'child_2', name: 'Mia', label: 'Mia (Primary 2) #2' }] }] }))
    .mockResolvedValueOnce(reply({ text: 'No completed lessons yet.' }))
  const panel = await openPanel()
  await userEvent.type(await within(panel).findByLabelText('Question for the AI assistant'), 'How is Mia?{enter}')
  await userEvent.click(await within(panel).findByRole('button', { name: 'Mia (Primary 2) #2' }))
  await within(panel).findByText('No completed lessons yet.')
  expect(api.post).toHaveBeenLastCalledWith('/parent/assistant/messages', { conversationId: 'conv_abcdefghijklmnop', message: 'For Mia', selection: { kind: 'child', ref: 'child_2' } }, expect.anything())
})

test('when the AI is off the panel offers Guided Tutor Search', async () => {
  setup({ enabled: false })
  const panel = await openPanel()
  expect(await within(panel).findByRole('tab', { name: 'Guided Tutor Search' })).toHaveAttribute('aria-selected', 'true')
  await userEvent.click(within(panel).getByRole('tab', { name: 'AI Assistant' }))
  expect(within(panel).getByText(/not available right now/i)).toBeInTheDocument()
})

test('an unavailable reply shows the reason and a retry; clearing drops a late reply', async () => {
  setup()
  localStorage.setItem('wt-ai-notice-v1:1', '1')
  api.post.mockRejectedValueOnce({ response: { status: 503, data: { status: 'unavailable', message: 'The AI assistant is not available right now. Guided Tutor Search still works.' } } })
  const panel = await openPanel()
  await userEvent.type(await within(panel).findByLabelText('Question for the AI assistant'), 'hello{enter}')
  expect(await within(panel).findByRole('alert')).toHaveTextContent(/not available/)
  expect(within(panel).getByRole('button', { name: 'Retry' })).toBeInTheDocument()

  let resolveLate
  api.post.mockImplementationOnce(() => new Promise((r) => { resolveLate = r }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Retry' }))
  expect(await within(panel).findByText(/Looking that up/)).toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'Clear chat' }))
  await act(async () => resolveLate(reply({ text: 'LATE ANSWER' })))
  expect(within(panel).queryByText('LATE ANSWER')).not.toBeInTheDocument()
})

test('AI tutor results open the results page as temporary (unsaved) results', async () => {
  setup()
  localStorage.setItem('wt-ai-notice-v1:1', '1')
  const tutor = { id: 5, ref: 'tutor_1', name: 'Daniel Tan', photoUrl: null, verified: true, score: 91, label: 'Highly suitable', reasons: ['Mathematics specialist'], hourlyRate: 55, rating: 4.8, reviewCount: 3, offersOnline: true, offersPhysical: true, location: 'Kepong', link: '/parent/tutors/5' }
  api.post.mockResolvedValueOnce(reply({
    text: 'I found 1 tutor.',
    cards: [{ type: 'tutor_results', searchRef: 'search_1', total: 1, link: '/parent/find-tutor/results', temporary: true, criteriaSummary: ['Mathematics', 'Primary 5'], tutors: [tutor] }],
    matchResult: { temporary: true, total: 1, criteria: { subject: 'Mathematics', level: 'PRIMARY', grade: 5, days: [], mode: 'EITHER', gender: 'ANY', characteristics: [] }, tutors: [] },
  }))
  const panel = await openPanel()
  await userEvent.type(await within(panel).findByLabelText('Question for the AI assistant'), 'maths tutor{enter}')
  expect(await within(panel).findByText('91% match')).toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: /See all results/ }))
  expect(await screen.findByText(/RESULTS TEMPORARY 1/)).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1) // no saved matching request was made
})

test('switching account starts an empty chat', async () => {
  const view = setup()
  localStorage.setItem('wt-ai-notice-v1:1', '1')
  api.post.mockResolvedValueOnce(reply({ text: 'Account one answer' }))
  const panel = await openPanel()
  await userEvent.type(await within(panel).findByLabelText('Question for the AI assistant'), 'hi{enter}')
  await within(panel).findByText('Account one answer')
  currentUser = { id: 2, role: 'PARENT', fullName: 'Someone Else' }
  view.rerender(
    <MemoryRouter initialEntries={['/parent']}>
      <MatchingProvider><Routes><Route path="/parent" element={<AssistantWidget />} /></Routes></MatchingProvider>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.queryByText('Account one answer')).not.toBeInTheDocument())
})

// ───────────── request identity: cancelled / replaced requests cannot touch the screen ─────────────
function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
async function ready() {
  setup()
  localStorage.setItem('wt-ai-notice-v1:1', '1')
  const panel = await openPanel()
  const box = await within(panel).findByLabelText('Question for the AI assistant')
  return { panel, box }
}

test('cancel A, start B, then A finishes: B stays busy and only B\'s answer appears', async () => {
  const A = deferred()
  const B = deferred()
  api.post.mockImplementationOnce(() => A.promise).mockImplementationOnce(() => B.promise)
  const { panel, box } = await ready()
  await userEvent.type(box, 'question A{enter}')
  expect(await within(panel).findByText(/Looking that up/)).toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'Cancel' }))
  expect(within(panel).queryByText(/Looking that up/)).not.toBeInTheDocument()

  await userEvent.type(box, 'question B{enter}')
  expect(await within(panel).findByText(/Looking that up/)).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(2)

  await act(async () => A.resolve(reply({ text: 'ANSWER FOR A', conversationId: 'conv_AAAAAAAAAAAAAAAA' }))) // late
  expect(within(panel).queryByText('ANSWER FOR A')).not.toBeInTheDocument()
  expect(within(panel).getByText(/Looking that up/)).toBeInTheDocument() // A's completion did not clear B's busy state
  expect(box).toBeDisabled() // a third question cannot be sent while B runs

  await act(async () => B.resolve(reply({ text: 'ANSWER FOR B' })))
  expect(await within(panel).findByText('ANSWER FOR B')).toBeInTheDocument()
  expect(within(panel).queryByText(/Looking that up/)).not.toBeInTheDocument()
  // B's reply, not A's, decides which conversation continues
  api.post.mockResolvedValueOnce(reply({ text: 'next' }))
  await userEvent.type(box, 'again{enter}')
  await within(panel).findByText('next')
  expect(api.post).toHaveBeenLastCalledWith('/parent/assistant/messages', expect.objectContaining({ conversationId: 'conv_abcdefghijklmnop' }), expect.anything())
})

test('an error from a cancelled request is ignored and does not end the current request\'s busy state', async () => {
  const A = deferred()
  const B = deferred()
  api.post.mockImplementationOnce(() => A.promise).mockImplementationOnce(() => B.promise)
  const { panel, box } = await ready()
  await userEvent.type(box, 'question A{enter}')
  await userEvent.click(await within(panel).findByRole('button', { name: 'Cancel' }))
  await userEvent.type(box, 'question B{enter}')
  await within(panel).findByText(/Looking that up/)
  await act(async () => A.reject({ response: { status: 503, data: { message: 'A FAILED' } } }))
  expect(within(panel).queryByText('A FAILED')).not.toBeInTheDocument()
  expect(within(panel).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  expect(within(panel).getByText(/Looking that up/)).toBeInTheDocument()
  await act(async () => B.resolve(reply({ text: 'ANSWER FOR B' })))
  await within(panel).findByText('ANSWER FOR B')
})

test('clearing the chat invalidates the running request; a new question afterwards is unaffected by the old one', async () => {
  const A = deferred()
  const B = deferred()
  api.post.mockImplementationOnce(() => A.promise).mockImplementationOnce(() => B.promise)
  const { panel, box } = await ready()
  await userEvent.type(box, 'question A{enter}')
  await within(panel).findByText(/Looking that up/)
  await userEvent.click(within(panel).getByRole('button', { name: 'Clear chat' }))
  await userEvent.type(box, 'question B{enter}')
  await within(panel).findByText(/Looking that up/)
  await act(async () => A.resolve(reply({ text: 'ANSWER FOR A' })))
  expect(within(panel).queryByText('ANSWER FOR A')).not.toBeInTheDocument()
  expect(within(panel).getByText(/Looking that up/)).toBeInTheDocument()
  await act(async () => B.resolve(reply({ text: 'ANSWER FOR B' })))
  await within(panel).findByText('ANSWER FOR B')
})

test('a "busy" conflict keeps the conversation and offers a retry', async () => {
  const { panel, box } = await ready()
  api.post.mockResolvedValueOnce(reply({ text: 'first' }))
  await userEvent.type(box, 'one{enter}')
  await within(panel).findByText('first')
  api.post.mockRejectedValueOnce({ response: { status: 409, data: { status: 'busy', retryable: true, message: 'The previous question in this chat is still being answered.' } } })
  await userEvent.type(box, 'two{enter}')
  expect(await within(panel).findByRole('alert')).toHaveTextContent(/still being answered/)
  api.post.mockResolvedValueOnce(reply({ text: 'second' }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Retry' }))
  await within(panel).findByText('second')
  expect(api.post).toHaveBeenLastCalledWith('/parent/assistant/messages', { conversationId: 'conv_abcdefghijklmnop', message: 'two' }, expect.anything()) // same chat kept
})

test('the authorised tutor name is shown from the server\'s entity map while the text itself only carries references', async () => {
  const { panel, box } = await ready()
  api.post.mockResolvedValueOnce(reply({ text: '[[tutor_1]] is ranked 1 of 3 with a 91% compatibility score.', entities: { tutor_1: 'Quentin Okonkwo-Vasquez' } }))
  await userEvent.type(box, 'why is the first tutor on top?{enter}')
  expect(await within(panel).findByText('Quentin Okonkwo-Vasquez')).toBeInTheDocument()
  expect(within(panel).getByText(/is ranked 1 of 3/)).toBeInTheDocument()
})
