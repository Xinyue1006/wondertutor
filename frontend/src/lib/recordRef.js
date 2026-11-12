// Public links use opaque IDs. Numeric IDs remain usable for older records/links
// and internal component keys while both app versions coexist during rollout.
export const recordRef = (record) => record?.publicId || record?.id

export const matchesRecordRef = (record, value) => !!record && value != null && value !== '' &&
  [record.publicId, record.id].some((ref) => ref != null && String(ref) === String(value))

// HTML select controls return strings; preserve UUIDs while keeping legacy numeric payloads compatible.
export const referenceInput = (value) => /^\d+$/.test(String(value)) ? Number(value) : value
