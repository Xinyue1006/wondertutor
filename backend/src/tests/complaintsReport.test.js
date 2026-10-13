// Admin complaints report and CSV export.
import { prisma } from '../config/prisma.js'
import { api, apiBase, makeAdmin, makeParent, makeTutor, resetDb, startServer, stopServer } from './helpers.js'

let admin, parent, tutor
const days = (n) => new Date(Date.now() - n * 86_400_000)

beforeAll(async () => {
  await resetDb()
  await startServer()
  admin = await makeAdmin()
  parent = await makeParent()
  tutor = await makeTutor()
  const filedById = parent.user.id
  await prisma.complaint.createMany({
    data: [
      // resolved after 10 hours
      { filedById, againstUserId: tutor.user.id, category: 'Lesson quality', description: 'Late', status: 'RESOLVED', adminResponse: 'Spoke to tutor', createdAt: days(20), updatedAt: new Date(days(20).getTime() + 10 * 3_600_000) },
      // dismissed after 2 hours
      { filedById, againstUserId: tutor.user.id, category: 'Lesson quality', description: 'Short lesson', status: 'DISMISSED', adminResponse: 'No issue found', createdAt: days(15), updatedAt: new Date(days(15).getTime() + 2 * 3_600_000) },
      // open for 10 days: overdue
      { filedById, category: 'Payment', description: '=HYPERLINK("http://evil")', status: 'OPEN', createdAt: days(10), updatedAt: days(10) },
      // open since yesterday: not overdue
      { filedById, category: 'Other', description: 'Has "quotes", and, commas', status: 'IN_PROGRESS', createdAt: days(1), updatedAt: days(1) },
    ],
  })
})
afterAll(stopServer)

describe('complaints report', () => {
  test('counts by status and category, average resolution time, overdue and the most complained-about user', async () => {
    const r = await api(admin.token).get('/admin/complaints/report')
    expect(r.status).toBe(200)
    expect(r.total).toBe(4)
    expect(r.byStatus).toEqual({ OPEN: 1, IN_PROGRESS: 1, RESOLVED: 1, DISMISSED: 1 })
    expect(r.byCategory[0]).toEqual({ category: 'Lesson quality', count: 2 })
    expect(r.averageResolutionHours).toBe(6) // (10 + 2) / 2
    expect(r.resolutionRate).toBe(50)
    expect(r.overdue).toBe(1)
    expect(r.mostComplainedAbout[0]).toMatchObject({ userId: tutor.user.id, count: 2, role: 'TUTOR' })
  })

  test('a date range only counts complaints filed inside it', async () => {
    const fmt = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(d)
    const r = await api(admin.token).get(`/admin/complaints/report?from=${fmt(days(12))}&to=${fmt(new Date())}`)
    expect(r.total).toBe(2)
    expect(r.averageResolutionHours).toBeNull()
  })

  test('bad dates are rejected and only admins can see the report', async () => {
    expect((await api(admin.token).get('/admin/complaints/report?from=yesterday')).status).toBe(400)
    expect((await api(parent.token).get('/admin/complaints/report')).status).toBe(403)
  })
})

describe('CSV export', () => {
  test('downloads every complaint as a safe CSV file', async () => {
    const res = await fetch(`${apiBase()}/admin/complaints/export`, { headers: { Authorization: `Bearer ${admin.token}` } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/csv/)
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="complaints\.csv"/)
    const text = await res.text()
    const lines = text.replace(/^﻿/, '').split('\r\n')
    expect(lines).toHaveLength(5) // header + 4 complaints
    expect(lines[0]).toBe('"ID","Filed on","Status","Category","Filed by","Filed by email","Against","Booking","Description","Admin response","Last updated"')
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`) // formula disarmed, quotes doubled
    expect(text).toContain('"Has ""quotes"", and, commas"')
  })

  test('parents cannot export', async () => {
    const res = await fetch(`${apiBase()}/admin/complaints/export`, { headers: { Authorization: `Bearer ${parent.token}` } })
    expect(res.status).toBe(403)
  })
})
