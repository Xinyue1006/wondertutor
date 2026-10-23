import Icon from './ui/Icon'

// What the tutor wrote after a lesson: the summary, the topics, how the child is doing, the homework to do, and what to do
// next. Only the parts that exist are shown (older summaries have just the first one).
export default function LessonNotes({ summary }) {
  if (!summary) return <p className="mt-1 text-sm text-slate-500">No summary for this lesson.</p>
  const line = (label, text) => text && <p className="mt-1 text-slate-600"><b className="text-navy">{label}:</b> {text}</p>
  return (
    <div className="mt-2 space-y-2 text-sm">
      <div className="rounded-xl bg-brand-25 p-3">
        <p className="text-slate-700">{summary.content}</p>
        {line('Topics covered', summary.topics)}
        {line('Tutor’s observations', summary.progressNote)}
        {line('Recommendation', summary.recommendations)}
      </div>
      {summary.homework && (
        <div className="flex items-start gap-2 rounded-xl border border-accent/40 bg-accent-50 p-3 text-slate-700">
          <Icon name="file" className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
          <p><b className="text-navy">Homework / follow-up:</b> {summary.homework}</p>
        </div>
      )}
    </div>
  )
}
