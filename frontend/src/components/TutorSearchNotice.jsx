export default function TutorSearchNotice({ scope, hasResults }) {
  if (!scope || scope.mode === 'ANY') return null
  const area = scope.location || 'your area'
  return <div role="status" className="my-4 rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm text-navy">
    {scope.mode === 'ONLINE' ? 'Online lessons across Malaysia. Distance does not limit these results.'
      : scope.needsLocation ? 'Choose a location to find nearby physical tutors.'
        : hasResults ? `Physical tutors within ${scope.radiusKm} km of ${area}.`
          : <><strong className="block">No nearby tutors found</strong><span>No physical tutors match these filters within {scope.radiusKm} km of {area}.</span></>}
  </div>
}

export function OnlineTutorAlternatives({ total, children }) {
  if (!total) return null
  return <section aria-label="Online alternatives" className="mt-6">
    <h2 className="text-xl font-bold text-navy">Online alternatives</h2>
    <p className="mb-4 mt-1 text-sm text-slate-600">{total} tutor{total === 1 ? '' : 's'} available for online lessons across Malaysia. These results are for online lessons.</p>
    {children}
  </section>
}
