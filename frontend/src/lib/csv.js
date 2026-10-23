// Builds a CSV file in the browser. A cell that starts with = + - or @ is opened as a formula by Excel, so such text
// (it is typed by tutors) gets a leading apostrophe; quotes, commas and line breaks are escaped the normal way.
const cell = (v) => {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const toCsv = (rows) => `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n` // BOM so Excel reads UTF-8 names

export function saveCsv(rows, filename) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
