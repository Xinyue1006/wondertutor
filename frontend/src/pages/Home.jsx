import { Link } from 'react-router-dom'
import Hero from '../components/Hero'
import Icon from '../components/ui/Icon'
import Robot from '../components/ui/Robot'

const STEPS = [
  ['search', 'Tell us what your child needs', 'Pick a subject and level, or chat with our AI Tutor Assistant.'],
  ['star', 'Compare recommended tutors', 'See a match score and the reasons behind every recommendation.'],
  ['calendar', 'Book and pay securely', 'Send a booking request, agree a price, and pay online.'],
]

export default function Home() {
  return (
    <div className="pt-8 lg:pt-12">
      <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
        <Hero>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/signup" className="btn-primary h-12 px-8 text-base">Get Started</Link>
            <Link to="/login" className="btn-outline h-12 px-8 text-base">Log In</Link>
          </div>
        </Hero>
        <div className="card relative mx-auto flex max-w-md flex-col items-center p-8 text-center">
          <Robot className="float-y h-32 w-32" />
          <h2 className="mt-2 text-2xl font-extrabold text-navy">Find the right tutor for your child</h2>
          <p className="mt-2 text-sm text-slate-500">
            Tell our AI Tutor Assistant what your child needs, or browse verified tutors yourself.
          </p>
          <Link to="/signup" className="btn-accent mt-5 px-6">Sign up free <Icon name="arrow-right" className="h-4 w-4" /></Link>
        </div>
      </div>

      <section id="how-it-works" className="mt-20 scroll-mt-24">
        <h2 className="text-center text-3xl font-extrabold text-navy">How It Works</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {STEPS.map(([icon, title, text], i) => (
            <div key={title} className="card p-6 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-500"><Icon name={icon} className="h-6 w-6" /></span>
              <div className="mt-3 text-xs font-bold uppercase tracking-wide text-brand-500">Step {i + 1}</div>
              <div className="mt-1 text-lg font-bold text-navy">{title}</div>
              <p className="mt-1 text-sm text-slate-500">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-16 grid gap-5 md:grid-cols-2">
        <div id="for-parents" className="card scroll-mt-24 p-7">
          <h3 className="text-xl font-extrabold text-navy">For Parents</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            {['Browse qualified, verified tutors', 'Manage multiple children in one account', 'See attendance, photos and session summaries', 'Leave reviews and feedback'].map((t) => (
              <li key={t} className="flex gap-2"><Icon name="check-circle" className="h-5 w-5 shrink-0 text-brand-500" />{t}</li>
            ))}
          </ul>
        </div>
        <div id="for-tutors" className="card scroll-mt-24 border-accent/40 bg-accent-50 p-7">
          <h3 className="text-xl font-extrabold text-navy">For Tutors</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            {['Set your own availability and rates', 'Accept, reject or counter-offer booking requests', 'Check in with GPS and photo for physical lessons', 'Track your earnings and withdraw'].map((t) => (
              <li key={t} className="flex gap-2"><Icon name="check-circle" className="h-5 w-5 shrink-0 text-accent-600" />{t}</li>
            ))}
          </ul>
        </div>
      </section>

      <section id="about" className="card mt-16 scroll-mt-24 p-8 text-center">
        <h3 className="text-2xl font-extrabold text-navy">About Us</h3>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-600">
          WonderTutor is built with Wonderland Learning Materials &amp; Tuition Centre in Banting, Selangor to make it
          easy for parents to find kindergarten, primary and secondary tutors they can trust.
        </p>
      </section>
    </div>
  )
}
