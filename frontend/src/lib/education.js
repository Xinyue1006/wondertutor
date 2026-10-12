// Education level / grade helpers shared by every Parent Portal page.
// Malaysian naming: Kindergarten 1-3, Primary 1-6, Secondary = Form 1-5.
export const LEVELS = [
  { value: 'KINDERGARTEN', label: 'Kindergarten', max: 3 },
  { value: 'PRIMARY', label: 'Primary', max: 6 },
  { value: 'SECONDARY', label: 'Form', max: 5 },
]

export const levelLabel = (level) => LEVELS.find((l) => l.value === level)?.label ?? level

// "Primary 5", "Form 2", "Kindergarten 1"
export const gradeLabel = (level, grade) => `${levelLabel(level)} ${grade}`

// All grade choices, grouped by level, for <optgroup> dropdowns. value = "PRIMARY:5"
export const GRADE_GROUPS = LEVELS.map((l) => ({
  label: l.label === 'Form' ? 'Secondary (Form)' : l.label,
  options: Array.from({ length: l.max }, (_, i) => ({ value: `${l.value}:${i + 1}`, label: gradeLabel(l.value, i + 1) })),
}))

export const parseGrade = (value) => {
  const [level, grade] = value.split(':')
  return { level, grade: Number(grade) }
}

export const SUBJECT_ICON_FALLBACK = 'Mathematics'

export const CHARACTERISTICS = ['Patient & Encouraging', 'Structured', 'Exam-Focused', 'Interactive']
