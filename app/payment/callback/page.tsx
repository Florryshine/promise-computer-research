import { Suspense } from 'react';
import PaymentCallbackClient from './PaymentCallbackClient';

export default function PaymentCallbackPage() {
  return (
    <Suspense fallback={<PaymentCallbackFallback />}>
      <PaymentCallbackClient />
    </Suspense>
  );
}

function PaymentCallbackFallback() {
  return (
    <main className="section bg-slate-50">
      <div className="container">
        <div className="mx-auto max-w-xl rounded-3xl bg-white p-8 text-center shadow-soft">
          <div className="text-4xl">💳</div>
          <h1 className="mt-4 text-2xl font-black">Payment status</h1>
          <p className="mt-3 text-slate-600">Checking your payment…</p>
        </div>
      </div>
    </main>
  );
}
