import { StrictMode } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { useUnsavedWarning } from '../lib/useUnsavedWarning'

function Page({ dirty }) {
  useUnsavedWarning(dirty)
  return null
}

let pushState, back, confirm

beforeEach(() => {
  window.history.replaceState(null, '', '/tutor/availability')
  pushState = vi.spyOn(window.history, 'pushState')
  back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
  confirm = vi.spyOn(window, 'confirm')
})

// Pressing Back leaves the guard entry, so the browser is on the real entry when popstate arrives
const pressBack = () => {
  window.history.replaceState(null, '')
  window.dispatchEvent(new PopStateEvent('popstate'))
}
const settle = () => new Promise((r) => setTimeout(r, 10))

// Unmount and let the hook's clean-up finish here, so it cannot land inside the next test
afterEach(async () => {
  cleanup()
  await settle()
  vi.restoreAllMocks()
})

describe('useUnsavedWarning', () => {
  test('a clean page adds nothing to the history', () => {
    render(<Page dirty={false} />)
    expect(pushState).not.toHaveBeenCalled()
  })

  test('a dirty page pushes one guard entry and keeps the state already there', () => {
    window.history.replaceState({ key: 'abc' }, '')
    render(<Page dirty />)
    expect(pushState).toHaveBeenCalledTimes(1)
    expect(window.history.state).toEqual({ key: 'abc', unsavedGuard: true })
  })

  test('StrictMode still pushes only one guard entry and does not remove it', async () => {
    render(<StrictMode><Page dirty /></StrictMode>)
    await settle()
    expect(pushState).toHaveBeenCalledTimes(1)
    expect(back).not.toHaveBeenCalled()
  })

  test('Back then Stay pushes the guard again and does not leave', () => {
    confirm.mockReturnValue(false)
    render(<Page dirty />)
    pressBack()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(pushState).toHaveBeenCalledTimes(2)
    expect(window.history.state.unsavedGuard).toBe(true)
    expect(back).not.toHaveBeenCalled()
  })

  test('the next Back after Stay asks again', () => {
    confirm.mockReturnValue(false)
    render(<Page dirty />)
    pressBack()
    pressBack()
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  test('Back then Leave goes back once more and does not ask a second time', () => {
    confirm.mockReturnValue(true)
    render(<Page dirty />)
    pressBack()
    expect(back).toHaveBeenCalledTimes(1)
    pressBack() // the popstate caused by leaving
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  test('saving removes the guard entry without asking', async () => {
    const { rerender } = render(<Page dirty />)
    rerender(<Page dirty={false} />)
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1))
    expect(confirm).not.toHaveBeenCalled()
  })

  test('after saving, Back no longer asks', async () => {
    const { rerender } = render(<Page dirty />)
    rerender(<Page dirty={false} />)
    await settle()
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(confirm).not.toHaveBeenCalled()
  })

  test('leaving through a confirmed link does not go back', async () => {
    const { unmount } = render(<Page dirty />)
    window.history.replaceState({ key: 'next-page' }, '') // the router has moved on to the new page
    unmount()
    await settle()
    expect(back).not.toHaveBeenCalled()
  })

  test('closing the tab still asks', () => {
    render(<Page dirty />)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  test('closing the tab does not ask on a clean page', () => {
    render(<Page dirty={false} />)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
