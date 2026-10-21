import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api, { errorMessage } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { downloadFile } from '../lib/download'
import { fmtDateLong } from '../lib/format'
import Icon from './ui/Icon'
import { ErrorBox, Modal, Spinner } from './ui/Common'

// My Profile > Privacy & account (PDPA): reminder emails on/off, a copy of my data, and deleting the account.
export default function PrivacyAccountCard({ emailReminders, privacyAcceptedAt, email }) {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [on, setOn] = useState(emailReminders)
  const [switchBusy, setSwitchBusy] = useState(false)
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)

  async function toggleReminders() {
    if (switchBusy) return
    setSwitchBusy(true)
    setError('')
    setMessage('')
    try {
      const r = await api.put('/parent/account/email-reminders', { enabled: !on })
      setOn(r.data.emailReminders)
      setMessage(r.data.emailReminders ? 'Reminder emails are on.' : 'Reminder emails are off. You still get reminders in the app.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSwitchBusy(false)
    }
  }

  async function download() {
    setDownloadBusy(true)
    setError('')
    setMessage('')
    const problem = await downloadFile('/parent/account/export', 'wondertutor-my-data.json')
    if (problem) setError(problem)
    else setMessage('Your data was downloaded as a file.')
    setDownloadBusy(false)
  }

  return (
    <section className="card space-y-4 p-6" aria-labelledby="privacy-title">
      <div>
        <h2 id="privacy-title" className="flex items-center gap-2 text-lg font-bold text-navy"><Icon name="shield" className="h-5 w-5 text-brand-500" /> Privacy &amp; account</h2>
        <p className="mt-1 text-sm text-slate-600">
          You decide what we keep. Read our <Link to="/privacy" className="font-semibold text-brand-600 hover:underline">Privacy Notice</Link>
          {privacyAcceptedAt ? ` (you accepted it on ${fmtDateLong(privacyAcceptedAt)}).` : '.'}
        </p>
      </div>

      <ErrorBox>{error}</ErrorBox>
      {message && <p role="status" className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-slate-700">{message}</p>}

      <div className="flex items-start justify-between gap-4">
        <div>
          <div id="reminder-label" className="font-semibold text-navy">Reminder emails</div>
          <p id="reminder-help" className="text-sm text-slate-600">A reminder the day before a lesson, and when a payment is due soon. Emails about payments and refunds are always sent.</p>
        </div>
        <button
          type="button" role="switch" aria-checked={on} aria-labelledby="reminder-label" aria-describedby="reminder-help"
          disabled={switchBusy} onClick={toggleReminders}
          className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition ${on ? 'bg-brand-500' : 'bg-slate-300'} disabled:opacity-60`}
        >
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'left-[1.375rem]' : 'left-0.5'}`} />
        </button>
      </div>

      <div className="border-t border-slate-100 pt-4">
        <div className="font-semibold text-navy">Download my data</div>
        <p className="text-sm text-slate-600">A file with everything we hold about you: your details, children, bookings, payments, reviews and complaints.</p>
        <button type="button" onClick={download} disabled={downloadBusy} className="btn-outline mt-2 min-h-10 px-4 text-sm">
          <Icon name="file" className="h-4 w-4" /> {downloadBusy ? 'Preparing…' : 'Download my data'}
        </button>
      </div>

      <div className="rounded-xl border border-red-100 bg-red-50/50 p-4">
        <div className="font-semibold text-red-800">Delete my account</div>
        <p className="text-sm text-slate-700">Removes your personal details for good. This cannot be undone.</p>
        <button type="button" onClick={() => setDeleting(true)} className="btn-danger mt-2 min-h-10 px-4 text-sm">Delete my account…</button>
      </div>

      {deleting && (
        <DeleteAccountModal
          email={email}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            // Sent to Log In first, then logged out: the page behind must not react to the ended login in between
            navigate('/login', { replace: true, state: { deleted: true } })
            logout()
          }}
        />
      )}
    </section>
  )
}

function DeleteAccountModal({ email, onClose, onDeleted }) {
  const [check, setCheck] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [typed, setTyped] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/parent/account/deletion-check').then((r) => setCheck(r.data)).catch((e) => setLoadError(errorMessage(e)))
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await api.post('/parent/account/delete', { confirmEmail: typed, ...(check.hasPassword && { password }) })
      onDeleted()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const matches = typed.trim().toLowerCase() === email.toLowerCase()
  const ready = matches && (!check?.hasPassword || password.length > 0)
  const { blockers } = check || {}

  return (
    <Modal open onClose={onClose} title="Delete your account?" width="max-w-lg">
      {loadError ? <ErrorBox>{loadError}</ErrorBox> : !check ? <Spinner /> : !check.canDelete ? (
        <div className="space-y-3 text-sm text-slate-700">
          <p>Before you can delete your account, please finish:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            {blockers.bookings > 0 && <li><b>{blockers.bookings}</b> booking{blockers.bookings === 1 ? '' : 's'} still in progress. Cancel or finish {blockers.bookings === 1 ? 'it' : 'them'} in <Link to="/parent/bookings" onClick={onClose} className="font-semibold text-brand-600 hover:underline">My Bookings</Link>.</li>}
            {blockers.refunds > 0 && <li><b>{blockers.refunds}</b> refund request{blockers.refunds === 1 ? '' : 's'} waiting for our team. See <Link to="/parent/payments" onClick={onClose} className="font-semibold text-brand-600 hover:underline">Payments</Link>.</li>}
            {blockers.complaints > 0 && <li><b>{blockers.complaints}</b> open complaint{blockers.complaints === 1 ? '' : 's'}. See <Link to="/parent/complaints" onClick={onClose} className="font-semibold text-brand-600 hover:underline">Complaints</Link>.</li>}
          </ul>
          <p className="text-slate-600">This keeps tutors, and any money owed back to you, from being left unsettled.</p>
          <div className="flex justify-end"><button type="button" onClick={onClose} className="btn-primary px-6">OK</button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 text-sm text-slate-700">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-red-50 p-3">
              <div className="font-bold text-red-800">Will be removed</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>Your name, email, phone and photo</li>
                <li>Your address and tutor preferences</li>
                <li>Your children’s names, notes and photos</li>
                <li>Saved tutors, searches and notifications</li>
              </ul>
            </div>
            <div className="rounded-xl bg-brand-25 p-3">
              <div className="font-bold text-navy">Will stay, without your name</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>Lesson and payment records (the centre needs them for its accounts)</li>
                <li>Reviews you wrote</li>
                <li>Complaints you filed</li>
              </ul>
            </div>
          </div>
          <p>We will send a confirmation email. You can sign up again with the same email later.</p>
          <ErrorBox>{error}</ErrorBox>
          <label className="block font-semibold text-navy">Type your email to confirm: <span className="font-normal text-slate-600">{email}</span>
            <input autoFocus className="input mt-1 h-11" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={email} />
          </label>
          {check.hasPassword && (
            <label className="block font-semibold text-navy">Your password
              <input type="password" className="input mt-1 h-11" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="btn-outline">Keep my account</button>
            <button disabled={!ready || busy} className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{busy ? 'Deleting…' : 'Delete my account permanently'}</button>
          </div>
        </form>
      )}
    </Modal>
  )
}
