// A child can need several subjects. Older child records only have one (`subject`), so both shapes are read here.
export const childSubjects = (child) => (Array.isArray(child?.subjects) && child.subjects.length ? child.subjects : child?.subject ? [child.subject] : [])

// The subjects that exist at a level (a Primary 3 child has no Physics). `levels` is the server's subjectLevels map:
// { Mathematics: ['KINDERGARTEN', 'PRIMARY', 'SECONDARY'], Physics: ['SECONDARY'], ... }
// Without a level, or if the server did not send the map, every subject is offered.
export function subjectsForLevel(subjects, levels, level) {
  if (!level || !levels) return subjects
  return subjects.filter((s) => levels[s]?.includes(level))
}

// After the level changes, drop the chosen subjects that do not exist at the new level
export const keepAllowed = (chosen, subjects, levels, level) => {
  const allowed = new Set(subjectsForLevel(subjects, levels, level))
  return (chosen || []).filter((s) => allowed.has(s))
}
