import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useMatching } from '../../assistant/MatchingContext'
import PrivacyAccountCard from '../../components/PrivacyAccountCard'
import PhotoPicker from '../../components/PhotoPicker'
import PhoneInput from '../../components/PhoneInput'
import PlaceSearch from '../../components/PlaceSearch'
import PasswordHint from '../../components/PasswordHint'
import ChangeEmail from '../../components/ChangeEmail'
import PreferencesFields from '../../components/PreferencesFields'
import { fromApiPreferences, isEmptyPreferences, toApiPreferences } from '../../lib/preferences'
import Icon from '../../components/ui/Icon'
import { ErrorBox, LoadError, PageTitle, Spinner } from '../../components/ui/Common'
import { checkName, checkPassword, checkPhone, checkText, normalizePhone } from '../../lib/validation'

// My Profile. One topic per tab, so each screen is short and has one clear "Save":
//   Personal details · Tutor preferences · Password · Privacy & account
// The summary on the left shows who you are and what is still missing. All edits live in this page's state, so
// switching tabs never loses what was typed.
const TABS = [
  ['details', 'Personal details', 'user'],
  ['preferences', 'Tutor preferences', 'sliders'],
  ['security', 'Password & email', 'lock'],
  ['privacy', 'Privacy & account', 'shield'],
]

const sameNumber = (a, b) => (normalizePhone(a) ?? a ?? '') === (normalizePhone(b) ?? b ?? '')

// A label, the control, an optional hint, and the error right under the control it belongs to
function Field({ id, label, hint, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-bold text-navy">{label}</label>
      {children}
      {error
        ? <p id={`${id}-error`} className="mt-1 flex items-center gap-1.5 text-sm font-medium text-red-700"><Icon name="info" className="h-4 w-4 shrink-0" /> {error}</p>
        : hint && <p id={`${id}-hint`} className="mt-1 text-xs text-slate-600">{hint}</p>}
    </div>
  )
}

const Saved = ({ children }) => (
  <p role="status" className="flex items-center gap-2 rounded-lg bg-ok-50 px-3 py-2.5 text-sm font-medium text-green-800">
    <Icon name="check-circle" className="h-4 w-4 shrink-0" /> {children}
  </p>
)

export default function Profile() {
  const { user, setUser } = useAuth()
  const { catalog, kids, loadError: listsError, reloadShared } = useMatching()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'details'

  const [profile, setProfile] = useState(null) // what is saved on the server
  const [form, setForm] = useState(null) // name, phone, area: what is being edited
  const [prefs, setPrefs] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [prefMsg, setPrefMsg] = useState('')
  const [prefError, setPrefError] = useState('')
  const [prefBusy, setPrefBusy] = useState(false)
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [showPw, setShowPw] = useState(false)
  const [pwMsg, setPwMsg] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const formRef = useRef(null)

  const load = () => {
    setLoadError('')
    api.get('/parent/profile').then((r) => {
      const p = r.data.profile
      setProfile(p)
      setForm({ fullName: p.fullName, phone: p.phone || '', address: p.address || '' })
      setPrefs(fromApiPreferences(p.preferences))
    }).catch((e) => setLoadError(errorMessage(e)))
  }
  useEffect(() => { load() }, [])

  // The area list is needed before the area picker is drawn, so a saved area is not mistaken for "not listed"
  if (!profile || !form || !prefs || !catalog) {
    if (loadError) return <LoadError message={loadError} onRetry={load} />
    if (listsError && !catalog) return <LoadError message={listsError} onRetry={reloadShared} />
    return <Spinner />
  }

  const dirty = form.fullName !== profile.fullName || !sameNumber(form.phone, profile.phone) || form.address !== (profile.address || '')
  const goTab = (id) => setParams(id === 'details' ? {} : { tab: id }, { replace: true })

  // The photo is saved on its own as soon as it is uploaded or removed (not with the form), so a refresh cannot lose it
  async function savePhoto(url) {
    setPhotoError('')
    const previous = profile.profilePhotoUrl
    setProfile((p) => ({ ...p, profilePhotoUrl: url }))
    try {
      await api.put('/parent/profile/photo', { profilePhotoUrl: url })
      setUser((u) => ({ ...u, profilePhotoUrl: url }))
    } catch (err) {
      setProfile((p) => ({ ...p, profilePhotoUrl: previous }))
      setPhotoError(errorMessage(err))
    }
  }

  async function saveDetails(e) {
    e.preventDefault()
    setMsg(''); setError('')
    // Each problem is shown next to its own field
    const found = {
      fullName: checkName(form.fullName),
      phone: checkPhone(form.phone),
      address: checkText(form.address, { label: 'Your area', max: 200 }),
    }
    setFieldErrors(found)
    const first = ['fullName', 'phone', 'address'].find((k) => found[k])
    if (first) return formRef.current?.querySelector(`[data-field="${first}"]`)?.focus()
    setBusy(true)
    try {
      const r = await api.put('/parent/profile', { fullName: form.fullName, phone: normalizePhone(form.phone), address: form.address })
      const p = r.data.profile
      setProfile((old) => ({ ...old, ...p }))
      setForm({ fullName: p.fullName, phone: p.phone || '', address: p.address || '' })
      setUser((u) => ({ ...u, fullName: p.fullName, phone: p.phone }))
      setMsg('Your details were saved.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  // Preferences are saved with the same endpoint; nothing chosen clears them. The saved name, phone and area are sent
  // (not whatever is half-typed on the other tab).
  async function savePrefs(e) {
    e.preventDefault()
    setPrefMsg(''); setPrefError(''); setPrefBusy(true)
    try {
      const r = await api.put('/parent/profile', { fullName: profile.fullName, ...(profile.phone && { phone: profile.phone }), address: profile.address || '', preferences: toApiPreferences(prefs) })
      setProfile((old) => ({ ...old, ...r.data.profile }))
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
    if (pw.newPassword !== pw.confirm) return setPwError('The new passwords do not match')
    if (pw.newPassword === pw.currentPassword) return setPwError('Choose a password different from the current one')
    setPwBusy(true)
    try {
      await api.post('/parent/profile/password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword })
      setPw({ currentPassword: '', newPassword: '', confirm: '' })
      setPwMsg('Your password was changed.')
    } catch (err) {
      setPwError(errorMessage(err))
    } finally {
      setPwBusy(false)
    }
  }

  // What would make the profile more useful, in the order a new parent should do it
  const steps = [
    { done: Boolean(profile.phone), label: 'Add your phone number', go: () => goTab('details') },
    { done: Boolean(profile.addressKnown), label: 'Choose your home area', go: () => goTab('details') },
    { done: kids.length > 0, label: 'Add a child', to: '/parent/children?add=1' },
    { done: !isEmptyPreferences(fromApiPreferences(profile.preferences)), label: 'Set your tutor preferences', go: () => goTab('preferences') },
  ]
  const doneCount = steps.filter((s) => s.done).length
  const since = profile.memberSince ? new Date(profile.memberSince).toLocaleDateString('en-MY', { month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' }) : null

  function onTabKey(e) {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    if (!(e.key in keys) && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const at = TABS.findIndex(([id]) => id === tab)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (at + keys[e.key] + TABS.length) % TABS.length
    goTab(TABS[next][0])
    document.getElementById(`tab-${TABS[next][0]}`)?.focus()
  }

  return (
    <div>
      <PageTitle icon="user" title="My Profile" subtitle="Your details, your tutor preferences, and your account settings." />

      <div className="grid items-start gap-6 lg:grid-cols-[19rem_1fr]">
        {/* ── left: who you are, what is missing, and the tabs ── */}
        <aside className="space-y-4 lg:sticky lg:top-[84px]">
          <section className="card p-5" aria-label="Profile summary">
            <PhotoPicker value={profile.profilePhotoUrl} name={profile.fullName} onChange={savePhoto} />
            {photoError && <p role="alert" className="mt-2 text-sm font-medium text-red-700">{photoError}</p>}
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="truncate text-lg font-extrabold text-navy">{profile.fullName}</div>
              <div className="flex items-center gap-1.5 truncate text-sm text-slate-600"><Icon name="mail" className="h-4 w-4 shrink-0 text-brand-500" /> {profile.email}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="pill bg-brand-50 text-brand-700">Parent</span>
                {since && <span className="text-slate-600">Member since {since}</span>}
              </div>
            </div>

            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between text-sm font-bold text-navy">
                <span>Profile complete</span><span>{doneCount} of {steps.length}</span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Profile completeness">
                <div className="h-2 rounded-full bg-brand-500 transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
              </div>
              {doneCount === steps.length ? (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-green-800"><Icon name="check-circle" className="h-4 w-4" /> All set. Tutors can be matched to you.</p>
              ) : (
                <ul className="mt-2 space-y-0.5 text-sm">
                  {steps.filter((s) => !s.done).map((s) => (
                    <li key={s.label}>
                      {s.to
                        ? <Link to={s.to} className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-brand-600 hover:underline"><Icon name="plus" className="h-4 w-4" /> {s.label}</Link>
                        : <button type="button" onClick={s.go} className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-brand-600 hover:underline"><Icon name="plus" className="h-4 w-4" /> {s.label}</button>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <div role="tablist" aria-label="Profile sections" aria-orientation="vertical" onKeyDown={onTabKey} className="card flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible">
            {TABS.map(([id, label, icon]) => (
              <button
                key={id} id={`tab-${id}`} role="tab" type="button" aria-selected={tab === id} aria-controls={`panel-${id}`} tabIndex={tab === id ? 0 : -1}
                onClick={() => goTab(id)}
                className={`flex min-h-11 shrink-0 items-center gap-2.5 rounded-lg px-3.5 text-left text-sm font-semibold transition ${tab === id ? 'bg-brand-50 text-brand-700' : 'text-navy hover:bg-brand-25'}`}
              >
                <Icon name={icon} className="h-[18px] w-[18px] text-brand-500" /> {label}
              </button>
            ))}
          </div>
        </aside>

        {/* ── right: one topic at a time ── */}
        <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1} className="min-w-0">
          {tab === 'details' && (
            <form ref={formRef} onSubmit={saveDetails} noValidate className="card space-y-5 p-6">
              <div>
                <h2 className="text-xl font-extrabold text-navy">Personal details</h2>
              </div>
              {msg && <Saved>{msg}</Saved>}
              <ErrorBox>{error}</ErrorBox>

              <Field id="pf-name" label="Full name" error={fieldErrors.fullName}>
                <input
                  id="pf-name" data-field="fullName" className="input h-11" autoComplete="name" value={form.fullName}
                  onChange={(e) => { setForm({ ...form, fullName: e.target.value }); setFieldErrors((f) => ({ ...f, fullName: '' })) }}
                  onBlur={() => setFieldErrors((f) => ({ ...f, fullName: checkName(form.fullName) }))}
                  aria-invalid={fieldErrors.fullName ? true : undefined} aria-describedby={fieldErrors.fullName ? 'pf-name-error' : undefined}
                />
              </Field>

              <Field id="pf-email" label="Email address" hint="This is how you log in. To change it, open the Password & email tab.">
                <div className="relative">
                  <Icon name="lock" className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-500" />
                  <input id="pf-email" className="input h-11 bg-slate-50 pl-10 text-slate-700" value={profile.email} disabled aria-describedby="pf-email-hint" />
                </div>
              </Field>

              <PhoneInput
                label="Phone number" value={form.phone} error={fieldErrors.phone}
                onBlur={() => setFieldErrors((f) => ({ ...f, phone: checkPhone(form.phone) }))}
                onChange={(v) => { setForm((f) => ({ ...f, phone: v })); setFieldErrors((f) => ({ ...f, phone: '' })) }}
              />

              <PlaceSearch
                value={form.address} error={fieldErrors.address}
                onChange={(v) => { setForm((f) => ({ ...f, address: v })); setFieldErrors((f) => ({ ...f, address: '' })) }}
              />

              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
                {dirty && !busy && <span className="mr-auto text-sm text-amber-800">You have unsaved changes.</span>}
                <button disabled={busy || !dirty} className="btn-primary h-11 px-8">{busy ? 'Saving…' : 'Save changes'}</button>
              </div>
            </form>
          )}

          {tab === 'preferences' && (
            <form onSubmit={savePrefs} className="card space-y-4 p-6">
              <div>
                <h2 className="text-xl font-extrabold text-navy">Tutor preferences</h2>
                <p className="mt-1 text-sm text-slate-600">Optional. These put the best-suited tutors first and pre-fill the matching wizard. They never hide a tutor from you.</p>
              </div>
              <ErrorBox>{prefError}</ErrorBox>
              {prefMsg && <Saved>{prefMsg}</Saved>}
              <PreferencesFields value={prefs} onChange={setPrefs} />
              <div className="flex justify-end border-t border-slate-100 pt-4">
                <button disabled={prefBusy} className="btn-primary h-11 px-8">{prefBusy ? 'Saving…' : 'Save preferences'}</button>
              </div>
            </form>
          )}

          {tab === 'security' && (
            <form onSubmit={changePw} noValidate className="card space-y-5 p-6">
              <div>
                <h2 className="text-xl font-extrabold text-navy">Password</h2>
                <p className="mt-1 text-sm text-slate-600">Use a password you do not use on any other site.</p>
              </div>
              {!profile.hasPassword ? (
                <p className="flex items-start gap-2 rounded-lg bg-brand-25 p-3 text-sm text-slate-700"><Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" /> This account signs in with Google, so there is no password to change.</p>
              ) : (
                <>
                  <ErrorBox>{pwError}</ErrorBox>
                  {pwMsg && <Saved>{pwMsg}</Saved>}
                  <Field id="pf-current" label="Current password">
                    <input id="pf-current" type={showPw ? 'text' : 'password'} className="input h-11" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
                  </Field>
                  <div>
                    <Field id="pf-new" label="New password">
                      <input id="pf-new" type={showPw ? 'text' : 'password'} className="input h-11" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
                    </Field>
                    <PasswordHint value={pw.newPassword} />
                  </div>
                  <Field id="pf-confirm" label="Confirm new password" error={pw.confirm && pw.confirm !== pw.newPassword ? 'The passwords do not match' : ''}>
                    <input id="pf-confirm" type={showPw ? 'text' : 'password'} className="input h-11" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
                  </Field>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-navy">
                    <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} /> Show passwords
                  </label>
                  <div className="flex justify-end border-t border-slate-100 pt-4">
                    <button disabled={pwBusy} className="btn-primary h-11 px-8">{pwBusy ? 'Updating…' : 'Change password'}</button>
                  </div>
                </>
              )}
            </form>
          )}

          {tab === 'security' && (
            <ChangeEmail
              email={profile.email} hasPassword={profile.hasPassword}
              onChanged={(email) => { setProfile((p) => ({ ...p, email })); setUser?.((u) => (u ? { ...u, email } : u)) }}
            />
          )}

          {tab === 'privacy' && (
            <PrivacyAccountCard emailReminders={profile.emailReminders} privacyAcceptedAt={profile.privacyAcceptedAt} email={profile.email} />
          )}
        </div>
      </div>
    </div>
  )
}
