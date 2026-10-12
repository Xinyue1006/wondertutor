import Icon from './ui/Icon'

// Left side of the landing + login screens ("Learn Today, Brighter Tomorrow.")
const FEATURES = [
  ['cap', 'Trusted Tutors', 'Verified profiles'],
  ['calendar', 'Flexible Booking', 'Learn at your time'],
  ['shield', 'Safe & Secure', 'Protected payments'],
]

export default function Hero({ children }) {
  return (
    <div className="relative">
      <h1 className="leading-[0.95]">
        <span className="block font-hand text-5xl font-bold text-navy md:text-6xl">Learn Today,</span>
        <span className="mt-1 block text-5xl font-extrabold tracking-tight text-brand-500 md:text-[4.2rem]">Brighter</span>
        <span className="block text-5xl font-extrabold tracking-tight text-brand-500 md:text-[4.2rem]">
          Tomorrow.
          <Icon name="sparkle" fill className="ml-2 inline h-9 w-9 -translate-y-6 text-accent" />
        </span>
      </h1>
      <p className="mt-5 max-w-sm text-lg text-navy/80">
        Connecting passionate tutors with motivated learners for a brighter future.
      </p>
      <div className="mt-8 flex flex-wrap gap-8">
        {FEATURES.map(([icon, title, sub]) => (
          <div key={title} className="text-center">
            <Icon name={icon} className="mx-auto h-9 w-9 text-brand-500" strokeWidth={1.5} />
            <div className="mt-1 text-sm font-bold text-navy">{title}</div>
            <div className="text-[11px] text-slate-500">{sub}</div>
          </div>
        ))}
      </div>
      {children}
    </div>
  )
}
