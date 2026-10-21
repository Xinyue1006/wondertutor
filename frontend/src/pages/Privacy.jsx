import { Link } from 'react-router-dom'
import Icon from '../components/ui/Icon'

// Plain-language Privacy Notice (Malaysia's Personal Data Protection Act 2010, PDPA) and the few rules of using the site.
// Everything stated here is what the system really does. Contact details come from VITE_PRIVACY_EMAIL when it is set.
const UPDATED = '21 October 2026'
const CONTACT_EMAIL = import.meta.env.VITE_PRIVACY_EMAIL

function Section({ id, title, children }) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <h2 id={id} className="font-display text-xl font-bold text-navy">{title}</h2>
      <div className="mt-2 space-y-3 text-slate-700">{children}</div>
    </section>
  )
}

const List = ({ items }) => (
  <ul className="list-disc space-y-1.5 pl-5">
    {items.map((t) => <li key={t}>{t}</li>)}
  </ul>
)

export default function Privacy() {
  return (
    <article className="mx-auto w-full max-w-3xl py-8">
      <div className="eyebrow">Your data, your choice</div>
      <h1 className="mt-1 font-display text-3xl font-bold text-navy md:text-4xl">Privacy Notice</h1>
      <p className="mt-2 text-sm text-slate-600">Last updated {UPDATED}</p>

      <div className="mt-5 rounded-2xl border border-brand-100 bg-brand-25 p-5">
        <h2 className="flex items-center gap-2 font-bold text-navy"><Icon name="shield" className="h-5 w-5 text-brand-500" /> In short</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
          <li>We only keep what we need to match parents with tutors, run lessons and take payment.</li>
          <li>We never sell your data and we do not show advertising.</li>
          <li>You can see everything we hold, correct it, or delete your account at any time in <b>My Profile</b>.</li>
        </ul>
      </div>

      <Section id="who" title="Who we are">
        <p>
          WonderTutor is the online tutoring platform of Wonderland Learning Materials &amp; Tuition Centre in Banting, Selangor
          (“the centre”, “we”). The centre decides how your personal data is used and is responsible for looking after it.
        </p>
        <p>
          {CONTACT_EMAIL
            ? <>Questions about your data: <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-brand-600 hover:underline">{CONTACT_EMAIL}</a>.</>
            : <>Questions about your data: ask at the centre in Banting, or tell us through <b>Complaints</b> in your account.</>}
        </p>
      </Section>

      <Section id="collect" title="What we collect">
        <div className="overflow-x-auto rounded-xl border border-brand-100">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="bg-brand-50 text-navy">
              <tr><th className="px-4 py-2.5 font-semibold">Who</th><th className="px-4 py-2.5 font-semibold">What</th></tr>
            </thead>
            <tbody className="divide-y divide-brand-100">
              <tr><td className="px-4 py-2.5 font-semibold text-navy">Everyone</td><td className="px-4 py-2.5">Name, email, phone number, password (stored scrambled, nobody can read it), and the time you accepted this notice. If you use Google sign-in, your name and email from Google.</td></tr>
              <tr><td className="px-4 py-2.5 font-semibold text-navy">Parents</td><td className="px-4 py-2.5">Your area or address, your children’s first names, level and subject, the learning goals you write, tutor preferences, lessons booked, messages to tutors, payments, reviews and complaints.</td></tr>
              <tr><td className="px-4 py-2.5 font-semibold text-navy">Tutors</td><td className="px-4 py-2.5">Profile, photo, qualifications and identity documents for verification, availability, emergency contact, lessons taught, and attendance records (the phone’s location and a photo when checking in to a physical lesson).</td></tr>
              <tr><td className="px-4 py-2.5 font-semibold text-navy">Everyone, automatically</td><td className="px-4 py-2.5">A saved login on your device and the notifications we send you. We do not use advertising or tracking cookies.</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="why" title="Why we use it">
        <List items={[
          'To create and protect your account (including checking that a real person signs up).',
          'To find suitable tutors for your child and to book, pay for and run lessons.',
          'To check that physical lessons took place, and to settle payments, refunds and complaints fairly.',
          'To send you emails and notifications about your bookings and payments, and optional reminders you can switch off.',
        ]} />
      </Section>

      <Section id="share" title="Who can see it">
        <List items={[
          'A tutor you book sees your child’s first name, level, subject, learning goals and the lesson location, only for that booking.',
          'Parents see a tutor’s public profile: name, photo, subjects, qualifications (once approved), rating and reviews. Reviews show the parent’s name.',
          'The centre’s admin team can see accounts, bookings, payments and complaints in order to run the service and help you.',
          'Companies that help us run the service see only what they need: Google (sign-in and the “I’m not a robot” check), Cloudinary (photos and documents), our email provider, our hosting provider, and the payment gateway once payments are switched on.',
          'We share data with authorities only when the law requires it.',
        ]} />
      </Section>

      <Section id="children" title="Children’s information">
        <p>
          Parents give us their children’s details to find suitable tutors. We keep it to first name, level, subject and learning
          goals, we do not show it to other parents, and a tutor sees it only after a booking with them.
        </p>
      </Section>

      <Section id="keep" title="How long we keep it">
        <List items={[
          'Your account details stay while your account is open.',
          'When you delete your account, your name, contact details, address, children’s details and notifications are removed.',
          'Records of lessons and payments are kept without your name, because the centre must keep accounting records for the period the law requires (commonly several years).',
        ]} />
      </Section>

      <Section id="rights" title="Your rights">
        <p>Under the PDPA you can ask to see your data, correct it, stop us using it for a purpose, or withdraw your consent. In your account:</p>
        <List items={[
          'Correct your details: My Profile.',
          'Get a copy of your data: My Profile → Privacy & account → Download my data.',
          'Switch reminder emails on or off: My Profile → Privacy & account.',
          'Delete your account: My Profile → Privacy & account → Delete my account.',
        ]} />
        <p>
          Tutors can correct their details in their profile and can ask the centre to delete their account.
          If you are not happy with how we handled your data, tell us first, and you can also contact the Personal Data Protection Commissioner of Malaysia.
        </p>
      </Section>

      <Section id="safe" title="Keeping it safe">
        <p>
          Passwords are stored scrambled and cannot be read. Everything travels over a secure connection, only people who need it can
          open it, and too many wrong login attempts are slowed down. No online service is perfectly safe, so please use a password
          you do not use anywhere else.
        </p>
      </Section>

      <Section id="rules" title="Using WonderTutor">
        <List items={[
          'Give true information and keep one account for yourself. Do not share your password.',
          'Pay for lessons through WonderTutor only. A booking is confirmed once it is paid.',
          'Cancellations and refund requests after payment are reviewed by our admin team.',
          'Write reviews honestly and respectfully. We can remove content or close an account that breaks these rules.',
        ]} />
      </Section>

      <Section id="changes" title="Changes">
        <p>If we change this notice in a way that matters to you, we will tell you in the app. The date at the top shows the latest version.</p>
      </Section>

      <p className="mt-10">
        <Link to="/" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-brand-600 hover:underline">
          <Icon name="arrow-left" className="h-4 w-4" /> Back to WonderTutor
        </Link>
      </p>
    </article>
  )
}
