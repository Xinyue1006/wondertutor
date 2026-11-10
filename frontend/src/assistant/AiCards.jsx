// Server-built result cards for the AI assistant. Every value here comes from our backend's tool results (validated by
// a strict schema there), not from model-written text. Plain text only; links are limited to in-app parent pages.
import { Link } from 'react-router-dom'
import Icon from '../components/ui/Icon'
import { VerifiedTick } from '../components/ui/Common'
import { fmtDate, money } from '../lib/format'
import { safeRoute } from './aiApi'

const STATUS_WORDS = {
  PENDING: 'Waiting for tutor', COUNTER_OFFERED: 'Counter-offer', AWAITING_PAYMENT: 'Waiting for payment', CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed', REJECTED: 'Declined', CANCELLED: 'Cancelled', DISPUTED: 'Disputed', PAID: 'Paid', REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partly refunded', FAILED: 'Failed', APPROVED: 'Approved', ESCALATED: 'Escalated', OPEN: 'Open', IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved', DISMISSED: 'Dismissed',
}
const word = (s) => STATUS_WORDS[s] || s

function Box({ title, link, linkText = 'Open page', children }) {
  const to = safeRoute(link)
  return (
    <div className="mt-2 rounded-xl bg-white p-3 text-[13px] text-slate-700 shadow-sm ring-1 ring-brand-100">
      {title && <div className="mb-1.5 font-bold text-navy">{title}</div>}
      {children}
      {to && (
        <Link to={to} className="mt-2 inline-flex min-h-9 items-center gap-1 font-semibold text-brand-600 hover:underline">
          {linkText} <Icon name="right" className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  )
}

const Row = ({ label, children }) => (
  <div className="flex justify-between gap-3 py-0.5"><span className="text-slate-500">{label}</span><span className="text-right font-medium text-navy">{children}</span></div>
)

function Recorded({ label, text }) {
  if (!text) return null
  return <div className="mt-1.5"><div className="text-xs font-semibold text-slate-500">{label}</div><div className="whitespace-pre-line">{text}</div></div>
}

export default function AiCard({ card, onChooseChild, onOpenResults, busy }) {
  switch (card.type) {
    case 'child_choices':
      return (
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={card.title}>
          {card.choices.map((c) => (
            <button key={c.ref} type="button" disabled={busy} onClick={() => onChooseChild(c)} className="chip px-3.5 py-1.5 text-[13px] disabled:opacity-50">{c.label}</button>
          ))}
        </div>
      )
    case 'booking_list':
      return (
        <Box title={card.title} link={card.link} linkText="Open My Bookings">
          <ul className="divide-y divide-slate-100">
            {card.bookings.map((b) => (
              <li key={b.ref} className="py-1.5">
                <div className="font-semibold text-navy">{b.subject} · {b.childName}</div>
                <div className="text-slate-600">{fmtDate(`${b.date}T${b.time}:00+08:00`)} {b.time} · {b.mode === 'ONLINE' ? 'Online' : 'Physical'} · {b.tutorName}</div>
                <div className="text-xs text-slate-500">{word(b.status)}{b.hourlyPrice != null && ` · ${money(b.hourlyPrice)}/hour`}</div>
              </li>
            ))}
          </ul>
        </Box>
      )
    case 'lesson_detail':
      return (
        <Box title={`${card.subject} · ${card.childName}`} link={card.link} linkText="Open lesson">
          <Row label="When">{card.date} {card.time}</Row>
          <Row label="Tutor">{card.tutorName}</Row>
          <Row label="Status">{word(card.status)}</Row>
          <Row label="Attendance">{card.mode === 'ONLINE' ? 'Online lesson (not tracked)' : card.checkIn.recorded ? `Checked in ${card.checkIn.checkInTime}${card.checkIn.checkOutTime ? `, out ${card.checkIn.checkOutTime}` : ''}` : 'No check-in recorded'}</Row>
          {card.summary ? (
            <div className="mt-1 border-t border-slate-100 pt-1">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-400">The tutor recorded</div>
              <Recorded label="Summary" text={card.summary.content} />
              <Recorded label="Topics" text={card.summary.topics} />
              <Recorded label="Homework / follow-up" text={card.summary.homework} />
              <Recorded label="Recommendations" text={card.summary.recommendations} />
              <Recorded label="Observations" text={card.summary.progressNote} />
            </div>
          ) : <div className="mt-1 text-slate-500">No lesson summary has been submitted yet.</div>}
        </Box>
      )
    case 'progress_summary':
      return (
        <Box title={`${card.childName}: recorded progress`} link={card.link} linkText="Open progress page">
          <Row label="Completed lessons">{card.totals.lessons}</Row>
          <Row label="Hours">{card.totals.hours}</Row>
          <Row label="Summaries received">{card.totals.summaries}</Row>
          <Row label="Homework set">{card.totals.homeworkSet}</Row>
          {card.totals.physicalLessons > 0 && <Row label="Physical lessons checked in">{card.totals.checkedIn} of {card.totals.physicalLessons}</Row>}
          {card.recentLessons.length > 0 && (
            <ul className="mt-1.5 space-y-1 border-t border-slate-100 pt-1.5">
              {card.recentLessons.map((l, i) => (
                <li key={i}><span className="font-semibold text-navy">{l.date} · {l.subject}</span> <span className="text-slate-500">({l.tutorName})</span>{l.homework && <div className="text-slate-600">Homework: {l.homework}</div>}</li>
              ))}
            </ul>
          )}
        </Box>
      )
    case 'payment_summary':
      return (
        <Box title={card.periodLabel} link={card.link} linkText="Open Payments">
          <Row label={`Paid (${card.paidCount})`}>{money(card.paidAmount)}</Row>
          <Row label={`Waiting for payment (${card.pendingCount})`}>{money(card.pendingAmount)}</Row>
          <Row label="Total paid (all time)">{money(card.totalPaidAllTime)}</Row>
          {card.refunds.map((r) => <Row key={r.status} label={`Refund requests: ${word(r.status)} (${r.count})`}>{money(r.amount)}</Row>)}
          <p className="mt-1.5 text-xs text-slate-500">Paid amounts are not reduced by refunds; refund requests are listed separately.</p>
        </Box>
      )
    case 'refund_list':
      return (
        <Box title="Payments and refunds" link={card.link} linkText="Open Payments">
          <ul className="divide-y divide-slate-100">
            {card.payments.map((p, i) => (
              <li key={i} className="py-1.5">
                <div className="font-semibold text-navy">{p.subject} · {p.date}</div>
                <div className="text-slate-600">{money(p.amount)} · {word(p.status)}</div>
                {p.refunds.map((r, j) => <div key={j} className="text-xs text-slate-500">Refund {money(r.amount)}: {word(r.status)}</div>)}
              </li>
            ))}
          </ul>
        </Box>
      )
    case 'complaint_list':
      return (
        <Box title="Your complaints" link={card.link} linkText="Open Complaints">
          <ul className="divide-y divide-slate-100">
            {card.complaints.map((c, i) => (
              <li key={i} className="py-1.5">
                <div className="font-semibold text-navy">{c.category} · {word(c.status)}</div>
                <div className="text-xs text-slate-500">Filed {c.createdAt}</div>
                {c.adminResponse && <div className="mt-0.5 text-slate-600">Admin reply: {c.adminResponse}</div>}
              </li>
            ))}
          </ul>
        </Box>
      )
    case 'notification_list':
      return (
        <Box title={`Notifications (${card.unread} unread)`}>
          <ul className="space-y-1">
            {card.items.map((n, i) => <li key={i} className={n.isRead ? 'text-slate-500' : 'font-semibold text-navy'}>{n.title} <span className="text-xs font-normal text-slate-400">· {n.createdAt}</span></li>)}
          </ul>
        </Box>
      )
    case 'faq':
      return (
        <Box title="WonderTutor policy">
          {card.entries.map((e) => <div key={e.id} className="mt-1"><div className="font-semibold text-navy">{e.topic}</div><div>{e.answer}</div></div>)}
        </Box>
      )
    case 'tutor_results':
      return (
        <Box title={card.total ? `${card.total} matching tutor${card.total === 1 ? '' : 's'}` : 'No tutors match yet'}>
          <div className="mb-1.5 flex flex-wrap gap-1">{card.criteriaSummary.map((c) => <span key={c} className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-navy">{c}</span>)}</div>
          <ul className="divide-y divide-slate-100">
            {card.tutors.slice(0, 5).map((t) => (
              <li key={t.id} className="py-1.5">
                <div className="flex items-center gap-1.5">
                  <Link to={safeRoute(t.link) || '/parent/find-tutor'} className="font-semibold text-navy hover:underline">{t.name}</Link>
                  {t.verified && <VerifiedTick className="h-4 w-4" />}
                  <span className="ml-auto rounded-full bg-accent-100 px-2 py-0.5 text-xs font-bold text-amber-700">{t.score}% match</span>
                </div>
                <div className="text-xs text-slate-500">{t.label} · {money(t.hourlyRate)}/hour · {t.rating ? `${t.rating}★ (${t.reviewCount})` : 'New tutor'}</div>
                {t.reasons.length > 0 && <div className="text-xs text-slate-600">{t.reasons.slice(0, 3).join(' · ')}</div>}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-slate-500">Match % is a compatibility score from fixed rules, not a prediction of results. Verified tutors are listed first.</p>
          {card.total > 0 && (
            <button type="button" onClick={onOpenResults} className="mt-2 inline-flex min-h-9 items-center gap-1 font-semibold text-brand-600 hover:underline">
              See all results <Icon name="right" className="h-3.5 w-3.5" />
            </button>
          )}
        </Box>
      )
    case 'match_explanation':
      return (
        <Box title={`${card.name}: ${card.score}% (${card.label})`} link={card.link} linkText="View tutor">
          <Row label="Rank">{card.rank} of {card.total}{card.verified ? ' · verified' : ''}</Row>
          <ul className="mt-1 list-disc pl-5">{card.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </Box>
      )
    default:
      return null
  }
}
