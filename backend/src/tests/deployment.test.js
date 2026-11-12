import { jest } from '@jest/globals'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prisma } from '../config/prisma.js'
import { findFrontendBuild, requireFrontendBuild } from '../services/deployment.service.js'
import { api, startServer, stopServer } from './helpers.js'

beforeAll(startServer)
afterAll(stopServer)
afterEach(() => jest.restoreAllMocks())

test('production rejects an incomplete frontend build while development can use Vite', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wondertutor-build-check-'))
  try {
    expect(findFrontendBuild([directory])).toBeUndefined()
    expect(() => requireFrontendBuild([directory], true)).toThrow(/Frontend build missing/)
    expect(requireFrontendBuild([directory], false)).toBeUndefined()
    fs.writeFileSync(path.join(directory, 'index.html'), '<html></html>')
    expect(requireFrontendBuild([directory], true)).toBe(directory)
  } finally {
    if (fs.existsSync(path.join(directory, 'index.html'))) fs.unlinkSync(path.join(directory, 'index.html'))
    fs.rmdirSync(directory)
  }
})

test('liveness is independent of the database; readiness hides connection errors', async () => {
  const query = jest.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('database password and hostname must stay private'))
  expect(await api().get('/health')).toEqual({ status: 200 }) // api() replaces the JSON status with HTTP status
  expect(query).not.toHaveBeenCalled()
  const failed = await api().get('/ready')
  expect(failed).toEqual({ status: 503 })
  query.mockRestore()
  expect((await api().get('/ready')).status).toBe(200)
})
