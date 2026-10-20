// Steps of the tutor profile setup and the check each one must pass before it is saved.
// Mirrors the server rules (controllers/tutor/profile.controller.js and missingForSubmit in tutorSetup.service.js).
import { checkHourlyRate, checkName, checkPhone, checkText, checkYears, isOwnUpload, normalizePhone } from './validation'

export const SETUP_STEPS = [
  { id: 'basic', label: 'Basic information' },
  { id: 'teaching', label: 'Teaching information' },
  { id: 'documents', label: 'Qualifications' },
  { id: 'photo', label: 'Photo and portfolio' },
  { id: 'review', label: 'Review and submit' },
]

// Returns the first problem in a step, or '' when it can be saved
export function checkStep(id, form, profile) {
  if (id === 'basic') {
    const problem = checkName(form.fullName) || checkPhone(form.phone)
      || (!form.gender && 'Choose your gender.')
      || checkName(form.emergencyContactName, 'Emergency contact name') || checkPhone(form.emergencyContactPhone, 'Emergency contact number')
    if (problem) return problem
    if (normalizePhone(form.phone) === normalizePhone(form.emergencyContactPhone)) return 'The emergency contact number must be different from your own number.'
    if (!form.location) return 'Choose your home area.'
  }
  if (id === 'teaching') {
    if (!form.subjects.length) return 'Add at least one subject you teach.'
    if (form.subjects.some((s) => !s.subject || !s.educationLevel || !s.minGrade || !s.maxGrade)) return 'Complete each subject row or remove it.'
    if (form.subjects.some((s) => s.minGrade > s.maxGrade)) return 'In each subject, the first grade must not be after the last grade.'
    const problem = checkHourlyRate(form.hourlyRate) || checkYears(form.yearsExperience)
    if (problem) return problem
    if (!form.offersPhysical && !form.offersOnline) return 'Choose physical, online or both.'
    if (form.bio.trim().length < 30) return 'Tell parents about yourself in at least 30 characters.'
    return checkText(form.bio, { label: 'About me', max: 2000 }) || checkText(form.teachingApproach, { label: 'Teaching approach', max: 2000 })
  }
  if (id === 'documents') {
    const usable = profile.documents.filter((d) => d.status !== 'REJECTED')
    if (!usable.some((d) => d.kind === 'IDENTITY')) return 'Upload your NRIC or passport.'
    if (!usable.some((d) => d.kind === 'QUALIFICATION')) return 'Upload at least one qualification.'
  }
  if (id === 'photo' && !isOwnUpload(profile.profilePhotoUrl)) return 'Upload a profile photo. Parents see it on your profile.'
  return ''
}

