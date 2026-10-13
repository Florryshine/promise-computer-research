'use client';

import { useState } from 'react';

export default function RefreshProviderStatusButton({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [ok, setOk] = useState<boolean | null>(null);

  async function refresh() {
    setLoading(true);
    setMessage('');
    setOk(null);
    try {
      const response = await fetch('/api/orders/' + encodeURIComponent(orderId) + '/refresh-provider-status', { method: 'POST' });
      const result = await response.json();
      setOk(Boolean(response.ok && result.ok));
      setMessage(result.message || 'No status update returned.');
      if (response.ok && result.status && ['completed', 'needs_information'].includes(result.status)) {
        setTimeout(() => window.location.reload(), 900);
      }
    } catch {
      setOk(false);
      setMessage('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <p className="text-sm text-slate-600">If the service has already arrived but this order still says processing, check the latest status with Pairgate.</p>
    <button type="button" onClick={refresh} disabled={loading} className="mt-3 rounded-xl bg-[#0757d5] px-4 py-2.5 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60">
      {loading ? 'Checking Pairgate…' : 'Refresh provider status'}
    </button>
    {message && <p className={'mt-3 text-sm font-medium ' + (ok ? 'text-emerald-700' : 'text-amber-800')}>{message}</p>}
  </div>;
}
