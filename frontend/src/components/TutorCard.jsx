import { useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from './ui/Avatar'
import Icon from './ui/Icon'
import { distanceLabel } from '../lib/distance'
import { ModePills, VerifiedTick } from './ui/Common'

// One tutor card, used by Find a Tutor (browse) and the matching results.
// With a `match` it also shows the match % badge and the "why we recommend this tutor" reasons.
// With `onToggleSave` it also shows a heart button to save / unsave the tutor.
export default function TutorCard({ tutor, match, query = '', saved = false, onToggleSave }) {
  const distance = distanceLabel(tutor.distanceKm ?? match?.distanceKm)
  const [more, setMore] = useState(false)
  const reasons = match?.reasons || []
  const shown = more ? reasons : reasons.slice(0, 3)

  return (
    <article className="card flex flex-col gap-3 p-4 transition hover:shadow-[0_10px_34px_rgba(26,109,255,0.14)]">
      {(match || tutor.recommended) && (
        <div className="flex items-center gap-2">
          {match ? (
            <>
              <span className="pill bg-accent-100 text-navy"><Icon name="heart" className="h-3.5 w-3.5 text-accent-600" fill /> {match.score}% Match</span>
              <span className="text-xs font-medium text-ok">{match.label}</span>
            </>
          ) : (
            <span className="pill bg-accent-100 text-navy"><Icon name="sparkle" className="h-3.5 w-3.5 text-accent-600" fill /> Recommended for your child</span>
          )}
        </div>
      )}

      <div className="flex gap-4">
        <Avatar src={tutor.photoUrl} name={tutor.name} className="h-[116px] w-[92px]" rounded="rounded-xl" text="text-2xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="flex min-w-0 items-center gap-1.5 text-lg font-extrabold text-navy">
              <span className="truncate">{tutor.name}</span>
              {tutor.verified && <VerifiedTick />}
            </h3>
            <span className="shrink-0 pt-0.5 font-extrabold text-navy">RM {tutor.hourlyRate} <span className="text-xs font-semibold text-slate-500">/ hour</span></span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-sm">
            <Icon name="star" fill className="h-4 w-4 text-accent" />
            <span className="font-bold text-navy">{tutor.rating.toFixed(1)}</span>
            <span className="text-slate-500">({tutor.reviewCount} reviews)</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-sm text-slate-600">
            <Icon name="book" className="h-4 w-4 shrink-0 text-brand-500" />
            <span className="truncate">{tutor.mainSubject} <span className="text-slate-300">|</span> {tutor.levels}</span>
          </div>
          <div className="mt-2"><ModePills online={tutor.offersOnline} physical={tutor.offersPhysical} /></div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
            <Icon name="pin" className="h-3.5 w-3.5 shrink-0 text-brand-500" />
            <span className="truncate">{tutor.location}{distance && tutor.offersPhysical ? ` · ${distance}` : ''}</span>
          </div>
          {!match && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-700">
              <Icon name="calendar" className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Available: {tutor.availableDays.join(', ') || '—'}</span>
            </div>
          )}
        </div>
      </div>

      {match && (
        <div className="rounded-xl bg-brand-25 p-3">
          <div className="mb-1.5 text-sm font-bold text-navy">Why we recommend this tutor</div>
          <ul className="space-y-1">
            {shown.map((r) => (
              <li key={r} className="flex items-start gap-2 text-sm text-slate-600">
                <Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" /> {r}
              </li>
            ))}
          </ul>
          {reasons.length > 3 && (
            <button onClick={() => setMore((m) => !m)} className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-brand-500 hover:underline">
              {more ? 'View less' : 'View more'} <Icon name={more ? 'up' : 'down'} className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <div className={`mt-auto grid gap-3 ${onToggleSave ? 'grid-cols-[auto_1fr_1fr]' : 'grid-cols-2'}`}>
        {onToggleSave && (
          <button
            type="button"
            onClick={() => onToggleSave(tutor)}
            aria-pressed={saved}
            aria-label={saved ? `Remove ${tutor.name} from saved tutors` : `Save ${tutor.name}`}
            title={saved ? 'Saved' : 'Save tutor'}
            className={`flex h-10 w-11 items-center justify-center rounded-lg border transition ${saved ? 'border-red-200 bg-red-50 text-red-500' : 'border-slate-200 text-slate-500 hover:border-brand-500 hover:text-brand-500'}`}
          >
            <Icon name="heart" fill={saved} className="h-5 w-5" />
          </button>
        )}
        <Link to={`/parent/tutors/${tutor.id}${query}`} className="btn-outline">View Profile</Link>
        <Link to={`/parent/tutors/${tutor.id}/book${query}`} className="btn-primary">Book a Lesson</Link>
      </div>
    </article>
  )
}
