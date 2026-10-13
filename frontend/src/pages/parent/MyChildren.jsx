import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { useMatching } from '../../assistant/MatchingContext'
import Avatar from '../../components/ui/Avatar'
import PhotoPicker from '../../components/PhotoPicker'
import Icon from '../../components/ui/Icon'
import { EmptyState, ErrorBox, Modal, PageTitle, SelectBox, Spinner } from '../../components/ui/Common'
import { GRADE_GROUPS, gradeLabel, parseGrade } from '../../lib/education'

const blank = { name: '', grade: 'PRIMARY:1', subject: '', notes: '', photoUrl: null }

// My Children: add / edit / remove child profiles (name, education level, grade, subject, notes)
export default function MyChildren() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { catalog, refreshChildren, applyChild } = useMatching()
  const [kids, setKids] = useState(null)
  const [editing, setEditing] = useState(null) // null | 'new' | child
  const [form, setForm] = useState(blank)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(null)

  const load = () => api.get('/parent/children').then((r) => { setKids(r.data.children); return r.data.children })
  useEffect(() => { load() }, [])

  // Deep links from the dashboard: ?add=1 / ?edit=<id>
  useEffect(() => {
    if (!kids) return
    if (params.get('add')) openForm('new')
    else if (params.get('edit')) {
      const c = kids.find((k) => k.id === Number(params.get('edit')))
      if (c) openForm(c)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kids === null])

  function openForm(c) {
    setError('')
    setEditing(c)
    setForm(c === 'new' ? blank : { name: c.name, grade: `${c.educationLevel}:${c.grade}`, subject: c.subject || '', notes: c.notes || '', photoUrl: c.photoUrl })
  }
  function closeForm() {
    setEditing(null)
    if (params.get('add') || params.get('edit')) setParams({})
  }

  async function save(e) {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) return setError('Child name is required')
    const { level, grade } = parseGrade(form.grade)
    const body = { name: form.name, educationLevel: level, grade, subject: form.subject || null, notes: form.notes || null, photoUrl: form.photoUrl }
    setBusy(true)
    try {
      if (editing === 'new') await api.post('/parent/children', body)
      else await api.put(`/parent/children/${editing.id}`, body)
      await load(); await refreshChildren()
      closeForm()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    try {
      await api.delete(`/parent/children/${removing.id}`)
      await load(); await refreshChildren()
      setRemoving(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  if (!kids) return <Spinner />

  return (
    <div>
      <PageTitle icon="user" title="My Children" subtitle="Manage your children's profiles so we can match them with the right tutors." />
      <ErrorBox className="mb-4">{!editing && error}</ErrorBox>

      {kids.length === 0 && (
        <div className="card mb-4"><EmptyState icon="user" title="No children added yet" action={<button onClick={() => openForm('new')} className="btn-primary mt-2"><Icon name="plus" className="h-4 w-4" /> Add Child</button>}>
          Add your child's level and subject to get tutor recommendations that fit.</EmptyState></div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {kids.map((c) => (
          <article key={c.id} className="card p-5">
            <div className="flex items-center gap-4">
              <Avatar src={c.photoUrl} name={c.name} className="h-20 w-20" text="text-2xl" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xl font-extrabold text-navy">{c.name}</div>
                <div className="flex items-center gap-1.5 text-sm text-slate-500"><Icon name="calendar" className="h-4 w-4 text-brand-500" /> {gradeLabel(c.educationLevel, c.grade)}</div>
                {c.subject && <div className="flex items-center gap-1.5 text-sm text-slate-500"><Icon name="book" className="h-4 w-4 text-brand-500" /> {c.subject}</div>}
              </div>
            </div>
            {c.notes && <p className="mt-3 rounded-lg bg-brand-25 p-3 text-sm text-slate-600">{c.notes}</p>}
            <div className="mt-2 text-xs text-slate-400">{c.bookingCount} booking{c.bookingCount === 1 ? '' : 's'}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => { applyChild(c); navigate('/parent/find-tutor/match') }} className="btn-primary col-span-2"><Icon name="search" className="h-4 w-4" /> Find a Tutor</button>
              <button onClick={() => openForm(c)} className="btn-outline"><Icon name="edit" className="h-4 w-4" /> Edit</button>
              <button onClick={() => { setError(''); setRemoving(c) }} className="btn-danger"><Icon name="trash" className="h-4 w-4" /> Remove</button>
            </div>
          </article>
        ))}
        {kids.length > 0 && (
          <button onClick={() => openForm('new')} className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/60 p-6 text-center transition hover:bg-brand-50">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-brand-500"><Icon name="plus" className="h-7 w-7" /></span>
            <span className="mt-2 text-lg font-bold text-navy">Add Child</span>
            <span className="text-sm text-slate-500">Add another child to find suitable tutors for their learning needs.</span>
          </button>
        )}
      </div>

      <Modal open={!!editing} onClose={closeForm} title={editing === 'new' ? 'Add a child' : 'Edit child'}>
        <form onSubmit={save} className="space-y-4">
          <ErrorBox>{error}</ErrorBox>
          <PhotoPicker value={form.photoUrl} name={form.name || 'Child'} onChange={(url) => setForm({ ...form, photoUrl: url })} />
          <label className="block"><span className="mb-1.5 block text-sm font-bold text-navy">Child's Name <span className="text-red-500">*</span></span>
            <input autoFocus className="input h-11" maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sarah Tan" /></label>
          <label className="block"><span className="mb-1.5 block text-sm font-bold text-navy">Education Level <span className="text-red-500">*</span></span>
            <SelectBox icon="cap" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })}>
              {GRADE_GROUPS.map((g) => <optgroup key={g.label} label={g.label}>{g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>)}
            </SelectBox></label>
          <label className="block"><span className="mb-1.5 block text-sm font-bold text-navy">Main subject needing help</span>
            <SelectBox icon="book" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}>
              <option value="">Not sure yet</option>
              {(catalog?.subjects || []).map((s) => <option key={s}>{s}</option>)}
            </SelectBox></label>
          <label className="block"><span className="mb-1.5 block text-sm font-bold text-navy">Notes <span className="font-normal text-slate-500">(Optional)</span></span>
            <textarea rows={3} maxLength={500} className="input resize-none" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Struggles with problem sums. Preparing for UPSR-style exams." />
            <span className="block text-right text-xs text-slate-400">{form.notes.length}/500</span></label>
          <div className="flex justify-end gap-3"><button type="button" onClick={closeForm} className="btn-outline">Cancel</button><button disabled={busy} className="btn-primary px-6">{busy ? 'Saving…' : 'Save'}</button></div>
        </form>
      </Modal>

      <Modal open={!!removing} onClose={() => setRemoving(null)} title={`Remove ${removing?.name}?`}
        footer={<><button onClick={() => setRemoving(null)} className="btn-outline">Cancel</button><button onClick={remove} className="btn bg-red-500 text-white hover:bg-red-600">Remove</button></>}>
        <p className="text-sm text-slate-600">This removes the profile. Children with lesson history cannot be removed.</p>
        <ErrorBox className="mt-3">{removing && error}</ErrorBox>
      </Modal>
    </div>
  )
}
