import 'dotenv/config'
import { v2 as cloudinary } from 'cloudinary'
import { prisma } from '../src/config/prisma.js'
import { env } from '../src/config/env.js'
import { privateAsset, unsignedReference } from '../src/services/privateMedia.js'

// Inventory by default. To migrate a verified record:
// node scripts/migrate-private-media.js qualification|attendance RECORD_ID CLOUDINARY_ASSET_ID
// Compare the asset with the record before moving it. Never print file URLs or keys.
const [kind, rowId, expectedAssetId] = process.argv.slice(2)
const { cloudName, apiKey, apiSecret } = env.cloudinary
cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret })
async function main() {
  const docs = await prisma.qualification.findMany({ select: { id: true, documentUrl: true, tutor: { select: { userId: true } } } })
  const photos = await prisma.attendance.findMany({ where: { checkInPhotoUrl: { not: null } }, select: { id: true, bookingId: true, checkInPhotoUrl: true } })
  const rows = [
    ...docs.map(d => ({ id: d.id, kind: 'qualification', field: 'documentUrl', url: d.documentUrl, folder: 'wondertutor/qualifications/' + d.tutor.userId })),
    ...photos.map(a => ({ id: a.id, kind: 'attendance', field: 'checkInPhotoUrl', url: a.checkInPhotoUrl, folder: 'wondertutor/attendance/' + a.bookingId })),
  ]
  if (!kind) {
    for (const r of rows) if (!privateAsset(r.url, r.folder)) console.log(r.kind, r.id)
    return
  }
  const r = rows.find(x => x.kind === kind && x.id === Number(rowId))
  if (!r || !expectedAssetId || !apiKey || !apiSecret || !cloudName) throw Error('Invalid record, missing asset ID or incomplete Cloudinary configuration')
  if (privateAsset(r.url, r.folder)) return
  const prefix = 'https://res.cloudinary.com/' + cloudName + '/image/upload/'
  if (!r.url?.startsWith(prefix)) throw Error('Unsupported legacy location. Review and re-upload through private storage.')
  const match = /^(?:v\d+\/)?([\w/-]+)\.(jpg|jpeg|png|pdf)$/.exec(r.url.slice(prefix.length))
  if (!match) throw Error('Unsupported legacy path')
  const dest = r.folder + '/legacy-' + r.id
  let asset
  try { asset = await cloudinary.api.resource(dest, { type: 'authenticated' }) }
  catch (e) { if (e.http_code !== 404) throw e }
  if (!asset) {
    const source = await cloudinary.api.resource(match[1])
    if (source.asset_id !== expectedAssetId) throw Error('Source asset ID mismatch')
    asset = await cloudinary.uploader.rename(match[1], dest, { type: 'upload', to_type: 'authenticated', invalidate: true, overwrite: false })
  }
  if (asset.asset_id !== expectedAssetId || !privateAsset(asset.secure_url, r.folder)) throw Error('Destination identity mismatch')
  const result = await prisma[kind].updateMany({ where: { id: r.id, [r.field]: r.url }, data: { [r.field]: unsignedReference(asset.secure_url) } })
  if (!result.count) throw Error('Record changed during migration')
  console.log('Migrated', kind, r.id)
}
try { await main() } catch (e) { console.error('Migration stopped:', e.http_code || e.message); process.exitCode = 1 }
finally { await prisma.$disconnect() }
