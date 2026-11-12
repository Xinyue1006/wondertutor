import { useEffect } from 'react'
import { PageTitle } from './ui/Common'
import Icon from './ui/Icon'

export default function TutorPageHeader({ title, subtitle, right }) {
  useEffect(() => {
    // Start each tutor page at its heading rather than the previous page's scroll position.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [])

  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-brand-700">
        <Icon name="briefcase" className="h-4 w-4" /> Tutor workspace
      </p>
      <PageTitle title={title} subtitle={subtitle} right={right} sparkle={false} />
    </div>
  )
}
