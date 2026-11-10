import { z } from 'zod'
import { hhmm, ymd } from '../../utils/validators.js'
import { DAY_END, DAY_START, MAX_ROWS, copyWeek, getWeekView, resetWeek, saveUsual, saveWeek } from '../../services/availability.service.js'
import { WEEK_MESSAGE, currentWeekStart, weekStartOf } from '../../utils/week.js'

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

const weekParam = ymd(WEEK_MESSAGE)
const weekQuery = z.object({ week: ymd('Choose a valid date').optional() })

const copySchema = z
  .object({
    from: weekParam,
    to: z.array(z.string().max(10), { message: 'Choose the weeks to copy to' }).min(1, 'Choose at least one week').max(8, 'Choose at most 8 weeks at a time'),
  })
  .strict()

// The week asked for, snapped to its Monday; the current week when none is given
const viewedWeek = (req) => {
  const { week } = weekQuery.parse(req.query)
  return week ? weekStartOf(week) : currentWeekStart()
}

// GET /tutor/availability?week=YYYY-MM-DD: usual hours, that week's override and effective hours, booked hours, changed weeks
export async function getSchedule(req, res) {
  res.json(await getWeekView(req.tutor.id, viewedWeek(req)))
}

// PUT /tutor/availability?week=YYYY-MM-DD { slots }: replaces the usual hours and returns the week view
export async function updateSchedule(req, res) {
  const { slots } = scheduleSchema.parse(req.body)
  res.json(await saveUsual(req.tutor.id, slots, viewedWeek(req)))
}

// PUT /tutor/availability/weeks/:weekStart { slots }: creates or replaces that week's override and returns the week view
export async function updateWeek(req, res) {
  const { slots } = scheduleSchema.parse(req.body)
  res.json(await saveWeek(req.tutor.id, weekParam.parse(req.params.weekStart), slots))
}

// DELETE /tutor/availability/weeks/:weekStart: puts that week back on the usual hours and returns the week view
export async function deleteWeek(req, res) {
  res.json(await resetWeek(req.tutor.id, weekParam.parse(req.params.weekStart)))
}

// POST /tutor/availability/weeks/copy { from, to }: copies a saved week to other weeks, returns { copied, skipped }
export async function copySchedule(req, res) {
  const { from, to } = copySchema.parse(req.body)
  res.json(await copyWeek(req.tutor.id, from, to))
}
