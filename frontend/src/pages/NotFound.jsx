import { Link } from 'react-router-dom'
export default function NotFound() {
  return (
    <div className="p-16 text-center">
      <h1 className="text-3xl font-bold text-navy">Page not found</h1>
      <Link to="/" className="mt-4 inline-block text-brand-500">Go home</Link>
    </div>
  )
}
