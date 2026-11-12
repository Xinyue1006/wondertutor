import { Link } from 'react-router-dom'
import Logo from '../../components/Logo'
import Login from './Login'

export default function AdminLogin() {
  return (
    <div className="flex min-h-screen flex-col overflow-x-clip bg-brand-25">
      <header className="border-b border-brand-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <Link to="/" aria-label="WonderTutor home"><Logo mark className="h-8 sm:hidden" /><Logo className="hidden h-8 sm:block" /></Link>
          <Link to="/" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-600 hover:underline">Back to website</Link>
        </div>
      </header>
      <main className="flex flex-1"><Login admin /></main>
    </div>
  )
}
