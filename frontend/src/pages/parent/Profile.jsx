import { useEffect, useState } from 'react'
import api, { errorMessage } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useMatching } from '../../assistant/MatchingContext'
import PhotoPicker from '../../components/PhotoPicker'
import PreferencesFields from '../../components/PreferencesFields'
import { fromApiPreferences, toApiPreferences } from '../../lib/preferences'
import Icon from '../../components/ui/Icon'
import { ErrorBox, PageTitle, Spinner } from '../../components/ui/Common'
import { checkName, checkPassword, checkPhone, checkText, normalizePhone } from '../../lib/validation'

// My Profile: edit contact details + address (used for tutor distance), change password
export default function Profile() {
  const { user, setUser } = useAuth()
  const { catalog } = useMatching()
  const [form, setForm] = useState(null)
  const [prefs, setPrefs] = useState(null)
  const [prefMsg, setPrefMsg] = useState('')
  const [prefError, setPrefError] = useState('')
  const [prefBusy, setPrefBusy] = useState(false)
  const [hasPassword, setHasPassword] = useState(true)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [pwMsg, setPwMsg] = useState('')
  const [pwError, setPwError] = useState('')

  useEffect(() => {
    api.get('/parent/profile').then((r) => {
      const p = r.data.profile
      setForm({ fullName: p.fullName, phone: p.phone || '', address: p.address || '', profilePhotoUrl: p.profilePhotoUrl })
      setHasPassword(p.hasPassword)
      setPrefs(fromApiPreferences(p.preferences))
    })
  }, [])

  if (!form || !prefs) return <Spinner />

  async function save(e) {
    e.preventDefault()
    setMsg(''); setError('')
    const problem = checkName(form.fullName) || checkPhone(form.phone) || checkText(form.address, { label: 'Address', max: 200 })
    if (problem) return setError(problem)
    setBusy(true)
    try {
      const r = await api.put('/parent/profile', { ...form, phone: normalizePhone(form.phone) })
      setUser({ ...user, fullName: r.data.profile.fullName, phone: r.data.profile.phone, profilePhotoUrl: r.data.profile.profilePhotoUrl })
      setMsg('Profile saved.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  // Preferences are saved with the same endpoint; nothing chosen clears them
  async function savePrefs(e) {
    e.preventDefault()
    setPrefMsg(''); setPrefError(''); setPrefBusy(true)
    try {
      await api.put('/parent/profile', { ...form, preferences: toApiPreferences(prefs) })
      setPrefMsg('Preferences saved. Your next search will start from these.')
    } catch (err) {
      setPrefError(errorMessage(err))
    } finally {
      setPrefBusy(false)
    }
  }

  async function changePw(e) {
    e.preventDefault()
    setPwMsg(''); setPwError('')
    if (!pw.currentPassword) return setPwError('Enter your current password')
    const weak = checkPassword(pw.newPassword)
    if (weak) return setPwError(weak)
    if (pw.newPassword !== pw.confirm) return setPwError('New passwords do not match')
    if (pw.newPassword === pw.currentPassword) return setPwError('Choose a password different from the current one')
    try {
      await api.post('/parent/profile/password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword })
      setPw({ currentPassword: '', newPassword: '', confirm: '' })
      setPwMsg('Password updated.')
    } catch (err) {
      setPwError(errorMessage(err))
    }
  }

  return (
    <div>
      <PageTitle icon="user" title="My Profile" subtitle="Keep your details up to date so tutors and our team can reach you." />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <form onSubmit={save} className="card space-y-4 p-6">
          <PhotoPicker value={form.profilePhotoUrl} name={user.fullName} onChange={(url) => setForm({ ...form, profilePhotoUrl: url })} />
          <div className="text-sm text-slate-500">{user.email}</div>
          <ErrorBox>{error}</ErrorBox>
          {msg && <div className="rounded-lg bg-ok-50 px-3 py-2.5 text-sm text-ok">{msg}</div>}
          <label className="block"><span className="mb-1.5 block text-sm font-bold text-navy">Full Name</span>
            <input className="input h-11" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></label>
          <label className="block"><span className="mb-1.5 block text-sm font-bold text-navy">Email Address</span>
            <input className="input h-11 bg-slate-50" value={user.email} disabled />
            <span className="mt-1 block text-xs text-slate-500">Your email is your login, so it can't be changed here.</span></label>
          <label className="block"><span className="mb-1.5 block text-sm font-bold text-navy">Phone Number</span>
            <input className="input h-11" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label className="block"><span className="mb-1.5 block text-sm font-bold text-navy">Address / Area</span>
            <div className="relative"><Icon name="pin" className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-navy" />
              <input list="profile-areas" className="input h-11 pl-10" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="e.g. Kepong, Kuala Lumpur" />
              <datalist id="profile-areas">{(catalog?.locations || []).map((l) => <option key={l} value={l} />)}</datalist></div>
            <span className="mt-1 block text-xs text-slate-500">Pick an area from the list so we can measure how far tutors are from you.</span></label>
          <button disabled={busy} className="btn-primary h-11 w-full">{busy ? 'Saving…' : 'Save Changes'}</button>
        </form>

        <form onSubmit={changePw} className="card space-y-4 p-6">
          <h2 className="flex items-center gap-2 text-xl font-extrabold text-navy"><Icon name="lock" className="h-5 w-5 text-brand-500" /> Change Password</h2>
          {!hasPassword ? <p className="text-sm text-slate-500">This account signs in with Google, so there is no password to change.</p> : (
            <>
              <ErrorBox>{pwError}</ErrorBox>
              {pwMsg && <div className="rounded-lg bg-ok-50 px-3 py-2.5 text-sm text-ok">{pwMsg}</div>}
              {[['currentPassword', 'Current Password'], ['newPassword', 'New Password'], ['confirm', 'Confirm New Password']].map(([k, l]) => (
                <label key={k} className="block"><span className="mb-1.5 block text-sm font-bold text-navy">{l}</span>
                  <input type="password" className="input h-11" value={pw[k]} onChange={(e) => setPw({ ...pw, [k]: e.target.value })} autoComplete={k === 'currentPassword' ? 'current-password' : 'new-password'} /></label>
              ))}
              <p className="text-xs text-slate-500">At least 8 characters with a letter and a number.</p>
              <button className="btn-outline h-11 w-full">Update Password</button>
            </>
          )}
        </form>
      </div>

      <form onSubmit={savePrefs} className="card mt-6 space-y-4 p-6">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-extrabold text-navy"><Icon name="sliders" className="h-5 w-5 text-brand-500" /> Tutor Preferences</h2>
          <p className="mt-1 text-sm text-slate-600">Optional. These rank tutors for you and pre-fill the matching wizard. They never hide tutors from you.</p>
        </div>
        <ErrorBox>{prefError}</ErrorBox>
        {prefMsg && <div role="status" className="rounded-lg bg-ok-50 px-3 py-2.5 text-sm text-ok">{prefMsg}</div>}
        <PreferencesFields value={prefs} onChange={setPrefs} />
        <button disabled={prefBusy} className="btn-primary h-11 w-full sm:w-56">{prefBusy ? 'Saving…' : 'Save Preferences'}</button>
      </form>
    </div>
  )
}
