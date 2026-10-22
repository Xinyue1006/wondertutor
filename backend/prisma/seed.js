// Run with: npm run db:seed   (or `npx prisma migrate reset` to wipe + reseed from scratch)
//
// Seeds: system settings, the admin account, 16 sample Malaysian tutors (Klang Valley), review history,
// and one demo parent with children + bookings in every state so every Parent Portal screen has data.
// Safe to run more than once: the demo block is skipped if the demo parent already exists.
import bcrypt from 'bcrypt'
import { PrismaClient } from '@prisma/client'
import { addDays, mytParts, mytToDate, todayMyt } from '../src/utils/time.js'
import { findLocation } from '../src/data/catalog.js'

const prisma = new PrismaClient()

const DEMO_PARENT = { email: 'parent@wondertutor.local', password: 'Parent1234' }
const TUTOR_PASSWORD = 'Tutor1234'

// ───────────── helpers ─────────────
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

// "Mon 18-20, Wed 14-18, Sat 10-12" -> AvailabilitySlot rows
function slots(text) {
  return text.split(',').map((part) => {
    const [day, range] = part.trim().split(' ')
    const [s, e] = range.split('-')
    return { dayOfWeek: DOW[day], startTime: `${s.padStart(2, '0')}:00`, endTime: `${e.padStart(2, '0')}:00` }
  })
}

// The next calendar date (Malaysia time) that falls on `day`, at least `minDays` days from today
function nextDate(day, minDays = 1) {
  let d = addDays(todayMyt(), minDays)
  while (mytParts(mytToDate(d, '12:00')).dow !== DOW[day]) d = addDays(d, 1)
  return d
}

const at = (date, hhmm) => mytToDate(date, hhmm)
const daysAgo = (n, hhmm) => mytToDate(addDays(todayMyt(), -n), hhmm)

// Deterministic pseudo-random so re-seeding gives the same data
function rng(seed) {
  let s = seed
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
}

// ───────────── tutor data ─────────────
const APPROACH_DEFAULT = [
  'Clear and structured explanations',
  'Step-by-step guided practice',
  'Patient and encouraging',
  'Use of real-life examples',
  'Regular progress feedback to parents',
].join('\n')

const TUTORS = [
  {
    key: 'tan-hui-wen', name: 'Ms. Tan Hui Wen', gender: 'FEMALE', rate: 50, rating: 4.9, count: 120, years: 4, loc: 'Kepong, Kuala Lumpur', verified: true,
    online: true, physical: true, chars: ['Structured'],
    subjects: [['Mathematics', 'PRIMARY', 4, 6], ['Science', 'PRIMARY', 3, 6]],
    avail: 'Mon 16-20, Wed 16-20, Fri 15-20',
    qual: ['Bachelor of Education (Mathematics)', 'Universiti Pendidikan Sultan Idris (UPSI)', 2021],
    bio: 'Primary school specialist who makes Mathematics and Science feel simple. I break every topic into small, clear steps so students stop guessing and start understanding.',
  },
  {
    key: 'daniel-tan', name: 'Daniel Tan', gender: 'MALE', rate: 60, rating: 4.9, count: 128, years: 5, loc: 'Kepong, Kuala Lumpur', verified: true,
    online: true, physical: true, chars: ['Patient & Encouraging', 'Structured'],
    subjects: [['Mathematics', 'PRIMARY', 5, 6], ['Mathematics', 'SECONDARY', 1, 3]],
    avail: 'Tue 14-20, Thu 14-20, Sat 10-12, Sat 14-17',
    qual: ['Bachelor of Science (Mathematics)', 'University of Malaya (UM)', 2020],
    bio: 'Passionate and patient tutor with 4+ years of experience in helping primary and secondary students build confidence in Mathematics. Focused on clear explanations, step-by-step guidance and personalised learning based on each student\'s pace.',
    about: 'Hi! I\'m Daniel Tan, a passionate Mathematics tutor who believes that every student can excel with the right guidance and support. I aim to make Math simple, interesting and less stressful through clear explanations, real-life examples and step-by-step practice. I tailor my teaching approach to each student\'s learning style and pace to help them build strong foundations and confidence.',
    approach: ['Clear and structured explanations', 'Step-by-step guided practice', 'Patient and encouraging', 'Use of real-life examples', 'Focus on concept understanding', 'Regular progress feedback to parents'].join('\n'),
    achievements: ['Consistently positive feedback from parents', 'Helped students improve from C to A', 'Experienced with KSSR & KSSM syllabus'],
  },
  {
    key: 'lee-xin-yi', name: 'Ms. Lee Xin Yi', gender: 'FEMALE', rate: 55, rating: 4.7, count: 86, years: 4, loc: 'Mont Kiara, Kuala Lumpur', verified: true,
    online: true, physical: true, chars: ['Interactive', 'Patient & Encouraging'],
    subjects: [['Mathematics', 'PRIMARY', 1, 6], ['English', 'PRIMARY', 1, 6]],
    avail: 'Mon 15-20, Tue 15-20, Thu 15-20',
    qual: ['Bachelor of Arts (English Language)', 'Universiti Putra Malaysia (UPM)', 2020],
    bio: 'Friendly English and Mathematics tutor for primary pupils. Lessons are interactive, with games and stories that keep young learners curious.',
  },
  {
    key: 'wong-zi-yang', name: 'Mr. Wong Zi Yang', gender: 'MALE', rate: 65, rating: 4.8, count: 72, years: 3, loc: 'Kepong, Kuala Lumpur', verified: true,
    online: true, physical: true, chars: ['Exam-Focused'],
    subjects: [['Mathematics', 'PRIMARY', 5, 6], ['Mathematics', 'SECONDARY', 1, 5]],
    avail: 'Mon 18-21, Wed 18-21, Fri 18-21, Sun 10-13',
    qual: ['Bachelor of Engineering (Civil)', 'Universiti Teknologi Malaysia (UTM)', 2021],
    bio: 'Exam-focused Mathematics tutor. I train students with past-year questions and show them the marking-scheme tricks that save marks in UPSR-style and SPM-style papers.',
  },
  {
    key: 'chong-rui-en', name: 'Ms. Chong Rui En', gender: 'FEMALE', rate: 45, rating: 4.6, count: 58, years: 2, loc: 'Sri Petaling, Kuala Lumpur', verified: false,
    online: true, physical: true, chars: ['Patient & Encouraging'],
    subjects: [['Mathematics', 'PRIMARY', 1, 6]],
    avail: 'Tue 16-20, Thu 16-20, Sat 09-13',
    qual: ['Diploma in Education', 'Tunku Abdul Rahman University of Management and Technology (TAR UMT)', 2022],
    bio: 'Gentle, patient tutor who helps shy students open up. Great for children who need a confidence boost in Mathematics.',
  },
  {
    key: 'lim-kai-zheng', name: 'Mr. Lim Kai Zheng', gender: 'MALE', rate: 70, rating: 4.9, count: 102, years: 6, loc: 'Damansara, Kuala Lumpur', verified: true,
    online: true, physical: true, chars: ['Exam-Focused', 'Structured'],
    subjects: [['Mathematics', 'PRIMARY', 5, 6], ['Mathematics', 'SECONDARY', 1, 5], ['Additional Mathematics', 'SECONDARY', 4, 5], ['Physics', 'SECONDARY', 4, 5], ['Computer Science', 'SECONDARY', 1, 5]],
    avail: 'Mon 17-21, Wed 17-21, Fri 17-21, Sat 09-12',
    qual: ['Master of Science (Applied Mathematics)', 'Universiti Kebangsaan Malaysia (UKM)', 2018],
    bio: 'Six years of coaching SPM candidates. I specialise in Mathematics, Additional Mathematics and Physics, with a structured weekly plan for every student.',
  },
  {
    key: 'lim-jia-hui', name: 'Ms. Lim Jia Hui', gender: 'FEMALE', rate: 50, rating: 4.7, count: 67, years: 3, loc: 'Cheras, Kuala Lumpur', verified: false,
    online: true, physical: true, chars: ['Interactive'],
    subjects: [['Mathematics', 'PRIMARY', 3, 6]],
    avail: 'Mon 16-20, Tue 16-20, Thu 16-20, Sun 10-14',
    qual: ['Bachelor of Education (Primary)', 'Institut Pendidikan Guru Kampus Cheras', 2021],
    bio: 'Former tuition-centre teacher who now tutors one-to-one. I use worksheets and mental-maths games to build speed and accuracy.',
  },
  {
    key: 'tee-jun-hao', name: 'Mr. Tee Jun Hao', gender: 'MALE', rate: 55, rating: 4.6, count: 49, years: 2, loc: 'Bangsar, Kuala Lumpur', verified: false,
    online: true, physical: true, chars: ['Interactive'],
    subjects: [['Mathematics', 'PRIMARY', 4, 6], ['Mathematics', 'SECONDARY', 1, 3], ['Principles of Accounting', 'SECONDARY', 4, 5], ['Economics', 'SECONDARY', 4, 5], ['Business', 'SECONDARY', 4, 5]],
    avail: 'Tue 17-21, Thu 17-21, Sat 14-18',
    qual: ['Bachelor of Science (Actuarial Science)', 'Sunway University', 2023],
    bio: 'Young, energetic tutor who explains Mathematics with everyday examples. Lessons feel like a conversation, not a lecture.',
  },
  {
    key: 'ng-yi-ling', name: 'Ms. Ng Yi Ling', gender: 'FEMALE', rate: 60, rating: 4.8, count: 90, years: 5, loc: 'Subang Jaya, Selangor', verified: true,
    online: true, physical: true, chars: ['Patient & Encouraging', 'Interactive'],
    subjects: [['Mathematics', 'PRIMARY', 1, 6], ['Science', 'PRIMARY', 1, 6]],
    avail: 'Mon 15-19, Wed 15-19, Fri 15-19, Sat 09-12',
    qual: ['Bachelor of Education (Mathematics & Science)', 'Universiti Malaya (UM)', 2019],
    bio: 'Five years of teaching experience in a national school. I know the KSSR syllabus inside out and focus on building strong fundamentals.',
  },
  {
    key: 'cheng-wei-lun', name: 'Mr. Cheng Wei Lun', gender: 'MALE', rate: 55, rating: 4.6, count: 64, years: 4, loc: 'Kepong, Kuala Lumpur', verified: false,
    online: true, physical: true, chars: ['Structured'],
    subjects: [['Mathematics', 'PRIMARY', 4, 6]],
    avail: 'Tue 18-21, Thu 18-21, Sun 09-13',
    qual: ['Bachelor of Science (Statistics)', 'Universiti Sains Malaysia (USM)', 2020],
    bio: 'Structured lessons with a clear plan each week. Parents receive a short progress note after every session.',
  },
  {
    key: 'wong-su-lin', name: 'Ms. Wong Su Lin', gender: 'FEMALE', rate: 50, rating: 4.6, count: 58, years: 3, loc: 'Sri Petaling, Kuala Lumpur', verified: false,
    online: true, physical: true, chars: ['Exam-Focused'],
    subjects: [['Mathematics', 'PRIMARY', 4, 6]],
    avail: 'Mon 17-20, Wed 17-20, Sat 10-14',
    qual: ['Bachelor of Education (Mathematics)', 'Universiti Pendidikan Sultan Idris (UPSI)', 2021],
    bio: 'Helps Year 4-6 pupils prepare for school exams with targeted practice and clear revision notes.',
  },
  {
    key: 'ahmad-faiz', name: 'Mr. Ahmad Faiz bin Hakim', gender: 'MALE', rate: 40, rating: 4.5, count: 31, years: 3, loc: 'Shah Alam, Selangor', verified: false,
    online: false, physical: true, chars: ['Patient & Encouraging'],
    subjects: [['Bahasa Melayu', 'PRIMARY', 1, 6], ['Bahasa Melayu', 'SECONDARY', 1, 3], ['History', 'PRIMARY', 4, 6], ['History', 'SECONDARY', 1, 5]],
    avail: 'Tue 16-20, Thu 16-20, Sat 09-13',
    qual: ['Bachelor of Education (Bahasa Melayu)', 'Universiti Teknologi MARA (UiTM)', 2021],
    bio: 'Bahasa Melayu tutor focused on karangan (essay) writing and tatabahasa, from Year 1 to Form 3.',
  },
  {
    key: 'nurul-aisyah', name: 'Ms. Nurul Aisyah', gender: 'FEMALE', rate: 45, rating: 4.8, count: 44, years: 4, loc: 'Puchong, Selangor', verified: true,
    online: true, physical: true, chars: ['Interactive', 'Patient & Encouraging'],
    subjects: [['English', 'KINDERGARTEN', 1, 3], ['English', 'PRIMARY', 1, 6]],
    avail: 'Mon 14-19, Wed 14-19, Fri 14-19, Sat 09-12',
    qual: ['Bachelor of Arts (TESL)', 'Universiti Putra Malaysia (UPM)', 2020],
    bio: 'TESL-trained tutor for young learners. Phonics, reading and storytelling make English fun from kindergarten onwards.',
  },
  {
    key: 'kumar-raj', name: 'Mr. Kumar Raj', gender: 'MALE', rate: 70, rating: 4.7, count: 52, years: 7, loc: 'Petaling Jaya, Selangor', verified: true,
    online: true, physical: true, chars: ['Structured', 'Exam-Focused'],
    subjects: [['Science', 'SECONDARY', 1, 3], ['Physics', 'SECONDARY', 4, 5], ['Chemistry', 'SECONDARY', 4, 5]],
    avail: 'Mon 18-21, Tue 18-21, Thu 18-21, Sun 10-14',
    qual: ['Bachelor of Science (Chemistry)', 'Universiti Malaya (UM)', 2016],
    bio: 'Seven years of teaching Science, Physics and Chemistry. Experiments explained simply, then drilled with exam-style questions.',
  },
  {
    key: 'chen-mei-ling', name: 'Ms. Chen Mei Ling', gender: 'FEMALE', rate: 48, rating: 4.9, count: 37, years: 5, loc: 'Cheras, Kuala Lumpur', verified: true,
    online: true, physical: false, chars: ['Patient & Encouraging', 'Interactive'],
    subjects: [['Chinese', 'KINDERGARTEN', 1, 3], ['Chinese', 'PRIMARY', 1, 6]],
    avail: 'Tue 15-20, Thu 15-20, Sat 09-13, Sun 09-13',
    qual: ['Bachelor of Arts (Chinese Studies)', 'Universiti Malaya (UM)', 2019],
    bio: 'Online Chinese tutor for kindergarten and primary pupils, using pinyin games, picture books and daily-life conversation.',
  },
  {
    key: 'rachel-lim', name: 'Ms. Rachel Lim', gender: 'FEMALE', rate: 80, rating: 4.8, count: 29, years: 6, loc: 'Mont Kiara, Kuala Lumpur', verified: true,
    online: true, physical: false, chars: ['Exam-Focused', 'Structured'],
    subjects: [['Biology', 'SECONDARY', 4, 5], ['Chemistry', 'SECONDARY', 4, 5], ['Science', 'SECONDARY', 1, 3]],
    avail: 'Mon 19-22, Wed 19-22, Sat 10-14',
    qual: ['Master of Science (Biochemistry)', 'Monash University Malaysia', 2017],
    bio: 'SPM Biology and Chemistry coach who teaches students how to answer structured questions with full marks.',
  },
]

const REVIEW_COMMENTS = [
  'Very patient and explains concepts clearly. My child used to struggle with problem sums but now feels more confident.',
  'Very good tutor! My child\'s results improved from C to A-. Lessons are well structured and easy to understand.',
  'My child likes his teaching style. He uses real-life examples which make the subject more interesting.',
  'Clear explanations and step-by-step guidance. My child is more confident in answering questions now. Appreciate the regular updates after each lesson.',
  'Good and responsible tutor. My child finds the lessons helpful and easier to understand. Sometimes the lesson timing needs to be adjusted, but overall a positive experience.',
  'Always punctual and well prepared. Gives extra practice questions and goes through mistakes patiently.',
  'Highly recommended. My child now looks forward to every lesson.',
  'Friendly, professional and very encouraging. We saw improvement within a month.',
  'Good teacher. Lessons are engaging and my child is not afraid to ask questions anymore.',
  'Reliable and caring. Shares helpful tips for revision at home.',
]

// Parents who left the historical reviews (the "Reviews from Parents" section)
const REVIEW_PARENTS = [
  ['Siti Hanim', [['Aiman', 'PRIMARY', 5]]],
  ['Lee Mei Fung', [['Jun Wei', 'SECONDARY', 1]]],
  ['Tan Wei Ling', [['Chloe', 'PRIMARY', 6]]],
  ['Koh Siew Fern', [['Ethan', 'PRIMARY', 5]]],
  ['Chong Mei Yen', [['Kai Xin', 'SECONDARY', 1], ['Mei Xuan', 'KINDERGARTEN', 2]]],
  ['Nur Aina', [['Irfan', 'PRIMARY', 4]]],
  ['Rajesh Nair', [['Arjun', 'SECONDARY', 4], ['Priya', 'PRIMARY', 3]]],
  ['Michelle Ong', [['Zachary', 'PRIMARY', 2], ['Zoe', 'PRIMARY', 6]]],
]

// ───────────── main ─────────────
async function seedBasics() {
  // On a live site the admin login must be chosen by the owner: never fall back to the published demo password
  if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) {
    console.error('Refusing to seed in production without ADMIN_PASSWORD (and ADMIN_EMAIL). Set them in the environment variables first.')
    process.exit(1)
  }
  const settings = {
    GPS_RADIUS_METRES: '100',
    RATING_THRESHOLD: '3.0',
    BASE_COMMISSION_RATE: '10', // percent: placeholder until the client confirms
  }
  for (const [key, value] of Object.entries(settings)) {
    await prisma.systemSetting.upsert({ where: { key }, update: {}, create: { key, value } })
  }
  // On a live site set ADMIN_EMAIL and ADMIN_PASSWORD so the admin does not use the published demo login
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@wondertutor.local'
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin1234', 12),
      role: 'ADMIN',
      fullName: 'WonderTutor Admin',
      isEmailVerified: true,
    },
  })
}

async function seedTutors(hash) {
  const created = {}
  for (const t of TUTORS) {
    const email = `${t.key}@tutor.wondertutor.local`
    const loc = findLocation(t.loc)
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: hash,
        role: 'TUTOR',
        fullName: t.name,
        phone: '+60123456789',
        profilePhotoUrl: ['ahmad-faiz', 'nurul-aisyah', 'kumar-raj', 'chen-mei-ling', 'rachel-lim'].includes(t.key) ? null : `/img/people/${t.key}.jpg`,
        isEmailVerified: true,
        tutor: {
          create: {
            gender: t.gender,
            emergencyContactName: 'Family Contact',
            emergencyContactPhone: '+60129876543',
            bio: t.bio,
            teachingApproach: t.approach || APPROACH_DEFAULT,
            characteristics: t.chars,
            languages: ['English', 'Bahasa Melayu'],
            achievements: t.achievements || ['Consistently positive feedback from parents', 'Experienced with KSSR & KSSM syllabus'],
            yearsExperience: t.years,
            hourlyRate: t.rate,
            location: t.loc,
            latitude: loc.lat,
            longitude: loc.lng,
            offersOnline: t.online,
            offersPhysical: t.physical,
            isVerified: t.verified,
            verificationSubmittedAt: new Date(),
            subjects: { create: t.subjects.map(([subject, educationLevel, minGrade, maxGrade]) => ({ subject, educationLevel, minGrade, maxGrade })) },
            availability: { create: slots(t.avail) },
            qualifications: {
              // Verified tutors have an approved identity document and qualification, the two things Admin checks
              create: [
                { kind: 'IDENTITY', title: 'NRIC', documentUrl: 'seed://sample-nric', status: t.verified ? 'APPROVED' : 'PENDING' },
                { title: t.qual[0], institution: t.qual[1], year: t.qual[2], documentUrl: 'seed://sample-certificate', status: 'APPROVED' },
              ],
            },
          },
        },
      },
      include: { tutor: true },
    })
    created[t.key] = user.tutor
  }
  return created
}

// Review history: every review hangs off a completed booking (one review per booking)
async function seedReviewHistory(tutors, hash) {
  const children = []
  for (const [i, [name, kids]] of REVIEW_PARENTS.entries()) {
    const user = await prisma.user.create({
      data: {
        email: `reviewer${i + 1}@seed.wondertutor.local`,
        passwordHash: hash,
        role: 'PARENT',
        fullName: name,
        isEmailVerified: true,
        parent: { create: { children: { create: kids.map(([n, educationLevel, grade]) => ({ name: n, educationLevel, grade })) } } },
      },
      include: { parent: { include: { children: true } } },
    })
    for (const c of user.parent.children) children.push({ parentId: user.parent.id, child: c })
  }

  const rand = rng(42)
  for (const t of TUTORS) {
    const tutor = tutors[t.key]
    const rows = []
    for (const [subject, level, min, max] of t.subjects) {
      for (const pc of children) {
        if (pc.child.educationLevel === level && pc.child.grade >= min && pc.child.grade <= max) rows.push({ subject, ...pc })
      }
    }
    if (!rows.length) continue

    // Ratings that average to the target (e.g. 4.9 over 128 reviews): start at 5 stars and lower a few
    const ratings = Array(t.count).fill(5)
    let deficit = Math.round(5 * t.count - t.rating * t.count)
    while (deficit > 0) {
      const i = Math.floor(rand() * t.count)
      if (ratings[i] > 3) { ratings[i]--; deficit-- }
    }

    for (let i = 0; i < t.count; i++) {
      const r = rows[i % rows.length]
      const when = daysAgo(8 + Math.floor((i / t.count) * 700) + Math.floor(rand() * 5), '17:00')
      await prisma.booking.create({
        data: {
          parentId: r.parentId, childId: r.child.id, tutorId: tutor.id,
          subject: r.subject,
          startAt: when, endAt: new Date(when.getTime() + 3600000),
          teachingMode: 'ONLINE', proposedPrice: t.rate, agreedPrice: t.rate, status: 'COMPLETED',
          createdAt: when,
          review: {
            create: {
              parentId: r.parentId, tutorId: tutor.id, rating: ratings[i],
              comment: i < 12 || rand() > 0.35 ? REVIEW_COMMENTS[(i + t.key.length) % REVIEW_COMMENTS.length] : null,
              createdAt: new Date(when.getTime() + 86400000),
            },
          },
        },
      })
    }
  }
}

async function seedDemoParent(tutors, hash) {
  const home = findLocation('Kepong, Kuala Lumpur')
  const user = await prisma.user.create({
    data: {
      email: DEMO_PARENT.email,
      passwordHash: hash,
      role: 'PARENT',
      fullName: 'Tan Xin Yue',
      phone: '+60123456780',
      profilePhotoUrl: '/img/people/parent-tan-xin-yue.jpg',
      isEmailVerified: true,
      parent: { create: { address: home.name, latitude: home.lat, longitude: home.lng } },
    },
    include: { parent: true },
  })
  const parentId = user.parent.id
  const sarah = await prisma.child.create({ data: { parentId, name: 'Sarah Tan', educationLevel: 'PRIMARY', grade: 5, subject: 'Mathematics', subjects: ['Mathematics', 'Science', 'English'], photoUrl: '/img/people/sarah-tan.jpg' } })
  const adam = await prisma.child.create({ data: { parentId, name: 'Adam Tan', educationLevel: 'PRIMARY', grade: 2, subject: 'English', subjects: ['English', 'Mathematics'], photoUrl: '/img/people/adam-tan.jpg' } })

  const T = (key) => tutors[key]
  const rateOf = Object.fromEntries(TUTORS.map((t) => [t.key, t.rate]))
  const base = { parentId, location: home.name, latitude: home.lat, longitude: home.lng }

  const mk = (data) => prisma.booking.create({ data: { ...base, ...data } })

  // ── Upcoming (CONFIRMED + paid) ──
  const tue = nextDate('Tue')
  const up1 = await mk({
    childId: sarah.id, tutorId: T('daniel-tan').id, subject: 'Mathematics', teachingMode: 'ONLINE', location: null, latitude: null, longitude: null,
    meetingLink: 'https://meet.google.com/demo-wonder-tutor',
    startAt: at(tue, '18:00'), endAt: at(tue, '19:00'), proposedPrice: 60, agreedPrice: 60, status: 'CONFIRMED',
  })
  const mon = nextDate('Mon')
  const up2 = await mk({
    childId: sarah.id, tutorId: T('lee-xin-yi').id, subject: 'English', teachingMode: 'ONLINE', location: null, latitude: null, longitude: null,
    meetingLink: 'https://zoom.us/j/0000000000',
    startAt: at(mon, '16:00'), endAt: at(mon, '17:00'), proposedPrice: 55, agreedPrice: 55, status: 'CONFIRMED',
  })

  // ── Pending / counter offer / awaiting payment ──
  const sat = nextDate('Sat')
  await mk({
    childId: sarah.id, tutorId: T('daniel-tan').id, subject: 'Mathematics', teachingMode: 'ONLINE', location: null, latitude: null, longitude: null,
    startAt: at(sat, '14:00'), endAt: at(sat, '15:00'), proposedPrice: 60, status: 'PENDING',
    messageToTutor: 'Hi! My child would like to focus on exam preparation. Please let me know if this time works for you.',
    createdAt: daysAgo(0, '10:24'),
  })
  const wed = nextDate('Wed')
  await mk({
    childId: sarah.id, tutorId: T('tan-hui-wen').id, subject: 'Mathematics', teachingMode: 'PHYSICAL',
    startAt: at(wed, '18:00'), endAt: at(wed, '19:00'), proposedPrice: 45, counterPrice: 50, status: 'COUNTER_OFFERED',
    messageToTutor: 'I can conduct the lesson at RM50/hour. Please let me know if this works for you.',
    createdAt: daysAgo(1, '15:00'),
  })
  const thu = nextDate('Thu')
  const pay = await mk({
    childId: sarah.id, tutorId: T('daniel-tan').id, subject: 'Mathematics', teachingMode: 'PHYSICAL',
    startAt: at(thu, '18:00'), endAt: at(thu, '20:00'), proposedPrice: 40, agreedPrice: 40, status: 'AWAITING_PAYMENT',
    createdAt: daysAgo(2, '09:00'),
  })

  // ── Completed history (8) ──
  const history = [
    { d: 3, key: 'lim-kai-zheng', subject: 'Mathematics', child: sarah, mode: 'ONLINE', start: '19:00', mins: 60, price: 55 },
    { d: 6, key: 'wong-zi-yang', subject: 'Mathematics', child: sarah, mode: 'PHYSICAL', start: '19:00', mins: 60, price: 65, review: [5, 'Very clear explanations and great exam tips. Sarah is much more confident now.'] },
    { d: 9, key: 'daniel-tan', subject: 'Mathematics', child: sarah, mode: 'PHYSICAL', start: '18:00', mins: 120, price: 40 },
    { d: 13, key: 'lee-xin-yi', subject: 'English', child: sarah, mode: 'ONLINE', start: '16:00', mins: 90, price: 40 },
    { d: 17, key: 'tan-hui-wen', subject: 'Science', child: sarah, mode: 'PHYSICAL', start: '18:00', mins: 90, price: 40 },
    { d: 24, key: 'daniel-tan', subject: 'Mathematics', child: sarah, mode: 'PHYSICAL', start: '18:00', mins: 60, price: 60, review: [5, 'Patient and well prepared every lesson.'] },
    { d: 31, key: 'lee-xin-yi', subject: 'English', child: adam, mode: 'ONLINE', start: '16:00', mins: 60, price: 55 },
    { d: 38, key: 'tan-hui-wen', subject: 'Mathematics', child: sarah, mode: 'PHYSICAL', start: '18:00', mins: 60, price: 50, review: [4, 'Good structured lessons. Timing was a little tight once, but overall happy.'] },
  ]
  const commission = 10
  for (const h of history) {
    const startAt = daysAgo(h.d, h.start)
    const endAt = new Date(startAt.getTime() + h.mins * 60000)
    const total = (h.price * h.mins) / 60
    const b = await mk({
      childId: h.child.id, tutorId: T(h.key).id, subject: h.subject, teachingMode: h.mode,
      ...(h.mode === 'ONLINE' && { location: null, latitude: null, longitude: null }),
      startAt, endAt, proposedPrice: h.price, agreedPrice: h.price, status: 'COMPLETED',
      createdAt: new Date(startAt.getTime() - 5 * 86400000),
      payment: {
        create: {
          amount: total, commissionRate: commission, commissionAmount: Math.round(total * commission) / 100,
          method: 'FPX (Maybank2u)', gatewayRef: `SBX-SEED${h.d}`, status: 'PAID', paidAt: new Date(startAt.getTime() - 3 * 86400000),
        },
      },
      summary: {
        create: {
          content: `Covered ${h.subject} topics for ${h.child.name}'s level with guided practice and a short quiz.`,
          progressNote: 'Good progress. Please revise the practice sheet before the next lesson.',
        },
      },
      ...(h.mode === 'PHYSICAL' && {
        attendance: {
          create: { checkInAt: startAt, checkInLat: home.lat, checkInLng: home.lng, checkInDistance: 12, checkOutAt: endAt },
        },
      }),
      ...(h.review && { review: { create: { parentId, tutorId: T(h.key).id, rating: h.review[0], comment: h.review[1], createdAt: new Date(endAt.getTime() + 3600000) } } }),
    })
    void b
  }

  // ── Trial lesson cancelled by the tutor -> automatic full refund ──
  await mk({
    childId: sarah.id, tutorId: T('daniel-tan').id, subject: 'Mathematics', teachingMode: 'PHYSICAL', isTrial: true,
    startAt: daysAgo(20, '18:00'), endAt: daysAgo(20, '19:00'), proposedPrice: 40, agreedPrice: 40, status: 'CANCELLED',
    cancelReason: 'Cancelled by tutor', createdAt: daysAgo(26, '10:00'),
    payment: {
      create: {
        amount: 40, commissionRate: commission, commissionAmount: 4, method: 'FPX (CIMB Clicks)', gatewayRef: 'SBX-SEEDTRIAL',
        status: 'REFUNDED', paidAt: daysAgo(25, '10:00'),
        refunds: { create: { amount: 40, type: 'AUTO', reason: 'Tutor cancelled the lesson', status: 'APPROVED', reviewedAt: daysAgo(20, '12:00') } },
      },
    },
  })

  // Payments for the two confirmed lessons
  for (const b of [up1, up2]) {
    const total = Number(b.agreedPrice)
    await prisma.payment.create({
      data: {
        bookingId: b.id, amount: total, commissionRate: commission, commissionAmount: Math.round(total * commission) / 100,
        method: 'FPX (Maybank2u)', gatewayRef: `SBX-SEED${b.id}`, status: 'PAID', paidAt: daysAgo(1, '12:00'),
      },
    })
  }
  void pay; void rateOf

  // Sample complaints so the Admin complaint screen has data
  await prisma.complaint.createMany({
    data: [
      {
        filedById: user.id, againstUserId: (await prisma.tutorProfile.findUnique({ where: { id: T('wong-zi-yang').id } })).userId,
        category: 'No-show or lateness', description: 'The tutor arrived 25 minutes late and the lesson was cut short. I would like this reviewed.',
        status: 'OPEN', createdAt: daysAgo(2, '11:00'),
      },
      {
        filedById: user.id, category: 'Payment or refund', description: 'I was charged once but the payment page showed it as pending for a while.',
        status: 'RESOLVED', adminResponse: 'We checked with the gateway: the payment was successful and shows as Paid. Sorry for the confusion.', createdAt: daysAgo(12, '09:00'),
      },
    ],
  })

  // One tutor with a pending qualification, to demonstrate the Admin approval flow
  await prisma.qualification.create({
    data: { tutorId: T('tee-jun-hao').id, title: 'Certificate in Teaching Mathematics', institution: 'Sunway College', year: 2024, documentUrl: 'seed://sample-certificate', status: 'PENDING' },
  })

  // Recent activity feed on the dashboard
  const notes = [
    ['BOOKING_CONFIRMED', 'Booking confirmed with Daniel Tan', 'Mathematics · Primary 5', new Date(Date.now() - 2 * 3600000), false],
    ['BOOKING_SENT', 'Booking request sent to Ms. Tan Hui Wen', 'Mathematics · Primary 5', new Date(Date.now() - 26 * 3600000), false],
    ['REVIEW_POSTED', 'You reviewed Mr. Wong Zi Yang', 'Mathematics · Primary 5', new Date(Date.now() - 3 * 86400000), true],
    ['PAYMENT_SUCCESS', 'Payment successful', 'RM 60.00 for Science with Ms. Tan Hui Wen', new Date(Date.now() - 17 * 86400000), true],
  ]
  for (const [type, title, message, createdAt, isRead] of notes) {
    await prisma.notification.create({ data: { userId: user.id, type, title, message, createdAt, isRead, link: '/parent/bookings' } })
  }
}

// Ratings on tutor cards must always equal what the Review rows say
async function recomputeRatings() {
  const groups = await prisma.review.groupBy({ by: ['tutorId'], _avg: { rating: true }, _count: { _all: true } })
  for (const g of groups) {
    await prisma.tutorProfile.update({ where: { id: g.tutorId }, data: { ratingAvg: g._avg.rating ?? 0, ratingCount: g._count._all } })
  }
}

async function main() {
  await seedBasics()

  // A live site holds real families' data: only the admin account and settings, never the fake tutors and parents
  if (process.env.NODE_ENV === 'production') {
    console.log('Production: seeded the settings and the admin account only.')
    return
  }

  if (await prisma.user.findUnique({ where: { email: DEMO_PARENT.email } })) {
    console.log('Demo data already seeded. Use `npx prisma migrate reset` to start from scratch.')
    return
  }

  console.log('Seeding tutors, reviews and the demo parent (takes ~30 seconds)...')
  const hash = await bcrypt.hash(TUTOR_PASSWORD, 10)
  const parentHash = await bcrypt.hash(DEMO_PARENT.password, 10)
  const tutors = await seedTutors(hash)
  await seedReviewHistory(tutors, hash)
  await seedDemoParent(tutors, parentHash)
  await recomputeRatings()

  console.log('\nSeeded:')
  console.log('  Admin:   admin@wondertutor.local / Admin1234')
  console.log(`  Parent:  ${DEMO_PARENT.email} / ${DEMO_PARENT.password}   (demo bookings in every state)`)
  console.log(`  Tutors:  <name>@tutor.wondertutor.local / ${TUTOR_PASSWORD}   e.g. daniel-tan@tutor.wondertutor.local`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
