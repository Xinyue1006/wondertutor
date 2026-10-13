import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import Avatar from '../../components/ui/Avatar'
import Icon from '../../components/ui/Icon'
import { EmptyState, ErrorBox, LoadError, Modal, PageTitle, Spinner, VerifiedTick } from '../../components/ui/Common'
import { fmtShortDate } from '../../lib/format'
import { gradeLabel } from '../../lib/education'

// Admin user management: search, deactivate / reactivate, approve tutor qualifications
export default function AdminUsers() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState(null)
  const role = params.get('role') || ''
  const status = params.get('status') || ''
  const flagged = params.get('flagged') || ''
  const pending = params.get('pending') || ''

  const [loadError, setLoadError] = useState('')
  const load = useCallback(() => {
    setLoadError('')
    api.get('/admin/users', { params: { role, status, flagged, q } }).then((r) => setData(r.data)).catch((e) => setLoadError(errorMessage(e)))
  }, [role, status, flagged, q])
  useEffect(() => {
    const t = setTimeout(load, 250) // wait for the admin to stop typing
    return () => clearTimeout(t)
  }, [load])

  const set = (k, v) => { const p = Object.fromEntries(params); if (v) p[k] = v; else delete p[k]; setParams(p) }
  const users = (data?.users || []).filter((u) => !pending || u.tutor?.pendingQualifications > 0)

  return (
    <div>
      <PageTitle title="User Management" subtitle="View accounts, deactivate or reactivate them, and approve tutor qualifications." />

      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-[220px] flex-1">
          <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input h-10 pl-9" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input h-10 w-40" value={role} onChange={(e) => set('role', e.target.value)}>
          <option value="">All roles</option><option value="PARENT">Parents</option><option value="TUTOR">Tutors</option><option value="ADMIN">Admins</option>
        </select>
        <select className="input h-10 w-44" value={status} onChange={(e) => set('status', e.target.value)}>
          <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="DEACTIVATED">Deactivated</option>
        </select>
        <label className="flex items-center gap-2 text-sm font-semibold text-navy">
          <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={!!flagged} onChange={(e) => set('flagged', e.target.checked ? '1' : '')} />
          Below rating threshold{data && ` (${data.threshold})`}
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold text-navy">
          <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={!!pending} onChange={(e) => set('pending', e.target.checked ? '1' : '')} />
          Qualifications pending
        </label>
      </div>

      {!data ? (loadError ? <LoadError message={loadError} onRetry={load} /> : <Spinner />) : users.length === 0 ? (
        <div className="card"><EmptyState icon="user" title="No users found">Try different filters.</EmptyState></div>
      ) : (
        <div className="card overflow-x-auto p-2">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead><tr className="text-slate-500"><th className="px-4 py-3 font-semibold">User</th><th className="px-3 font-semibold">Role</th><th className="px-3 font-semibold">Status</th><th className="px-3 font-semibold">Tutor info</th><th className="px-3 font-semibold">Joined</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-brand-25">
                  <td className="px-4 py-3"><div className="flex items-center gap-3"><Avatar src={u.profilePhotoUrl} name={u.fullName} className="h-10 w-10" />
                    <div><div className="flex items-center gap-1.5 font-bold text-navy">{u.fullName} {u.tutor?.isVerified && <VerifiedTick />}</div><div className="text-xs text-slate-500">{u.email}</div></div></div></td>
                  <td className="px-3 capitalize">{u.role.toLowerCase()}</td>
                  <td className="px-3"><span className={`pill ${u.status === 'ACTIVE' ? 'bg-ok-50 text-ok' : 'bg-red-50 text-red-600'}`}>{u.status === 'ACTIVE' ? 'Active' : 'Deactivated'}</span></td>
                  <td className="px-3 text-xs text-slate-600">
                    {u.tutor && (<div className="space-y-0.5">
                      <div className="flex items-center gap-1"><Icon name="star" fill className="h-3.5 w-3.5 text-accent" /> {u.tutor.ratingAvg.toFixed(1)} ({u.tutor.ratingCount})</div>
                      {u.tutor.flagged && <span className="pill bg-red-50 py-0.5 text-red-600">Below threshold</span>}
                      {u.tutor.pendingQualifications > 0 && <span className="pill bg-accent-100 py-0.5 text-amber-700">{u.tutor.pendingQualifications} qualification to approve</span>}
                    </div>)}
                  </td>
                  <td className="px-3 text-xs text-slate-500">{fmtShortDate(u.createdAt)}</td>
                  <td className="px-3 text-right"><button onClick={() => setSelected(u.id)} className="btn-outline px-3 py-1.5 text-xs">Manage</button></td>
                </tr>))}
            </tbody>
          </table>
        </div>
      )}

      <UserModal id={selected} onClose={() => setSelected(null)} onChanged={load} />
    </div>
  )
}

function UserModal({ id, onClose, onChanged }) {
  const [user, setUser] = useState(null)
  const [error, setError] = useState('')
  const [rejecting, setRejecting] = useState(null) // qualification being rejected
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)

  const load = useCallback(() => api.get(`/admin/users/${id}`).then((r) => setUser(r.data.user)).catch((e) => setError(errorMessage(e))), [id])
  useEffect(() => { setUser(null); setError(''); setConfirm(false); if (id) load() }, [id, load])
  if (!id) return null

  async function run(fn) {
    setError('')
    try { await fn(); await load(); onChanged() } catch (err) { setError(errorMessage(err)) }
  }

  const review = (qid, status, n) => run(() => api.post(`/admin/qualifications/${qid}/review`, { status, note: n }).then(() => { setRejecting(null); setNote('') }))
  const setStatus = (action) => run(() => api.post(`/admin/users/${id}/${action}`).then(() => setConfirm(false)))

  return (
    <Modal open onClose={onClose} title={user ? user.fullName : 'Loading…'} width="max-w-2xl">
      {!user ? (error ? <ErrorBox>{error}</ErrorBox> : <Spinner />) : (
        <div className="space-y-4">
          <ErrorBox>{error}</ErrorBox>
          <div className="grid gap-2 rounded-xl bg-brand-25 p-4 text-sm sm:grid-cols-2">
            <div><span className="text-slate-500">Email:</span> <b className="text-navy">{user.email}</b></div>
            <div><span className="text-slate-500">Phone:</span> <b className="text-navy">{user.phone || '—'}</b></div>
            <div><span className="text-slate-500">Role:</span> <b className="capitalize text-navy">{user.role.toLowerCase()}</b></div>
            <div><span className="text-slate-500">Joined:</span> <b className="text-navy">{fmtShortDate(user.createdAt)}</b></div>
          </div>

          {user.children.length > 0 && (
            <div><div className="mb-1 text-sm font-bold text-navy">Children</div>
              <div className="flex flex-wrap gap-2">{user.children.map((c) => <span key={c.id} className="pill bg-brand-50 text-brand-600">{c.name} · {gradeLabel(c.educationLevel, c.grade)}</span>)}</div></div>
          )}

          {user.tutor && (
            <div>
              <div className="mb-1 flex items-center justify-between text-sm font-bold text-navy">
                <span>Qualifications</span>
                <span className="font-normal text-slate-500">{user.tutor.isVerified ? 'Verified tutor' : 'Not verified yet'} · Rating {user.tutor.ratingAvg.toFixed(1)} ({user.tutor.ratingCount})</span>
              </div>
              {user.qualifications.length === 0 && <p className="text-sm text-slate-500">No qualifications uploaded.</p>}
              <ul className="space-y-2">
                {user.qualifications.map((q) => (
                  <li key={q.id} className="rounded-xl border border-slate-100 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div><div className="font-bold text-navy">{q.title}</div><div className="text-xs text-slate-500">{q.institution}{q.year && ` · ${q.year}`}</div></div>
                      <span className={`pill ${q.status === 'APPROVED' ? 'bg-ok-50 text-ok' : q.status === 'REJECTED' ? 'bg-red-50 text-red-600' : 'bg-accent-100 text-amber-700'}`}>{q.status.charAt(0) + q.status.slice(1).toLowerCase()}</span>
                    </div>
                    {q.reviewNote && <div className="mt-1 text-xs text-slate-500">Note: {q.reviewNote}</div>}
                    {q.status === 'PENDING' && (rejecting === q.id ? (
                      <div className="mt-2 space-y-2">
                        <textarea rows={2} maxLength={300} className="input resize-none" placeholder="Reason for rejecting (required)" value={note} onChange={(e) => setNote(e.target.value)} />
                        <div className="flex gap-2"><button className="btn bg-red-500 px-4 py-1.5 text-white hover:bg-red-600" onClick={() => review(q.id, 'REJECTED', note)}>Confirm reject</button><button className="btn-outline px-4 py-1.5" onClick={() => setRejecting(null)}>Cancel</button></div>
                      </div>
                    ) : (
                      <div className="mt-2 flex gap-2"><button className="btn-primary px-4 py-1.5" onClick={() => review(q.id, 'APPROVED')}>Approve</button><button className="btn-danger px-4 py-1.5" onClick={() => { setRejecting(q.id); setNote('') }}>Reject</button></div>
                    ))}
                  </li>))}
              </ul>
            </div>
          )}

          {user.role !== 'ADMIN' && (
            <div className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
              <div className="text-sm"><b className="text-navy">Account status:</b> {user.status === 'ACTIVE' ? 'Active' : 'Deactivated'}
                <div className="text-xs text-slate-500">{user.status === 'ACTIVE' ? 'A deactivated user cannot log in. Only an Admin can reactivate them.' : 'Reactivating lets the user log in again.'}</div></div>
              {user.status === 'ACTIVE' ? (confirm ? (
                <div className="flex gap-2"><button className="btn bg-red-500 px-4 py-1.5 text-white hover:bg-red-600" onClick={() => setStatus('deactivate')}>Yes, deactivate</button><button className="btn-outline px-4 py-1.5" onClick={() => setConfirm(false)}>No</button></div>
              ) : <button className="btn-danger px-4 py-1.5" onClick={() => setConfirm(true)}>Deactivate</button>)
                : <button className="btn-primary px-4 py-1.5" onClick={() => setStatus('reactivate')}>Reactivate</button>}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
