import { addDaysYmd } from '../lib/format'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, test, expect } from 'vitest'
import BookLesson from '../pages/parent/BookLesson'
import api from '../api/client'
vi.mock('../api/client',()=>({default:{get:vi.fn(),post:vi.fn()},errorMessage:e=>e.message}))
vi.mock('../assistant/MatchingContext',()=>({useMatching:()=>({kidsLoaded:true,kids:[{id:1,publicId:'bbeb101f-87b2-4ddb-9625-799f01ea005d',name:'Sarah',educationLevel:'PRIMARY',grade:5,subjects:['Mathematics']} ]})}))
test('selected dates survive moving between weeks and submit together',async()=>{
 api.get.mockImplementation((url,options)=>Promise.resolve({data:url.endsWith('/slots')?{days:[{date:options.params.from,slots:[{start:'17:00',end:'18:00',status:'available'}]}]}:{tutor:{id:2,name:'Tutor',hourlyRate:50,rating:4,reviewCount:1,subjects:['Mathematics'],grades:['Primary 5'],offersOnline:true}}}))
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
 await waitFor(()=>expect(api.post).toHaveBeenCalledWith('/parent/bookings',expect.objectContaining({childId:'bbeb101f-87b2-4ddb-9625-799f01ea005d',slots:[{date,startTime:'17:00'},{date:nextDate,startTime:'17:00'}]})))
})
