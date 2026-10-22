// Builds backend/src/data/places.json (the places people can pick as their area) from the GeoNames postal-code file for
// Malaysia. Run it only when the data should be refreshed; the app itself never calls GeoNames.
//
//   1. Download https://download.geonames.org/export/zip/MY.zip and unzip it somewhere outside the project
//   2. node scripts/build-places.mjs path/to/MY.txt
//
// Data: GeoNames postal codes, Creative Commons Attribution 4.0 (credit "GeoNames", https://www.geonames.org).
// Columns of MY.txt (tab separated): country, postcode, place name, state, state code, admin2 name, admin2 code,
// admin3 name, admin3 code, latitude, longitude, accuracy.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const input = process.argv[2]
if (!input) {
  console.error('Usage: node scripts/build-places.mjs path/to/MY.txt')
  process.exit(1)
}

const rows = readFileSync(input, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => line.split('\t'))
const places = []
const seen = new Set()
for (const r of rows) {
  const [country, postcode, city, state, , , , , , lat, lng] = r
  const la = Number(lat)
  const ln = Number(lng)
  // Reject anything that is not a 5-digit Malaysian postcode with coordinates inside Malaysia
  if (country !== 'MY' || !/^\d{5}$/.test(postcode) || !city || !state) continue
  if (!(la > 0.5 && la < 8) || !(ln > 99 && ln < 120)) continue
  const key = `${postcode}|${city}`
  if (seen.has(key)) continue // the same postcode and place twice: keep the first
  seen.add(key)
  places.push([postcode, city, state, Math.round(la * 1e4) / 1e4, Math.round(ln * 1e4) / 1e4])
}
places.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))

const out = {
  source: 'GeoNames postal codes for Malaysia (https://www.geonames.org), Creative Commons Attribution 4.0',
  builtOn: new Date().toISOString().slice(0, 10),
  columns: ['postcode', 'city', 'state', 'latitude', 'longitude'],
  places,
}
const target = fileURLToPath(new URL('../src/data/places.json', import.meta.url))
writeFileSync(target, JSON.stringify(out))
console.log(`${places.length} places written to ${target} (${rows.length - places.length} rows skipped)`)
