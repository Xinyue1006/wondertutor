import fs from 'node:fs'
import path from 'node:path'

// A directory alone is not a deployable SPA: index.html must also be present.
export function findFrontendBuild(candidates) {
  return candidates.find((folder) => fs.existsSync(path.join(folder, 'index.html')))
}

export function requireFrontendBuild(candidates, production) {
  const folder = findFrontendBuild(candidates)
  if (production && !folder) throw new Error('Frontend build missing. Build frontend/dist (or backend/public) before starting production.')
  return folder
}
