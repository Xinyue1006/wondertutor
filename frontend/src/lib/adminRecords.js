import { useEffect, useState } from 'react'
import api, { errorMessage } from '../api/client'

export function useRecords(path) {
  const [state, setState] = useState(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    api.get(path, { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setState({ path, revision, data }) })
      .catch(err => { if (!controller.signal.aborted) setState({ path, revision, error: errorMessage(err) }) })
    return () => controller.abort()
  }, [path, revision])
  const current = state?.path === path && state.revision === revision ? state : {}
  return { ...current, reload: () => setRevision(n => n + 1) }
}

export function exportRows(name, columns, rows) {
  const quote = value => {
    const s = String(value ?? '')
    return '"' + (/^\s*[=+@-]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? "'" : '') + s.replaceAll('"','""') + '"'
  }
  const lines = [columns.map(([label]) => label), ...rows.map(row => columns.map(([,read]) => read(row)))]
  const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.map(r => r.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = name + '.csv'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
