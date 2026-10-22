import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from './ui/Icon'
import Avatar from './ui/Avatar'
import { Modal, Stars, VerifiedTick } from './ui/Common'
import { distanceLabel } from '../lib/distance'

// Compare up to three tutors side by side (FR 2.7). The tutor cards already hold everything shown here, so comparing
// needs no extra request; the chosen tutors are kept as objects so a changed filter does not lose them.
export function useCompare(max = 3) {
  const [chosen, setChosen] = useState([])
  const has = (t) => chosen.some((c) => c.id === t.id)
  const toggle = (t) => setChosen((list) => (list.some((c) => c.id === t.id) ? list.filter((c) => c.id !== t.id) : list.length >= max ? list : [...list, t]))
  return { chosen, has, toggle, clear: () => setChosen([]), full: chosen.length >= max, max }
}

const money = (n) => `RM ${n}`

// The bar that appears at the bottom once a tutor is ticked, and the comparison table behind its button
export function CompareBar({ compare, query = '' }) {
  const [open, setOpen] = useState(false)
  const { chosen } = compare
  if (!chosen.length) return null

  const cheapest = Math.min(...chosen.map((t) => t.hourlyRate))
  const bestRating = Math.max(...chosen.map((t) => t.rating))
  const rows = [
    ['Rating', (t) => <span className={t.rating === bestRating && chosen.length > 1 ? 'font-bold text-ok' : ''}><Stars value={t.rating} size="h-3.5 w-3.5" /> {t.rating.toFixed(1)} ({t.reviewCount})</span>],
    ['Price per hour', (t) => <span className={t.hourlyRate === cheapest && chosen.length > 1 ? 'font-bold text-ok' : 'font-semibold'}>{money(t.hourlyRate)}</span>],
    ['Subjects', (t) => t.subjects.join(', ')],
    ['Levels', (t) => t.levels || '—'],
    ['Lessons', (t) => [t.offersOnline && 'Online', t.offersPhysical && 'Physical'].filter(Boolean).join(' · ') || '—'],
    ['Location', (t) => `${t.location || '—'}${distanceLabel(t.distanceKm ?? t.match?.distanceKm) && t.offersPhysical ? ` · ${distanceLabel(t.distanceKm ?? t.match?.distanceKm)}` : ''}`],
    ['Available days', (t) => t.availableDays?.join(', ') || '—'],
    ['Languages', (t) => t.languages?.join(', ') || '—'],
    ['Teaching style', (t) => t.characteristics?.join(', ') || '—'],
    ['Experience', (t) => `${t.yearsExperience} year${t.yearsExperience === 1 ? '' : 's'}`],
    ...(chosen.some((t) => t.match) ? [['Match', (t) => (t.match ? `${t.match.score}% · ${t.match.label}` : '—')]] : []),
  ]

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 shadow-[0_-6px_24px_rgba(11,42,111,0.12)] backdrop-blur" role="region" aria-label="Compare tutors">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 pr-20">
          <div className="flex items-center gap-2">
            {chosen.map((t) => (
              <span key={t.id} className="flex items-center gap-1.5 rounded-full bg-brand-50 py-1 pl-1 pr-2 text-sm font-semibold text-navy">
                <Avatar src={t.photoUrl} name={t.name} className="h-6 w-6" text="text-[10px]" /> <span className="max-w-[110px] truncate">{t.name}</span>
                <button type="button" onClick={() => compare.toggle(t)} aria-label={`Remove ${t.name} from comparison`} className="text-slate-500 hover:text-red-600"><Icon name="x" className="h-3.5 w-3.5" /></button>
              </span>
            ))}
          </div>
          <span className="text-xs text-slate-600">{chosen.length < 2 ? 'Choose at least 2 tutors to compare' : `${chosen.length} of ${compare.max} chosen`}</span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={compare.clear} className="btn-outline px-4">Clear</button>
            <button type="button" disabled={chosen.length < 2} onClick={() => setOpen(true)} className="btn-primary px-5 disabled:opacity-50">Compare ({chosen.length})</button>
          </div>
        </div>
      </div>
      <div className="h-16" aria-hidden="true" />

      <Modal open={open} onClose={() => setOpen(false)} title="Compare tutors" width="max-w-4xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="w-32 p-2" />
                {chosen.map((t) => (
                  <th key={t.id} scope="col" className="p-2 align-top">
                    <div className="flex flex-col items-start gap-1.5">
                      <Avatar src={t.photoUrl} name={t.name} className="h-16 w-14" rounded="rounded-lg" text="text-lg" />
                      <span className="flex items-center gap-1 font-extrabold text-navy">{t.name} {t.verified && <VerifiedTick className="h-4 w-4" />}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, cell]) => (
                <tr key={label} className="border-t border-slate-100">
                  <th scope="row" className="p-2 align-top text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</th>
                  {chosen.map((t) => <td key={t.id} className="p-2 align-top text-slate-700">{cell(t)}</td>)}
                </tr>
              ))}
              <tr className="border-t border-slate-100">
                <td />
                {chosen.map((t) => (
                  <td key={t.id} className="space-y-1.5 p-2">
                    <Link to={`/parent/tutors/${t.id}${query}`} className="btn-outline block w-full text-center">View Profile</Link>
                    <Link to={`/parent/tutors/${t.id}/book${query}`} className="btn-primary block w-full text-center">Book a Lesson</Link>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">Green marks the lowest price and the highest rating among the chosen tutors.</p>
      </Modal>
    </>
  )
}
