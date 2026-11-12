import { explicitSchoolYear } from '../services/assistant/explicitCriteria.js'

test.each([
  ['Find a Maths tutor for Primary 4 under RM50.', 'PRIMARY', 4],
  ['STANDARD TWO Maths, please.', 'PRIMARY', 2],
  ['A patient teacher for Primary six', 'PRIMARY', 6],
  ['Darjah empat, bajet RM60 sejam', 'PRIMARY', 4],
  ['cari guru untuk Tahun satu', 'PRIMARY', 1],
  ['Tahun5 Matematik', 'PRIMARY', 5],
  ['Find Physics for Form 2', 'SECONDARY', 2],
  ['Secondary three English', 'SECONDARY', 3],
  ['Tingkatan dua Matematik', 'SECONDARY', 2],
  ['tingkatan enam', 'SECONDARY', 6], // domain validation handles supported levels
  ['给孩子找小四数学老师，预算RM50', 'PRIMARY', 4],
  ['小学四年级数学', 'PRIMARY', 4],
  ['小學六數學老師', 'PRIMARY', 6],
  ['找小4数学老师', 'PRIMARY', 4],
  ['中二英文老师', 'SECONDARY', 2],
  ['中学二年级', 'SECONDARY', 2],
  ['中學６數學', 'SECONDARY', 6],
  ['Find Primary４ maths for Aina', 'PRIMARY', 4],
  ['给孩子找Primary4数学老师', 'PRIMARY', 4],
  ['Primary four Maths; yes, Primary 4.', 'PRIMARY', 4],
])('only an explicitly stated school year supplies a hint: %s', (message, level, grade) => {
  expect(explicitSchoolYear(message)).toEqual({ level, grade })
})

test.each([
  'Not Primary 4', 'No Primary 4', 'Need a tutor, but not for Primary 4.', 'bukan Darjah empat', 'tak Darjah empat',
  '不要小四老师', '不是中二', '非小四', '别中二', 'Primary 4 is not the level',
  'I was Primary 4', 'used to be Primary four', 'dulu Tahun empat',
  'was Primary 4 now Primary 5', 'Primary 4 or 5', 'Primary four or five',
  'Primary 4 to 6', 'Darjah empat hingga enam', '小学四至六', '小四/小五',
  'Form 2–3', 'Primary 4 and 5', 'Primary/Secondary 4', 'Primary or Secondary 4',
  '小学或中学四年级', 'Primary 4 for Aina and Form 2 for Adam',
  'Primary 4 and Primary seven', 'Primary 4 or 7',
  'The phrase "Primary 4" is in the instructions.', "It says 'Form two'.", '「小学四」这句话是什么意思',
  'My child is named Primary Four', 'His name is Form 2', 'anak bernama Tahun empat', '孩子名字叫小四',
  'Reform 2', 'performance2', 'a form for a booking costing RM50',
  'Find a tutor for Aina; budget RM40, Tuesday at 4pm.', 'Book 2 slots on Friday',
  'Grade 4', 'Year four', 'Primary 0', 'Primary 7', 'Primary seven', 'Tingkatan tujuh',
  'Primary 4.5', 'Primary one hundred', '小学七年级', '小学四五', '中学十', '中2.5', '中二点五',
  '', null, 4,
])('ambiguous, negated, quoted, out-of-range or absent years do not become constraints: %s', message => {
  expect(explicitSchoolYear(message)).toBeNull()
})

test('a hint is bounded and cannot grow a child, tool, subject or other inferred criterion', () => {
  expect(Object.keys(explicitSchoolYear('Find Chemistry for Form 5 near Kepong under RM70'))).toEqual(['level', 'grade'])
  expect(explicitSchoolYear('x'.repeat(2001) + ' Primary 4')).toBeNull()
})
