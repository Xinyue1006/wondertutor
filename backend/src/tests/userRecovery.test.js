import { Prisma } from '@prisma/client'
import { jest } from '@jest/globals'
import { faqData } from '../controllers/public.controller.js'
import { FAQ } from '../services/assistant/faq.js'
import { errorHandler } from '../middleware/error.js'

test('public help exposes the same approved answers without internal policy notes', () => {
  const res = { set: jest.fn(), json: jest.fn() }
  faqData({}, res)
  const payload = res.json.mock.calls[0][0]
  expect(payload.entries).toEqual(FAQ.map(({ id, topic, answer }) => ({ id, topic, answer })))
  expect(res.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=300')
  expect(JSON.stringify(payload)).not.toMatch(/backend\/src|OPEN_POLICY_QUESTIONS|apiKey/)
})

test('a transaction conflict returns a safe recoverable conflict instead of a server crash', () => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() }
  errorHandler(new Prisma.PrismaClientKnownRequestError('internal database detail', { code: 'P2034', clientVersion: '6' }), {}, res, () => {})
  expect(res.status).toHaveBeenCalledWith(409)
  expect(res.json.mock.calls[0][0].message).toMatch(/refresh and try again/)
  expect(res.json.mock.calls[0][0].message).not.toContain('internal database detail')
})
