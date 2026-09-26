'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

export default function PaymentCallbackClient() {
  const params = useSearchParams();
  const reference = params.get('reference');
  const [state, setState] = useState('Checking your payment…');

  useEffect(() => {
    if (!reference) {
      setState('No payment reference was supplied.');
      return;
    }

    (async () => {
      try {
        const res = await fetch('/api/paystack/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference }),
        });
        const data = await res.json();
        setState(
          data.paid
            ? 'Payment successful. Your order is now being processed.'
            : data.message || 'Payment was not completed.',
        );
      } catch {
        setState('We could not confirm the payment yet. Check your order shortly.');
      }
    })();
  }, [reference]);

  return (
    <main className="section bg-slate-50">
      <div className="container">
        <div className="mx-auto max-w-xl rounded-3xl bg-white p-8 text-center shadow-soft">
          <div className="text-4xl">💳</div>
          <h1 className="mt-4 text-2xl font-black">Payment status</h1>
          <p className="mt-3 text-slate-600">{state}</p>
          <Link
            href="/dashboard/orders"
            className="mt-6 inline-flex rounded-xl bg-[#0757d5] px-5 py-3 font-bold text-white"
          >
            View my orders
          </Link>
        </div>
      </div>
    </main>
  );
}
