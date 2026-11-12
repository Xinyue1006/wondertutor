import { reviewContentProblem, reviewFingerprint } from '../services/reviewContent.js'

test.each(['fuck', 'fuck!', 'f!u!c!k', 'f.u.c.k', 'f u c k', 'f**k', 'f\u200buck', 'b!tch', 'ＰＵＫＩＭＡＫ', 'pundek', '傻逼', '去死', 'I will kill you'])('screens common abuse and evasion: %s', (text) => {
  expect(reviewContentProblem(text)).toMatch(/abusive language|threats/)
})

test.each(['', 'The class was disappointing and the tutor was late. One star.', 'Please assess the classroom assignment.', 'She explained the classic method well.', '老师很有耐心，讲解清楚。', '老师迟到，教学质量不好。', 'Guru tidak menepati masa. Saya kecewa.', 'Scunthorpe is where our previous teacher lived.'])('allows ordinary words, criticism and multilingual feedback: %s', (text) => {
  expect(reviewContentProblem(text)).toBeNull()
})

test.each(['Call 012-3456789 for my classes', 'Contact me at parent@example.com', 'Visit https://spam.example.test', 'great '.repeat(9), 'a'.repeat(15)])('screens public contact information and obvious spam: %s', (text) => {
  expect(reviewContentProblem(text)).not.toBeNull()
})

test('fingerprints normalize case and formatting without changing stored review text', () => {
  expect(reviewFingerprint('A GOOD lesson!')).toBe(reviewFingerprint('a good lesson'))
})
