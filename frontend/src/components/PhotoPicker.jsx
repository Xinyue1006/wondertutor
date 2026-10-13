import { useRef, useState } from 'react'
import api, { errorMessage } from '../api/client'
import Avatar from './ui/Avatar'
import Icon from './ui/Icon'

// Uploads an image straight to Cloudinary using a one-time signature from our backend.
export async function uploadImage(file) {
  const { data: sig } = await api.post('/uploads/signature')
  const form = new FormData()
  form.append('file', file)
  form.append('api_key', sig.apiKey)
  form.append('timestamp', sig.timestamp)
  form.append('folder', sig.folder)
  form.append('signature', sig.signature)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, { method: 'POST', body: form })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error?.message || 'Upload failed')
  return json.secure_url
}

// Checks the chosen file, uploads it and reports the hosted URL. Shared by every photo control.
export async function pickImage(e, { setBusy, setError, onChange }) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  if (!['image/jpeg', 'image/png'].includes(file.type)) return setError('Please choose a JPG or PNG image.')
  if (file.size > 5 * 1024 * 1024) return setError('The image must be 5MB or smaller.')
  setError('')
  setBusy(true)
  try {
    onChange(await uploadImage(file))
  } catch (err) {
    setError(err?.response?.status === 501 ? 'Photo upload is not set up yet (Cloudinary keys missing).' : err?.response ? errorMessage(err) : err.message)
  } finally {
    setBusy(false)
  }
}

// Photo box used on My Profile and the child form. `onChange(url)` gets the hosted image URL.
export default function PhotoPicker({ value, name, onChange, rounded = 'rounded-full' }) {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const pick = (e) => pickImage(e, { setBusy, setError, onChange })

  return (
    <div className="flex items-center gap-4">
      <Avatar src={value} name={name} className="h-20 w-20" rounded={rounded} text="text-2xl" />
      <div>
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="btn-outline px-4 py-1.5 text-xs">
          <Icon name="camera" className="h-4 w-4" /> {busy ? 'Uploading…' : value ? 'Change photo' : 'Upload photo'}
        </button>
        {value && !busy && <button type="button" onClick={() => onChange(null)} className="ml-3 text-xs font-semibold text-red-500 hover:underline">Remove</button>}
        <div className="mt-1 text-xs text-slate-500">JPG or PNG, up to 5MB</div>
        {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg" className="hidden" onChange={pick} />
    </div>
  )
}
