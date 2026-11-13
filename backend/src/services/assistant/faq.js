// Approved policy answers for the assistant (search_faq tool). The assistant may only state policies from here.
//
// Every entry was checked against the CODE that enforces it (source = file/function) on the review date. When the
// project documents (CLAUDE.md, reports) say more than the code does, the answer sticks to what the code does and the
// gap is recorded in OPEN_POLICY_QUESTIONS for the project owner. Bump FAQ_VERSION whenever an answer changes.
export const FAQ_VERSION = '2026-11-13.4'
const REVIEWED = '2026-11-09'

export const FAQ = [
  {
    id: 'faq.my-bookings',
    topic: 'Finding and managing bookings',
    keywords: ['my bookings', 'pending bookings', 'pending requests', 'cancelled bookings', 'declined bookings', 'view details', 'booking group', 'tempahan saya', '我的预约', '待处理预约'],
    answer: 'My Bookings opens Upcoming by default, showing confirmed future lessons and lessons in progress, with the nearest date first. Choose Pending for requests, counter-offers and lessons awaiting payment; Needs attention for past confirmed lessons that are not completed; Completed for completed or disputed lessons; Cancelled & declined for bookings that did not go ahead; or All for every group. On phones use the Booking group dropdown. Select View Details on a booking to see its full record and available actions, such as cancelling, rescheduling, reviewing a counter-offer, confirming a physical venue or leaving a review. The actions depend on the current booking status. New booking requests open Pending after submission. Each group initially shows up to five bookings. Use View more to show the next five, or Show fewer to collapse the group. Completed, cancelled and declined records show the newest lesson dates first in Recommended order; upcoming lessons show the nearest dates first. You can change the date sort.',
    source: 'frontend/src/pages/parent/MyBookings.jsx; frontend/src/pages/parent/BookLesson.jsx',
    reviewed: '2026-11-13',
  },
  {
    id: 'faq.missed-lesson',
    topic: 'Past paid lessons and missing attendance',
    keywords: ['missed lesson', 'no show', 'no-show', 'overdue', 'needs attention', 'lesson date has passed', 'lesson has passed', 'tidak hadir', 'kelas terlepas', '没来', '未上课', '过期课程'],
    answer: 'An unanswered request or unpaid accepted booking expires under the booking and payment deadlines. A paid confirmed lesson does not automatically expire, become completed, receive a refund or move to a new date just because its time has passed. If the lesson remains confirmed after its end, it appears in My Bookings under Needs attention. Open View Details to check the attendance and tutor report. Contact the tutor about a missing record and report a problem for administrator review if the lesson did not take place or attendance is missing. For a paid confirmed lesson that has started or ended, the details can offer Request a refund, which creates an administrator-reviewed request rather than paying money back immediately. Ordinary rescheduling after a lesson starts and backdated tutor check-in are not supported. No automatic missed-lesson refund or grace period has been established.',
    source: 'backend/src/services/lifecycle.service.js; backend/src/controllers/parent/bookings.controller.js#requestRefund; backend/src/services/reschedule.service.js; backend/src/services/lessonSession.service.js; frontend/src/pages/parent/MyBookings.jsx',
    reviewed: '2026-11-13',
  },
  {
    id: 'faq.review-moderation',
    topic: 'Reviews, inappropriate content and reporting',
    keywords: ['review', 'report review', 'abuse', 'offensive', 'profanity', 'spam', 'ulasan', 'kasar', '举报', '评价', '辱骂'],
    answer: 'Parents can review their own completed lessons once each. Honest criticism and low ratings are welcome. Public comments are checked for common abusive words, threats, contact details, links and repeated spam; these checks are limited and can make mistakes. Use a private complaint to quote or report abuse. On a tutor profile, choose Report this review to send a private report to administrators and track it in My Complaints. Reporting does not automatically hide content. An administrator investigates, records a reason and can hide or restore the review. Hidden reviews do not count in public ratings, and the author is notified.',
    source: 'backend/src/controllers/parent/reviews.controller.js; backend/src/controllers/admin/reviews.controller.js',
    reviewed: '2026-11-11',
  },
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
    answer: 'When you send a booking request you propose an hourly price. The tutor can accept it, reject it with a reason, or send a counter-offer. You can accept the counter-offer (the booking then waits for payment), propose a different price, decline it, or request administrator review. Sending a request does not confirm a lesson; payment is required after acceptance.',
    source: 'backend/src/controllers/parent/bookings.controller.js#acceptCounter/declineCounter/negotiate; backend/src/services/tutorBooking.service.js',
    reviewed: '2026-11-13',
  },
  {
    id: 'faq.payment-deadline',
    topic: 'Payment deadline',
    keywords: ['deadline', 'pay before', 'expire', 'expired', 'unpaid', 'bayar', 'tamat', '付款期限', '过期'],
    answer: 'A booking is confirmed only after payment. After acceptance you have up to 24 hours to pay, with a cutoff 1 hour before the lesson starts, whichever is earlier. If payment is still incomplete at that deadline, the booking is released. Older bookings without a recorded pay-by time use the 1-hour cutoff. One payment reminder is sent during the final 6 hours of the payment window. Requests the tutor never answered, and counter-offers you never answered, expire when the lesson time arrives.',
    source: 'backend/src/services/paymentWindow.js; backend/src/services/lifecycle.service.js (PAYMENT_WINDOW_HOURS = 24, PAYMENT_DEADLINE_MINUTES = 60, PAYMENT_REMINDER_HOURS = 6)',
    reviewed: '2026-11-13',
  },
  {
    id: 'faq.cancel-refund',
    topic: 'Cancelling and refunds (parent)',
    keywords: ['cancel', 'refund', 'money back', 'batal', 'pulangan', 'bayaran balik', '取消', '退款', '退钱'],
    answer: 'You can cancel a request before payment at no cost. If you cancel a paid lesson before it starts, the booking is cancelled and a refund request is sent to the WonderTutor admin team, who review it and decide the amount; it is not automatic. If the tutor cancels a paid lesson before it starts, a full refund request is queued automatically. After a paid lesson has started or finished you can send a refund request with a reason (for example if you dispute the attendance); the admin team reviews it. An approved refund status means the request was approved; it does not by itself confirm the money has reached your bank.',
    source: 'backend/src/controllers/parent/bookings.controller.js#cancelBooking/requestRefund (type ADMIN_REVIEW); backend/src/services/tutorBooking.service.js#tutorAction (type AUTO)',
    reviewed: '2026-11-13',
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
    answer: 'The availability part of the score compares your preferred days and times with the tutor\'s availability. It does not reserve a slot or guarantee that a particular date is still free. For an actual booking date, a one-date change takes priority, then a change for that week, then the usual weekly hours. The booking page checks the lesson mode and existing bookings and shows the slots that can actually be booked.',
    source: 'backend/src/services/matching.service.js#availabilityScore; booking.service.js#getTutorSlots',
    reviewed: REVIEWED,
  },
  {
    id: 'faq.location',
    topic: 'Location and distance',
    keywords: ['near', 'nearby', 'closer', 'distance', 'location', 'area', 'dekat', 'jarak', '附近', '距离'],
    answer: 'Location is 15% of the match score: tutors within about 3 km of the area you give score highest, then 8, 15 and 30 km bands. For online lessons distance does not matter. Matching uses approximate areas. For a physical booking, separately enter the full lesson address, choose the actual entrance pin and confirm it. This venue is shared with the selected tutor for that booking and does not change your matching area. Older physical bookings need their parent to confirm the venue in My Bookings before tutor GPS check-in.',
    source: 'backend/src/services/matching.service.js#locationScore/distanceBand; parent/bookings.controller.js#createBooking/updateLessonLocation',
    reviewed: '2026-11-13',
  },
  {
    id: 'faq.attendance',
    topic: 'Attendance records',
    keywords: ['attendance', 'check in', 'check-in', 'present', 'kehadiran', '出席', '打卡'],
    answer: 'For physical lessons the tutor checks in with a photo and GPS near the actual entrance pin explicitly confirmed by the parent on the booking. An approximate profile-area centre is not accepted as a confirmed venue. If an older physical booking needs confirmation, the parent must confirm it in My Bookings first. Online lessons have in-app check-in and check-out without a photo or GPS; these are tutor-recorded times, not proof that somebody joined a video call. The Parent Portal shows available recorded times. Older online lessons without an attendance record are shown as unavailable rather than marked absent.',
    source: 'backend/src/services/lessonSession.service.js; backend/src/controllers/parent/children.controller.js#childProgress',
    reviewed: '2026-11-13',
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
  'A final missed-lesson/late-report grace period and booking-closure workflow are undecided. Do not promise automatic expiry, completion, rescheduling or refunds for paid confirmed lessons solely because time passed.',
  'Tutor cancellation now queues a full refund request. Automatic refunds for failed check-in or mutual cancellation are not established by the current implementation; do not promise these or claim that a queued refund has reached the bank.',
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
