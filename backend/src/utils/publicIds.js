import { z } from 'zod'
import { id } from './validators.js'

export const PUBLIC_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const isPublicId = (value) => typeof value === 'string' && PUBLIC_ID_PATTERN.test(value)

// Numeric references remain supported during the transition for the tutor portal
// and existing saved searches. Ownership checks still apply to both forms.
export const recordReference = (label = 'ID') => z.union([
  id(label),
  z.string().regex(PUBLIC_ID_PATTERN, `${label} is invalid`).transform((value) => value.toLowerCase()),
])

// Only call after recordReference()/URL validation. This does not authorize access;
// the caller must add the logged-in owner's scope to its database query.
export const referenceWhere = (reference) => isPublicId(reference)
  ? { publicId: reference.toLowerCase() }
  : { id: Number(reference) }

export const publicReference = (record) => record.publicId || record.id
