import api, { errorMessage } from '../api/client'

// Downloads a file the server only gives to a logged-in user (calendar files, "my data"). A plain link cannot send the
// login, so the file is fetched with it and then saved from the browser's memory.
// Returns '' when it worked, or the message to show.
export async function downloadFile(path, fallbackName) {
  try {
    const r = await api.get(path, { responseType: 'blob' })
    const named = /filename="?([^";]+)"?/i.exec(r.headers['content-disposition'] || '')
    const url = URL.createObjectURL(r.data)
    const a = document.createElement('a')
    a.href = url
    a.download = named?.[1] || fallbackName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    return ''
  } catch (err) {
    // With responseType "blob" an error message arrives as a Blob of JSON text, so it is read out first
    const blob = err?.response?.data
    if (blob instanceof Blob) {
      try { return JSON.parse(await blob.text()).message || 'Could not download the file.' } catch { /* not JSON */ }
    }
    return errorMessage(err)
  }
}
