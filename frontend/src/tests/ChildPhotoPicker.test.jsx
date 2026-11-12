import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PhotoPicker, { uploadImage } from '../components/PhotoPicker'
import api from '../api/client'
vi.mock('../api/client', () => ({ default: { post: vi.fn() }, errorMessage: (e) => e.message }))
const privateRef = 'https://res.cloudinary.com/test/image/authenticated/wondertutor/children/1/avatar.jpg'
beforeEach(() => {
  api.post.mockReset()
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:local-preview'), configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
})
afterEach(() => vi.unstubAllGlobals())

test('child upload uses authenticated settings and keeps preview separate from the canonical reference', async () => {
  api.post.mockResolvedValue({ data: { cloudName: 'test', apiKey: 'public', timestamp: 123, folder: 'wondertutor/children/1', signature: 'sig', type: 'authenticated', allowed_formats: 'jpg,jpeg,png' } })
  const request = vi.fn(async () => ({ ok: true, json: async () => ({ secure_url: privateRef.replace('/authenticated/', '/authenticated/s--abcdefgh--/') }) }))
  vi.stubGlobal('fetch', request)
  const change = vi.fn()
  const view = render(<PhotoPicker purpose="child-avatar" name="Test Child" value={null} onChange={change} />)
  fireEvent.change(view.container.querySelector('input[type=file]'), { target: { files: [new File(['image'], 'photo.jpg', { type: 'image/jpeg' })] } })
  await waitFor(() => expect(change).toHaveBeenCalledWith(privateRef))
  expect(api.post).toHaveBeenCalledWith('/uploads/signature', { purpose: 'child-avatar' })
  expect(request.mock.calls[0][1].body.get('type')).toBe('authenticated')
  expect(request.mock.calls[0][1].body.get('allowed_formats')).toBe('jpg,jpeg,png')
  expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:local-preview')
  view.unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-preview')
})

test('adult/review default uploads retain public behavior', async () => {
  const url = 'https://res.cloudinary.com/test/image/upload/adult.jpg'
  api.post.mockResolvedValue({ data: { cloudName: 'test', apiKey: 'public', timestamp: 123, folder: 'wondertutor/parents', signature: 'sig' } })
  const request = vi.fn(async () => ({ ok: true, json: async () => ({ secure_url: url }) }))
  vi.stubGlobal('fetch', request)
  expect(await uploadImage(new File(['image'], 'adult.jpg', { type: 'image/jpeg' }))).toBe(url)
  expect(api.post).toHaveBeenCalledWith('/uploads/signature')
  expect(request.mock.calls[0][1].body.has('type')).toBe(false)
})

test('existing private preview is displayed without treating its signed URL as the stored value', () => {
  const change = vi.fn()
  const view = render(<PhotoPicker purpose="child-avatar" name="Test Child" value={privateRef} previewValue="https://api.cloudinary.com/private-download" onChange={change} />)
  expect(view.container.querySelector('img')).toHaveAttribute('src', 'https://api.cloudinary.com/private-download')
  fireEvent.click(screen.getByRole('button', { name: 'Remove', exact: true }))
  expect(change).toHaveBeenCalledWith(null)
})
