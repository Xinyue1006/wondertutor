import { screenModelProse } from '../services/assistant/answers.js'

const session = { refs: new Map() }

test.each([
  'Heyo! How can I help you today?',
  'Hey there! How can I help you with your tutoring needs today?',
  "Hey there! How can I help you with your child's tutoring today?",
  'I can help you find tutors or check your lessons, homework and payments.',
  "Which child's homework would you like to check?",
  'Saya boleh membantu mencari tutor atau menyemak kelas dan bayaran anda.',
  '我可以帮你查询课程、作业和付款。你想先了解什么？',
])('safe guidance about features is not mistaken for a record claim: %s', text => {
  expect(screenModelProse(text, session)).toEqual({ ok: true })
})

test.each([
  'Your homework is about fractions.',
  'What homework you have is about fractions.',
  'I can help you; your homework is fractions.',
  'I can check your homework: it is fractions.',
  "I can check your child's homework is about teachers.",
  'I can check your homework is about tutors.',
  'I can help because your lessons are free.',
  'How can I help you with your homework; it is fractions?',
  'How can I help you with your refund arriving soon today?',
  'Your next lesson is tomorrow.',
  'I can help with your payments. Your refund has been approved.',
  'Which confirmed lesson do you mean?',
  'How can I help you with your approved refund today?',
  'I can help check your RM50 payment.',
  'I have booked your lesson.',
  '我可以帮你查看已批准的退款。',
  'Saya boleh semak bayaran yang sudah diluluskan.',
])('guidance allowance still rejects invented facts and action claims: %s', text => {
  expect(screenModelProse(text, session).ok).toBe(false)
})
