'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Result = {
  paid?: boolean;
  message?: string;
};

export default function PaymentCallbackClient({ reference }: { reference: string }) {
  const [state, setState] = useState<'checking' | 'success' | 'failed' | 'error'>('checking');
  const [message, setMessage] = useState('Confirming your payment…');

  useEffect(() => {
    if (!reference) {
      setState('error');
      setMessage('No payment reference was supplied.');
      return;
    }

    let cancelled = false;

    const verify = async (attempt = 1): Promise<void> => {
      try {
        const res = await fetch('/api/paystack/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference }),
          cache: 'no-store'
        });

        const data: Result = await res.json();

        if (cancelled) return;

        if (data.paid) {
          setState('success');
          setMessage('Payment successful. Your order is now being processed.');
          return;
        }

        // Give Paystack/webhook a few seconds to settle before declaring failure.
        if (attempt < 3 && res.status !== 401 && res.status !== 404) {
          setMessage('Payment received. Confirming it with the payment gateway…');
          window.setTimeout(() => verify(attempt + 1), 2000);
          return;
        }

        setState('failed');
        setMessage(data.message || 'Payment was not completed.');
      } catch {
        if (cancelled) return;

        if (attempt < 3) {
          setMessage('Confirming your payment…');
          window.setTimeout(() => verify(attempt + 1), 2000);
        } else {
          setState('error');
          setMessage('We could not confirm the payment yet. Please check your orders shortly.');
        }
      }
    };

    void verify();

    return () => {
      cancelled = true;
    };
  }, [reference]);

  const success = state === 'success';

  return (
    <main className="section bg-slate-50">
      <div className="container">
        <div className="mx-auto max-w-xl rounded-3xl bg-white p-8 text-center shadow-soft">
          <div className="text-5xl" aria-hidden="true">
            {success ? '✅' : state === 'checking' ? '⏳' : state === 'failed' ? '❌' : '⚠️'}
          </div>

          <h1 className="mt-4 text-2xl font-black">
            {success ? 'Payment successful' : state === 'checking' ? 'Confirming payment' : 'Payment status'}
          </h1>

          <p className="mt-3 text-slate-600">{message}</p>

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/dashboard/orders"
              className="inline-flex rounded-xl bg-[#0757d5] px-5 py-3 font-bold text-white"
            >
              View my orders
            </Link>
            <Link
              href="/"
              className="inline-flex rounded-xl border border-slate-200 px-5 py-3 font-bold text-slate-700"
            >
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
