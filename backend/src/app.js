import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { env } from './config/env.js'
import routes from './routes/index.js'
import { errorHandler, notFound } from './middleware/error.js'
import { rateLimit } from './middleware/rateLimit.js'

const app = express()

// CSP is relaxed because the pages load Google sign-in, reCAPTCHA and Cloudinary scripts/images
// Behind the hosting provider's proxy the real visitor IP is in X-Forwarded-For; rate limiting needs it
if (env.nodeEnv === 'production') app.set('trust proxy', 1)
app.use(helmet({ contentSecurityPolicy: false }))
app.use(cors({ origin: env.clientUrl, credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false, limit: '100kb' })) // Billplz posts its payment callback as a form
if (env.nodeEnv !== 'test') app.use(morgan('dev')) // keep test output readable

// A general ceiling per address, on top of the stricter limits on login, codes and places: it stops one machine from
// hammering the API (and any endpoint that is expensive to answer) without bothering normal use.
app.use('/api', rateLimit({ name: 'api', windowMs: 60_000, max: 600 }))
app.use('/api', routes)

// In production one Node app serves both the API and the built React site (frontend/dist),
// so the whole project lives on a single domain and needs no CORS or second hosting plan.
// The site is in frontend/dist in the repo, or in ./public when the backend is uploaded on its own (flat host layout).
const here = path.dirname(fileURLToPath(import.meta.url))
const dist = [path.resolve(here, '../../frontend/dist'), path.resolve(here, '../public')].find((d) => fs.existsSync(d))
if (env.nodeEnv === 'production' && dist) {
  app.use(express.static(dist))
  // React Router handles page URLs in the browser, so any non-API path returns index.html
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')))
}

app.use(notFound)
app.use(errorHandler)

export default app
