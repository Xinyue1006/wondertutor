// Automatic education-level progression (FR 1.9).
//
// The Malaysian school year runs January to December, so on 1 January every child moves up one grade:
//   Kindergarten 1 -> 2 -> 3 -> Primary 1 -> ... -> Primary 6 -> Secondary (Form) 1 -> ... -> Form 5.
// A child who has finished Form 5 stays there (the parent is told to update or remove the profile), because this
// platform has no level beyond secondary school.
//
// Each child stores `gradeYear`, the school year its grade is true for. A child is only moved while gradeYear is older
// than the current year, and gradeYear is stamped when it moves, so running this many times (the scheduler runs it every
// few minutes) never moves a child twice, and a server that was off on 1 January catches up the next time it runs.
// A parent who edits the grade (for example a child repeating a year) also stamps the current year, so the edit is kept.
import { prisma } from '../config/prisma.js'
import { MAX_GRADE, isSubjectAtLevel } from '../data/catalog.js'
import { subjectColumns, subjectsOf } from '../utils/childSubjects.js'
import { mytParts } from '../utils/time.js'
import { notify } from './notification.service.js'

const ORDER = ['KINDERGARTEN', 'PRIMARY', 'SECONDARY']
export const currentSchoolYear = (now = new Date()) => Number(mytParts(now).date.slice(0, 4))

export const gradeName = (level, grade) => (level === 'KINDERGARTEN' ? `Kindergarten ${grade}` : level === 'PRIMARY' ? `Primary ${grade}` : `Form ${grade}`)

// One school year later. Returns null when there is nowhere to go (finished Form 5).
export function nextGrade({ level, grade }) {
  if (grade < MAX_GRADE[level]) return { level, grade: grade + 1 }
  const next = ORDER[ORDER.indexOf(level) + 1]
  return next ? { level: next, grade: 1 } : null
}

// `years` school years later, stopping at the last grade. `finished` is true if it stopped early.
export function advanceBy({ level, grade }, years) {
  let at = { level, grade }
  for (let i = 0; i < years; i++) {
    const next = nextGrade(at)
    if (!next) return { ...at, finished: true }
    at = next
  }
  return { ...at, finished: false }
}

// Moves every child whose grade belongs to an earlier school year. `now` is a parameter so tests can set the date.
export async function promoteChildren(now = new Date()) {
  const year = currentSchoolYear(now)
  const due = await prisma.child.findMany({
    where: { OR: [{ gradeYear: null }, { gradeYear: { lt: year } }] },
    include: { parent: { select: { userId: true } } },
  })
  let moved = 0
  for (const child of due) {
    // A child with no year yet (made before this feature) is taken as correct for this year and only stamped
    if (child.gradeYear == null) {
      await prisma.child.updateMany({ where: { id: child.id, gradeYear: null }, data: { gradeYear: year } })
      continue
    }
    const to = advanceBy({ level: child.educationLevel, grade: child.grade }, year - child.gradeYear)
    const unchanged = to.level === child.educationLevel && to.grade === child.grade
    // Conditional on the old year: if two runs overlap, only one of them moves the child
    const data = { gradeYear: year }
    if (!unchanged) {
      // Subjects that do not exist at the new level are dropped (the list only grows going up, but this keeps it valid)
      Object.assign(data, { educationLevel: to.level, grade: to.grade }, subjectColumns(subjectsOf(child).filter((s) => isSubjectAtLevel(s, to.level))))
    }
    const { count } = await prisma.child.updateMany({ where: { id: child.id, gradeYear: child.gradeYear }, data })
    if (!count) continue

    if (!unchanged) {
      moved++
      await notify(child.parent.userId, {
        type: 'CHILD_PROMOTED',
        title: `${child.name} moved up to ${gradeName(to.level, to.grade)}`,
        message: `A new school year has started, so ${child.name}’s grade was updated from ${gradeName(child.educationLevel, child.grade)} to ${gradeName(to.level, to.grade)}. If this is not right (for example ${child.name} is repeating a year), you can change it in My Children.`,
        link: '/parent/children',
      })
    } else if (to.finished) {
      const link = `/parent/children?child=${child.id}`
      // Said once, not every January
      const told = await prisma.notification.findFirst({ where: { userId: child.parent.userId, type: 'CHILD_FINISHED', link } })
      if (!told) {
        await notify(child.parent.userId, {
          type: 'CHILD_FINISHED',
          title: `${child.name} has finished secondary school`,
          message: `${child.name} was in Form 5 last year, and WonderTutor covers up to Form 5. Please update ${child.name}’s profile if they are repeating, or remove it.`,
          link,
        })
      }
    }
  }
  return { moved }
}
