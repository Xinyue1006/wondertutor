import app from './app.js'
import { env } from './config/env.js'
import { startScheduler } from './services/lifecycle.service.js'

app.listen(env.port, () => {
  console.log(`✅ WonderTutor API running on http://localhost:${env.port}`)
  // Booking housekeeping: expire unanswered / unpaid bookings, send lesson reminders (see lifecycle.service.js)
  if (env.nodeEnv !== 'test') startScheduler()
})
