import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import Icon from '../../components/ui/Icon'
import { Spinner } from '../../components/ui/Common'

// Billplz sends the parent back here after paying, with billplz[id], billplz[paid] and billplz[x_signature] in the
// address. They are only passed on to our server, which checks the signature and asks Billplz itself whether the bill
// was paid: nothing on this page decides whether a payment counts.
export default function PaymentReturn() {
  const [params] = useSearchParams()
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const sent = useRef(false) // React's dev double-run and a refresh must not send it twice at the same moment

  useEffect(() => {
    if (sent.current) return
    sent.current = true
    const id = params.get('billplz[id]')
    const signature = params.get('billplz[x_signature]')
    if (!id || !signature) { setError('This page is meant to be opened by the payment service. Check your payments instead.'); return }
    api.post('/parent/payments/return', {
      id, paid: params.get('billplz[paid]') || 'false', paid_at: params.get('billplz[paid_at]') || undefined, x_signature: signature,
    }).then((r) => setResult(r.data)).catch((e) => setError(errorMessage(e)))
  }, [params])

  if (!result && !error) return <div className="py-20 text-center"><Spinner /><p className="mt-3 text-sm text-slate-600">Checking your payment…</p></div>

  const ok = result?.outcome === 'SUCCESS'
  const waiting = result?.outcome === 'WAITING'
  const tone = ok ? 'bg-ok' : waiting ? 'bg-accent-600' : 'bg-red-500'
  return (
    <div className="mx-auto max-w-md py-12">
      <div className="card flex flex-col items-center gap-3 p-8 text-center" role="status">
        <span className={`flex h-16 w-16 items-center justify-center rounded-full text-white ${tone}`}>
          <Icon name={ok ? 'check' : waiting ? 'clock' : 'x'} className="h-9 w-9" strokeWidth={3} />
        </span>
        <h1 className="text-2xl font-extrabold text-navy">{ok ? 'Payment successful' : waiting ? 'Payment pending' : result?.outcome === 'LATE' ? 'Payment received' : 'Payment not completed'}</h1>
        <p className="text-sm text-slate-600">{error || result.message}</p>
        <div className="mt-2 flex gap-3">
          <Link to="/parent/payments" className="btn-primary px-6">Go to Payments</Link>
          {ok && <Link to="/parent/bookings" className="btn-outline px-6">My Bookings</Link>}
        </div>
      </div>
    </div>
  )
}
