import { v2 as cloudinary } from 'cloudinary'
import { env } from '../config/env.js'

// Authenticated image delivery covers JPEG, PNG and PDFs stored as image resources.
export const unsignedReference = url => url?.replace(/(\/image\/authenticated\/)s--[a-zA-Z0-9_-]+--\//, '$1')

export function privateAsset(url, folder) {
  if (!url || !env.cloudinary.cloudName) return null
  const prefix = 'https://res.cloudinary.com/' + env.cloudinary.cloudName + '/image/authenticated/'
  if (!url.startsWith(prefix)) return null
  const path = unsignedReference(url).slice(prefix.length).replace(/^v\d+\//, '')
  const match = /^(wondertutor\/(?:qualifications|attendance|children)\/\d+\/[a-zA-Z0-9_-]+)\.(jpg|jpeg|png|pdf)$/.exec(path)
  return match && match[1].startsWith(folder + '/') ? { id: match[1], format: match[2] } : null
}

// Canonical references are only returned to the child's authenticated owner, separately from expiring display links.
// Legacy public URLs are deliberately not rendered. That does not revoke the old cloud asset; migration must do so.
export function childPhotoFields(child) {
  const folder = 'wondertutor/children/' + child.parentId
  const asset = privateAsset(child.photoUrl, folder)
  const valid = asset && asset.format !== 'pdf'
  let authenticatedReference = false
  try {
    const url = new URL(child.photoUrl)
    authenticatedReference = url.hostname === 'res.cloudinary.com' && url.pathname.includes('/image/authenticated/')
  } catch { /* no stored image */ }
  return {
    photoUrl: valid ? mediaLink(child.photoUrl, folder) : null,
    photoReference: valid ? unsignedReference(child.photoUrl) : child.photoUrl ? undefined : null,
    photoNeedsMigration: Boolean(child.photoUrl && !authenticatedReference),
    photoUnavailable: Boolean(authenticatedReference && (!valid || !env.cloudinary.apiKey || !env.cloudinary.apiSecret)),
  }
}

export function mediaLink(url, folder) {
  const asset = privateAsset(url, folder)
  const { cloudName, apiKey, apiSecret } = env.cloudinary
  if (!asset || !apiKey || !apiSecret) return null
  return cloudinary.utils.private_download_url(asset.id, asset.format, {
    cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, resource_type: 'image',
    type: 'authenticated', expires_at: Math.floor(Date.now() / 1000) + 300,
  })
}
