import { addDaysYmd } from '../lib/format'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { beforeEach, vi, test, expect } from 'vitest'
import BookLesson from '../pages/parent/BookLesson'
import { BookingPanel } from '../pages/parent/TutorProfile'
import api from '../api/client'
vi.mock('../api/client',()=>({default:{get:vi.fn(),post:vi.fn()},errorMessage:e=>e.message}))
vi.mock('../assistant/MatchingContext',()=>({useMatching:()=>({kidsLoaded:true,kids:[{id:1,publicId:'bbeb101f-87b2-4ddb-9625-799f01ea005d',name:'Sarah',educationLevel:'PRIMARY',grade:5,subjects:['Mathematics']} ]})}))
beforeEach(() => vi.clearAllMocks())
test('selected dates submit together with the public child ID and the slot teaching mode',async()=>{
 api.get.mockImplementation((url,options)=>Promise.resolve({data:url.endsWith('/slots')?{days:[{date:options.params.from,slots:[{start:'17:00',end:'18:00',status:'available',mode:'ONLINE'}]}]}:{tutor:{id:2,name:'Tutor',hourlyRate:50,rating:4,reviewCount:1,subjects:['Mathematics'],grades:['Primary 5'],offersOnline:true,offersPhysical:true}}}))
 api.post.mockResolvedValue({data:{}})
 render(<MemoryRouter initialEntries={[{pathname:'/parent/tutors/2/book',state:{childId:'bbeb101f-87b2-4ddb-9625-799f01ea005d'}}]}><Routes><Route path="/parent/tutors/:id/book" element={<BookLesson/>}/></Routes></MemoryRouter>)
 const first=await screen.findByRole('button',{name:/^\d{4}-\d{2}-\d{2} 17:00$/})
 const date=first.getAttribute('aria-label').slice(0,10)
 expect(screen.queryByRole('button',{name:date+' 07:00'})).not.toBeInTheDocument()
 expect(screen.queryByRole('button',{name:date+' 21:00'})).not.toBeInTheDocument()
 fireEvent.click(first)
 fireEvent.click(screen.getByRole('button',{name:/Next Week/}))
 const nextDate=addDaysYmd(date,7)
 fireEvent.click(await screen.findByRole('button',{name:nextDate+' 17:00'}))
 expect(screen.getByText('Selected lessons (2/12)')).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:/Send Booking Request/}))
 await waitFor(()=>expect(api.post).toHaveBeenCalledWith('/parent/bookings',expect.objectContaining({childId:'bbeb101f-87b2-4ddb-9625-799f01ea005d',teachingMode:'ONLINE',slots:[{date,startTime:'17:00'},{date:nextDate,startTime:'17:00'}]})))
 expect(api.post.mock.calls[0][1]).not.toHaveProperty('lessonLocation')
})

test('physical requests require a confirmed actual venue and keep the venue after a failed submission', async () => {
 const slots=[{date:'2026-12-01',start:'17:00',mode:'PHYSICAL'},{date:'2026-12-03',start:'18:00',mode:'PHYSICAL'}]
 api.get.mockImplementation(url=>Promise.resolve({data:url.endsWith('/slots')?{days:[]}:{tutor:{id:2,name:'Tutor',hourlyRate:50,rating:4,reviewCount:1,subjects:['Mathematics','Science'],grades:['Primary 5'],offersOnline:true,offersPhysical:true}}}))
 api.post.mockRejectedValueOnce(new Error('This slot was just taken. Please choose another time.')).mockResolvedValue({data:{}})
 render(<MemoryRouter initialEntries={[{pathname:'/parent/tutors/2/book',state:{slots,mode:'PHYSICAL',subject:'Science'}}]}><Routes><Route path="/parent/tutors/:id/book" element={<BookLesson/>}/></Routes></MemoryRouter>)
 const send=await screen.findByRole('button',{name:/Send Booking Request/})
 fireEvent.click(send)
 expect(api.post).not.toHaveBeenCalled()
 expect(screen.getByText(/Enter the full lesson address/)).toBeInTheDocument()
 fireEvent.change(screen.getByLabelText('Full lesson address'),{target:{value:'  12 Jalan Test, 50000 Kuala Lumpur  '}})
 fireEvent.change(screen.getByLabelText('Latitude (−90 to 90)'),{target:{value:'3.1412'}})
 fireEvent.change(screen.getByLabelText('Longitude (−180 to 180)'),{target:{value:'101.6123'}})
 fireEvent.click(send)
 expect(api.post).not.toHaveBeenCalled()
 expect(screen.getByText(/Confirm that the address and pin/)).toBeInTheDocument()
 fireEvent.click(screen.getByRole('checkbox'))
 fireEvent.click(send)
 await screen.findByText('This slot was just taken. Please choose another time.')
 expect(screen.getByLabelText('Full lesson address')).toHaveValue('  12 Jalan Test, 50000 Kuala Lumpur  ')
 expect(screen.getByRole('checkbox')).toBeChecked()
 fireEvent.click(send)
 await waitFor(()=>expect(api.post).toHaveBeenCalledTimes(2))
 expect(api.post.mock.calls[1]).toEqual(['/parent/bookings',expect.objectContaining({
  teachingMode:'PHYSICAL',subject:'Science',slots:[{date:'2026-12-01',startTime:'17:00'},{date:'2026-12-03',startTime:'18:00'}],
  lessonLocation:{address:'12 Jalan Test, 50000 Kuala Lumpur',latitude:3.1412,longitude:101.6123,confirmed:true},
 })])
})

test('the tutor profile hands multiple physical lessons and form choices to the full venue form without sending a request', async () => {
 const tutor={id:2,hourlyRate:50,subjects:['Mathematics'],grades:['Primary 5'],offersOnline:true,offersPhysical:true,upcomingAvailability:[
  {date:'2026-12-01',slots:[{start:'17:00',end:'18:00',status:'available',mode:'PHYSICAL'}]},
  {date:'2026-12-03',slots:[{start:'18:00',end:'19:00',status:'available',mode:'PHYSICAL'}]},
 ]}
 const kids=[{id:1,publicId:'bbeb101f-87b2-4ddb-9625-799f01ea005d',name:'Sarah',educationLevel:'PRIMARY',grade:5,subjects:['Mathematics']}]
 function Destination(){return <pre data-testid="handoff">{JSON.stringify(useLocation().state)}</pre>}
 render(<MemoryRouter initialEntries={['/parent/tutors/2']}><Routes><Route path="/parent/tutors/:id" element={<BookingPanel tutor={tutor} kids={kids}/>}/><Route path="/parent/tutors/:id/book" element={<Destination/>}/></Routes></MemoryRouter>)
 fireEvent.click(screen.getByRole('button',{name:'Add selected lesson'}))
 fireEvent.change(screen.getByLabelText(/Selected Date/),{target:{value:'2026-12-03'}})
 fireEvent.click(screen.getByRole('button',{name:'Add selected lesson'}))
 fireEvent.change(screen.getByLabelText(/Proposed Price/),{target:{value:'60'}})
 fireEvent.change(screen.getByLabelText(/Message to Tutor/),{target:{value:'Meet at our library room.'}})
 fireEvent.click(screen.getByRole('button',{name:/Continue Booking/}))
 const handoff=JSON.parse((await screen.findByTestId('handoff')).textContent)
 expect(handoff).toMatchObject({mode:'PHYSICAL',price:'60',msg:'Meet at our library room.',subject:'Mathematics',childId:kids[0].publicId,slots:[{date:'2026-12-01',start:'17:00',mode:'PHYSICAL'},{date:'2026-12-03',start:'18:00',mode:'PHYSICAL'}]})
 expect(api.post).not.toHaveBeenCalled()
})

test('stale browser history cannot prefill or preconfirm a private physical venue', async () => {
 api.get.mockImplementation(url=>Promise.resolve({data:url.endsWith('/slots')?{days:[]}:{tutor:{id:2,name:'Tutor',hourlyRate:50,rating:4,reviewCount:1,subjects:['Mathematics'],grades:['Primary 5'],offersOnline:true,offersPhysical:true}}}))
 render(<MemoryRouter initialEntries={[{pathname:'/parent/tutors/2/book',state:{
  slots:[{date:'2026-12-01',start:'17:00',mode:'PHYSICAL'}],mode:'PHYSICAL',
  lessonLocation:{address:'12 Previous Family Street',latitude:3.1412,longitude:101.6123,confirmed:true},
 }}]}><Routes><Route path="/parent/tutors/:id/book" element={<BookLesson/>}/></Routes></MemoryRouter>)
 const send=await screen.findByRole('button',{name:/Send Booking Request/})
 expect(screen.getByLabelText('Full lesson address')).toHaveValue('')
 expect(screen.getByText('No lesson pin selected yet.')).toBeInTheDocument()
 expect(screen.getByRole('checkbox')).not.toBeChecked()
 expect(screen.getByRole('checkbox')).toBeDisabled()
 fireEvent.click(send)
 expect(api.post).not.toHaveBeenCalled()
})
