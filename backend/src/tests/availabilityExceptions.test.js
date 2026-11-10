import { prisma } from '../config/prisma.js'
import { MONDAY, api, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'
import { addDays } from '../utils/time.js'

beforeAll(async()=>{await resetDb();await startServer()})
afterAll(stopServer)

test('date override replaces weekly hours, restores them, and is tutor-owned', async()=>{
 const p=await makeParent(), t=await makeTutor(), other=await makeTutor(), date=nextDate(MONDAY)
 const endpoint='/tutor/availability/exceptions'
 expect((await api(p.token).put(endpoint,{date,ranges:[]})).status).toBe(403)
 expect((await api(t.token).put(endpoint,{date,ranges:[]})).status).toBe(200)
 const grid=await api(p.token).get('/parent/tutors/'+t.tutor.id+'/slots?from='+date)
 expect(grid.days[0].slots).toEqual([])
 expect((await api(other.token).get(endpoint)).exceptions).toEqual([])
 const browse=await api(p.token).get('/parent/tutors?subject=Mathematics&level=PRIMARY&date='+date+'&time=17:00')
 expect(browse.tutors.some(x=>x.id===t.tutor.id)).toBe(false)
 expect((await api(t.token).del(endpoint+'/'+date)).status).toBe(200)
 const restored=await api(p.token).get('/parent/tutors/'+t.tutor.id+'/slots?from='+date)
 expect(restored.days[0].slots.length).toBe(4)
})

test('multi-date request is atomic and exceptions cannot invalidate existing requests',async()=>{
 const p=await makeParent(), t=await makeTutor(), date=nextDate(MONDAY), later=addDays(date,7)
 const body={tutorId:t.tutor.id,childId:p.child.id,teachingMode:'ONLINE',proposedPrice:50,slots:[{date,startTime:'17:00'},{date:later,startTime:'17:00'}]}
 await api(t.token).put('/tutor/availability/exceptions',{date:later,ranges:[]})
 expect((await api(p.token).post('/parent/bookings',body)).status).toBe(400)
 expect(await prisma.booking.count({where:{childId:p.child.id}})).toBe(0)
 await api(t.token).del('/tutor/availability/exceptions/'+later)
 const reply=await api(p.token).post('/parent/bookings',body)
 expect(reply.status).toBe(201)
 expect(reply.bookings).toHaveLength(2)
 expect((await api(t.token).put('/tutor/availability/exceptions',{date,ranges:[]})).status).toBe(409)
 expect((await api(p.token).post('/parent/bookings',{...body,slots:[body.slots[0],body.slots[0]]})).status).toBe(400)
})

test('extra date hours are bookable and malformed ranges fail',async()=>{
 const t=await makeTutor(),p=await makeParent(),date=addDays(nextDate(MONDAY),1)
 expect((await api(t.token).put('/tutor/availability/exceptions',{date,ranges:[{startTime:'10:00',endTime:'09:00'}]})).status).toBe(400)
 expect((await api(t.token).put('/tutor/availability/exceptions',{date,ranges:[{startTime:'10:00',endTime:'12:00'}]})).status).toBe(200)
 const reply=await api(p.token).post('/parent/bookings',{tutorId:t.tutor.id,childId:p.child.id,teachingMode:'ONLINE',proposedPrice:50,slots:[{date,startTime:'10:00'},{date,startTime:'10:30'}]})
 expect(reply.status).toBe(409)
 expect(await prisma.booking.count({where:{childId:p.child.id}})).toBe(0)
})
