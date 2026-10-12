import { hhmmLabel } from './format'

// Preferred-time presets for the wizard and the chatbot. Each preset lists the 2-hour windows
// shown in the dropdown; the first one is the default (Evening -> 6:00 PM - 8:00 PM as in the mockup).
export const TIME_PRESETS = {
  MORNING: { label: 'Morning', ranges: [['09:00', '11:00'], ['08:00', '10:00'], ['10:00', '12:00'], ['08:00', '12:00']] },
  AFTERNOON: { label: 'Afternoon', ranges: [['14:00', '16:00'], ['12:00', '14:00'], ['15:00', '17:00'], ['12:00', '17:00']] },
  EVENING: { label: 'Evening', ranges: [['18:00', '20:00'], ['17:00', '19:00'], ['19:00', '21:00'], ['20:00', '22:00'], ['17:00', '22:00']] },
}

export const rangeKey = (s, e) => `${s}-${e}`
export const rangeLabel = (s, e) => `${hhmmLabel(s)} - ${hhmmLabel(e)}`
export const defaultRange = (preset) => TIME_PRESETS[preset].ranges[0]
