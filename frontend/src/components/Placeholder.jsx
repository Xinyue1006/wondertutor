// Temporary page body for screens not built yet
export default function Placeholder({ title, note }) {
  return (
    <div className="rounded-2xl bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-bold text-navy">{title}</h1>
      <p className="mt-2 text-slate-500">{note || 'This page is not built yet.'}</p>
    </div>
  )
}
