import { createHash } from 'node:crypto'
import { env } from '../config/env.js'
import { AppError } from '../utils/AppError.js'

// POST /api/uploads/signature
// Cloudinary "signed upload": the browser sends the image directly to Cloudinary using this one-time signature,
// so the API secret stays on the server and image bytes never pass through our backend.
export function uploadSignature(req, res) {
  const { cloudName, apiKey, apiSecret } = env.cloudinary
  if (!cloudName || !apiKey || !apiSecret) throw new AppError(501, 'Photo upload is not configured yet')

  const timestamp = Math.floor(Date.now() / 1000)
  const folder = `wondertutor/${req.user.role.toLowerCase()}s`
  // Cloudinary signs the alphabetically ordered parameters followed by the API secret
  const signature = createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`).digest('hex')
  res.json({ cloudName, apiKey, timestamp, folder, signature })
}
