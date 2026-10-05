'use client';

import { useState } from 'react';

export default function RequeryPaymentButton({ orderId, disabled = false }: { orderId: string; disabled?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function requery() {
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch('/api/paystack/requery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const data = await response.json();
      setResult(data);
      if (data.ok || data.code === 'already_paid') {
        setTimeout(() => window.location.reload(), 700);
      }
    } catch {
      setResult({ ok: false, message: 'Could not contact the payment service. Try again.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <button type="button" onClick={requery} disabled={disabled || loading} className="rounded-xl bg-[#0757d5] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
        {loading ? 'Checking Paystack…' : 'Check payment status'}
      </button>
      {result && (
        <div className="mt-3 text-sm">
          <p className={`font-bold ${result.ok ? 'text-emerald-700' : 'text-red-600'}`}>{result.message || result.cause || 'No payment result returned.'}</p>
          {(result.diagnosis || result.code) && (
            <div className="mt-2 space-y-1 text-xs text-slate-600">
              <p><b>Diagnosis:</b> {result.diagnosis?.code || result.code}</p>
              {(result.diagnosis?.cause || result.cause) && <p><b>Cause:</b> {result.diagnosis?.cause || result.cause}</p>}
              {result.diagnosis?.gatewayStatus && <p><b>Gateway status:</b> {result.diagnosis.gatewayStatus}</p>}
              {result.diagnosis?.returnedAmount != null && <p><b>Returned amount:</b> ₦{Number(result.diagnosis.returnedAmount).toLocaleString()}</p>}
              {result.diagnosis?.returnedCurrency && <p><b>Returned currency:</b> {result.diagnosis.returnedCurrency}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
