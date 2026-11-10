// Approved policy answers for the assistant (search_faq tool). The assistant may only state policies from here.
//
// Every entry was checked against the CODE that enforces it (source = file/function) on the review date. When the
// project documents (CLAUDE.md, reports) say more than the code does, the answer sticks to what the code does and the
// gap is recorded in OPEN_POLICY_QUESTIONS for the project owner. Bump FAQ_VERSION whenever an answer changes.
export const FAQ_VERSION = '2026-11-09.1'
const REVIEWED = '2026-11-09'

export const FAQ = [
  {
    id: 'faq.trial-lesson',
    topic: 'Trial lessons',
    keywords: ['trial', 'first lesson', 'free', 'percuma', 'cubaan', '试课', '试听', 'trial class'],
    answer: 'WonderTutor does not offer trial lessons. All bookings are regular paid lessons at the agreed price.',
    source: 'backend/src/controllers/parent/bookings.controller.js#createBooking',
    reviewed: REVIEWED,
  },
  {
    id: 'faq.counter-offer',
    topic: 'Price proposals and counter-offers',
    keywords: ['counter', 'offer', 'propose', 'price', 'negotiate', 'harga', 'tawar', '还价', '价钱'],
    answer: 'When you send a booking request you propose an hourly price. The tutor can accept it, reject it with a reason, or send a counter-offer. You can accept the counter-offer (the booking then waits for payment) or decline it.',
    source: 'backend/src/controllers/parent/bookings.controller.js#acceptCounter/declineCounter',
    reviewed: REVIEWED,
  },
  {
    id: 'faq.payment-deadline',
    topic: 'Payment deadline',
    keywords: ['deadline', 'pay before', 'expire', 'expired', 'unpaid', 'bayar', 'tamat', '付款期限', '过期'],
    answer: 'A booking is confirmed only after payment. If a booking waiting for payment is still unpaid 1 hour before the lesson starts, it is released and the slot becomes free again. You get one reminder when the payment deadline is less than 24 hours away. Requests the tutor never answered, and counter-offers you never answered, expire when the lesson time arrives.',
    source: 'backend/src/services/lifecycle.service.js (PAYMENT_DEADLINE_MINUTES = 60, PAYMENT_REMINDER_HOURS = 24)',
    reviewed: REVIEWED,
  },
  {
    id: 'faq.cancel-refund',
    topic: 'Cancelling and refunds (parent)',
    keywords: ['cancel', 'refund', 'money back', 'batal', 'pulangan', 'bayaran balik', '取消', '退款', '退钱'],
    answer: 'You can cancel a request before payment at no cost. If you cancel a paid lesson before it starts, the booking is cancelled and a refund request is sent to the WonderTutor admin team, who review it and decide the amount; it is not automatic. After a paid lesson has started or finished you can send a refund request with a reason (for example if you dispute the attendance); the admin team reviews it. An approved refund status means the request was approved; it does not by itself confirm the money has reached your bank.',
    source: 'backend/src/controllers/parent/bookings.controller.js#cancelBooking/requestRefund (type ADMIN_REVIEW)',
    reviewed: REVIEWED,
  },
  {
    id: 'faq.late-payment',
    topic: 'Paying after a booking was released',
    keywords: ['paid late', 'late payment', 'released', 'bayar lewat', '迟付款'],
    answer: 'If a payment arrives after the booking had already been cancelled or released, the lesson is not confirmed and a full refund is queued automatically.',
    source: 'backend/src/services/payment.service.js#settlePayment (refund type AUTO)',
    reviewed: REVIEWED,
  },
  {
    id: 'faq.match-score',
    topic: 'What the match percentage means',
    keywords: ['match', 'score', 'percentage', 'percent', 'ranking', 'rank', 'why', 'recommend', 'skor', 'peratus', '匹配', '分数', '排名'],
    answer: 'The match percentage is a compatibility score from fixed rules, not a prediction of how well your child will do. Tutors must first teach the subject at your child\'s level and grade. The score then weighs subject expertise 30%, education level 20%, availability 15%, location 15%, tutor characteristics (gender, language, teaching style) 10%, fee against your budget 5% and rating 5%. Verified tutors are listed before unverified ones; within that, higher scores come first, then more approved qualifications, then more experience. Preferences such as budget or gender lower the score but never hide a tutor.',
    source: 'backend/src/services/matching.service.js (WEIGHTS, rankTutors)',
    reviewed: REVIEWED,
  },
  {
    id: 'faq.availability',
    topic: 'Availability in the match score',
    keywords: ['available', 'availability', 'slot', 'free time', 'masa', '时间', '有空'],
    answer: 'The availability part of the score compares your preferred days and times with the tutor\'s weekly availability. It does not reserve a slot or guarantee that a particular date is still free; the booking page shows the slots that can actually be booked.',
    source: 'backend/src/services/matching.service.js#availabilityScore; booking.service.js#getTutorSlots',
    reviewed: REVIEWED,
  },
  {
    id: 'faq.location',
    topic: 'Location and distance',
    keywords: ['near', 'nearby', 'closer', 'distance', 'location', 'area', 'dekat', 'jarak', '附近', '距离'],
    answer: 'Location is 15% of the match score: tutors within about 3 km of the area you give score highest, then 8, 15 and 30 km bands. For online lessons distance does not matter. Distances are shown as bands because areas are known to within a few kilometres.',
    source: 'backend/src/services/matching.service.js#locationScore/distanceBand',
    reviewed: REVIEWED,
  },
  {
    id: 'faq.attendance',
    topic: 'Attendance records',
    keywords: ['attendance', 'check in', 'check-in', 'present', 'kehadiran', '出席', '打卡'],
    answer: 'For physical lessons the tutor checks in at the lesson location with a photo, and the Parent Portal shows the recorded check-in and check-out times. Online lessons only have a meeting link; there is no attendance tracking for them.',
    source: 'backend/src/controllers/parent/children.controller.js#childProgress; CLAUDE.md scope (online lessons)',
    reviewed: REVIEWED,
  },
  {
    id: 'faq.complaints',
    topic: 'Complaints',
    keywords: ['complain', 'complaint', 'report a problem', 'aduan', '投诉'],
    answer: 'You can file a complaint from the Complaints page, optionally about a specific booking. The admin team handles it and its status moves from Open to In progress and then Resolved or Dismissed; you can see the status and the admin team\'s reply on the same page.',
    source: 'backend/src/controllers/parent/complaints.controller.js; admin/complaints.controller.js',
    reviewed: REVIEWED,
  },
  {
    id: 'faq.reviews',
    topic: 'Reviews',
    keywords: ['review', 'rate', 'rating', 'star', 'ulasan', '评价', '评分'],
    answer: 'After a lesson is completed you can rate the tutor from 1 to 5 stars with an optional comment and photo. Each lesson can be reviewed once.',
    source: 'backend/src/controllers/parent/reviews.controller.js#createReview',
    reviewed: REVIEWED,
  },
  {
    id: 'faq.assistant-scope',
    topic: 'What the AI assistant can do',
    keywords: ['what can you do', 'help', 'book for me', 'cancel for me', 'pay for me', 'assistant', 'bantu', '帮我'],
    answer: 'This assistant can only look things up: your children\'s saved details, bookings, recorded lesson summaries and homework, payments and refunds, complaints, notifications, these policies, and tutor recommendations. It cannot book, cancel, pay, change profiles or file complaints; it can point you to the page where you do that yourself.',
    source: 'backend/src/services/assistant/tools.js (read-only allowlist)',
    reviewed: REVIEWED,
  },
]

// Things the project documents describe but the code does not (yet) enforce. The assistant must not state these.
export const OPEN_POLICY_QUESTIONS = [
  'CLAUDE.md lists automatic full refunds when a tutor cancels, fails check-in, or both sides agree before the session. The tutor-side cancellation/check-in features are not in this codebase yet, so the FAQ does not promise them.',
  'Partial-refund percentage is undecided (client open question); the admin decides the amount case by case.',
]

const norm = (s) => String(s || '').toLowerCase()

// Simple keyword scoring (no web, no model): returns up to `limit` entries, best first.
export function searchFaq(query, limit = 3) {
  const q = norm(query)
  const words = q.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2)
  const scored = FAQ.map((e) => {
    let score = 0
    for (const k of e.keywords) if (q.includes(norm(k))) score += 3
    const hay = norm(`${e.topic} ${e.answer}`)
    for (const w of words) if (hay.includes(w)) score += 1
    return { e, score }
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(({ e }) => e)
}
