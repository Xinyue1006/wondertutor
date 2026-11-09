import { z } from 'zod'
import { hhmm } from '../../utils/validators.js'
import { DAY_END, DAY_START, MAX_ROWS, getAvailability, replaceAvailability } from '../../services/availability.service.js'

const TIME_MESSAGE = `Choose whole hours between ${DAY_START} and ${DAY_END}`
const wholeHour = hhmm(TIME_MESSAGE).refine((t) => t.endsWith(':00') && t >= DAY_START && t <= DAY_END, TIME_MESSAGE)

const scheduleSchema = z
  .object({
    slots: z
      .array(
        z
          .object({
            dayOfWeek: z.number({ message: 'Choose a valid day of the week' }).int('Choose a valid day of the week').min(0, 'Choose a valid day of the week').max(6, 'Choose a valid day of the week'),
            startTime: wholeHour,
            endTime: wholeHour,
          })
          .strict()
          .refine((s) => s.startTime < s.endTime, TIME_MESSAGE),
        { message: 'Send the weekly schedule as a list' },
      )
      .max(MAX_ROWS, 'Too many time ranges in the schedule'),
  })
  .strict()

// GET /tutor/availability: the weekly ranges, the hours locked by upcoming bookings, and the grid bounds
export async function getSchedule(req, res) {
  res.json(await getAvailability(req.tutor.id))
}

// PUT /tutor/availability { slots }: replaces the whole weekly schedule and returns it in the same shape as GET
export async function updateSchedule(req, res) {
  const { slots } = scheduleSchema.parse(req.body)
  res.json(await replaceAvailability(req.tutor.id, slots))
}
