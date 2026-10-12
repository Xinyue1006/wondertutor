// Static lists shared by the browse filters, the matching wizard, the chatbot and the seed script.
// Kept in one place so the frontend dropdowns (served by GET /api/parent/catalog) never drift from the DB values.

export const SUBJECTS = [
  'Mathematics', 'English', 'Science', 'Bahasa Melayu', 'Chinese',
  'Additional Mathematics', 'Physics', 'Chemistry', 'Biology',
]

// Highest grade per level: Kindergarten 1-3, Primary 1-6, Secondary (Form) 1-5
export const MAX_GRADE = { KINDERGARTEN: 3, PRIMARY: 6, SECONDARY: 5 }

export const CHARACTERISTICS = ['Patient & Encouraging', 'Structured', 'Exam-Focused', 'Interactive']

// Klang Valley areas with coordinates. Distance scoring (location = 15% of the match score)
// needs lat/lng, and the client's #1 concern is "tutor close to my home".
export const LOCATIONS = [
  { name: 'Kepong, Kuala Lumpur', lat: 3.2087, lng: 101.6366 },
  { name: 'Mont Kiara, Kuala Lumpur', lat: 3.171, lng: 101.65 },
  { name: 'Damansara, Kuala Lumpur', lat: 3.15, lng: 101.66 },
  { name: 'Bangsar, Kuala Lumpur', lat: 3.129, lng: 101.671 },
  { name: 'Sri Petaling, Kuala Lumpur', lat: 3.077, lng: 101.69 },
  { name: 'Bukit Jalil, Kuala Lumpur', lat: 3.058, lng: 101.699 },
  { name: 'Cheras, Kuala Lumpur', lat: 3.107, lng: 101.728 },
  { name: 'Setapak, Kuala Lumpur', lat: 3.2, lng: 101.72 },
  { name: 'Wangsa Maju, Kuala Lumpur', lat: 3.2, lng: 101.735 },
  { name: 'Sentul, Kuala Lumpur', lat: 3.187, lng: 101.695 },
  { name: 'Ampang, Selangor', lat: 3.15, lng: 101.76 },
  { name: 'Petaling Jaya, Selangor', lat: 3.1073, lng: 101.6067 },
  { name: 'Subang Jaya, Selangor', lat: 3.0565, lng: 101.5851 },
  { name: 'Puchong, Selangor', lat: 3.0252, lng: 101.6177 },
  { name: 'Shah Alam, Selangor', lat: 3.0733, lng: 101.5185 },
  { name: 'Klang, Selangor', lat: 3.0449, lng: 101.4455 },
  { name: 'Kajang, Selangor', lat: 2.993, lng: 101.787 },
  { name: 'Cyberjaya, Selangor', lat: 2.9213, lng: 101.6559 },
  { name: 'Rawang, Selangor', lat: 3.32, lng: 101.57 },
  { name: 'Banting, Selangor', lat: 2.8167, lng: 101.5 },
]

export const findLocation = (name) => LOCATIONS.find((l) => l.name === name) || null
