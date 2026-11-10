import 'dotenv/config'
import { prisma } from '../src/config/prisma.js'
import { billplzConfigured } from '../src/services/billplz.service.js'
import { settleFromBillplz } from '../src/controllers/parent/payments.controller.js'

// Find the original bill ID in the Billplz merchant dashboard by its Booking reference.
// Run on the server with the same DB and Billplz credentials as the deployed app.
const [booking, billId] = process.argv.slice(2)
try {
  if (!billplzConfigured() || !/^[1-9]\d*$/.test(booking || '') || !billId)
    throw Error('Usage: node scripts/reconcile-bill.js BOOKING_ID ORIGINAL_BILL_ID (Billplz configuration required)')
  const { result } = await settleFromBillplz(billId, { expectedBookingId: Number(booking) })
  console.log('Booking', booking, 'reconciliation result:', result)
} catch (e) {
  console.error('Reconciliation failed:', e.message)
  process.exitCode = 1
} finally { await prisma.$disconnect() }
