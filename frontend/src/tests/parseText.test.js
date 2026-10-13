import { parseText } from '../assistant/parseText'

const catalog = {
  subjects: ['Mathematics', 'English', 'Science', 'Bahasa Melayu', 'Chinese', 'Additional Mathematics'],
  locations: ['Kepong, Kuala Lumpur', 'Mont Kiara, Kuala Lumpur', 'Banting, Selangor'],
}

// The chatbot's free-text reader is keyword based (not machine learning)
describe('chatbot free-text reader', () => {
  test('understands a full sentence', () => {
    const { found } = parseText('Maths for Primary 5, Mon and Fri evenings, physical, around Kepong, under RM70', catalog)
    expect(found).toMatchObject({
      subject: 'Mathematics', level: 'PRIMARY', grade: 5, days: [1, 5], mode: 'PHYSICAL',
      location: 'Kepong, Kuala Lumpur', timePreset: 'EVENING', budgetMax: 70,
    })
  })
  test('subject aliases and the longest name wins', () => {
    expect(parseText('need add maths help', catalog).found.subject).toBe('Additional Mathematics')
    expect(parseText('BM tutor please', catalog).found.subject).toBe('Bahasa Melayu')
    expect(parseText('mandarin', catalog).found.subject).toBe('Chinese')
  })
  test('levels: p5, form 2, kindergarten', () => {
    expect(parseText('my son is in p3', catalog).found).toMatchObject({ level: 'PRIMARY', grade: 3 })
    expect(parseText('form 2 science', catalog).found).toMatchObject({ level: 'SECONDARY', grade: 2, subject: 'Science' })
    expect(parseText('tadika', catalog).found.level).toBe('KINDERGARTEN')
  })
  test('weekends and weekdays', () => {
    expect(parseText('weekends', catalog).found.days).toEqual([0, 6])
    expect(parseText('weekdays', catalog).found.days).toEqual([1, 2, 3, 4, 5])
  })
  test('budget ranges and limits', () => {
    expect(parseText('RM40-80', catalog).found).toMatchObject({ budgetMin: 40, budgetMax: 80 })
    expect(parseText('budget of 60', catalog).found.budgetMax).toBe(60)
  })
  test('online and tutor gender', () => {
    expect(parseText('online lessons with a female tutor', catalog).found).toMatchObject({ mode: 'ONLINE', gender: 'FEMALE' })
  })
  test('teaching style keywords', () => {
    expect(parseText('someone patient and exam focused', catalog).found.characteristics).toEqual(['Patient & Encouraging', 'Exam-Focused'])
  })
  test('unrecognised text returns nothing (the bot then asks again)', () => {
    const { found, notes } = parseText('hello there', catalog)
    expect(found).toEqual({})
    expect(notes).toEqual([])
  })
})
