'use client';

import { useState } from 'react';

const statuses = ['pending', 'processing', 'needs_information', 'completed', 'cancelled'];

export default function AdminOrderActions({
  orderId,
  status,
  note,
  amount,
  paymentStatus
}: {
  orderId: string;
  status: string;
  note: string;
  amount: number;
  paymentStatus: string;
}) {
  const [s, setS] = useState(status);
  const [n, setN] = useState(note);
  const [quote, setQuote] = useState(amount > 0 ? String(amount) : '');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const canQuote = paymentStatus !== 'paid' && paymentStatus !== 'pending';

  async function send(payload: Record<string, unknown>, success: string) {
    setLoading(true);
    setMsg('');
    try {
      const r = await fetch('/api/admin/order', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, status: s, adminNote: n, ...payload })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save.');
      setMsg(success);
      if (payload.quoteAmount !== undefined) window.location.reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setLoading(false);
    }
  }

  return <div className="mt-5 flex flex-col gap-4 border-t pt-4">
    <label className="text-xs font-bold">Order status
      <select value={s} onChange={e => setS(e.target.value)} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm">
        {statuses.map(x => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}
      </select>
    </label>
    <label className="text-xs font-bold">Admin note / quote details
      <textarea value={n} onChange={e => setN(e.target.value)} placeholder="Optional explanation, requirements or quote details" rows={4} maxLength={2000} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm" />
    </label>
    <button onClick={() => send({}, 'Order details saved.')} disabled={loading} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold disabled:opacity-60">
      {loading ? 'Saving…' : 'Save order update'}
    </button>

    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
      <h3 className="font-black text-slate-900">Set / change customer quote</h3>
      <p className="mt-1 text-xs leading-5 text-slate-600">Enter the full amount the customer should pay. Saving a quote updates the order amount, makes payment available, and sends an in-app notification.</p>
      <label className="mt-3 block text-xs font-bold">Quote amount (₦)
        <input value={quote} onChange={e => setQuote(e.target.value)} inputMode="decimal" type="number" min="1" step="0.01" placeholder="e.g. 15000" disabled={!canQuote || loading} className="mt-1 block w-full rounded-xl border bg-white px-3 py-2 text-sm disabled:bg-slate-100" />
      </label>
      <button onClick={() => {
        if (!quote.trim() || !Number.isFinite(Number(quote)) || Number(quote) <= 0) {
          setMsg('Enter a valid quote greater than ₦0.');
          return;
        }
        if (!window.confirm('Set the order total to ₦' + Number(quote).toLocaleString('en-NG') + ' and notify the customer?')) return;
        void send({ quoteAmount: Number(quote) }, 'Quote saved and customer notified.');
      }} disabled={!canQuote || loading || !quote.trim()} className="mt-3 w-full rounded-xl bg-[#0757d5] px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
        {loading ? 'Saving…' : 'Save quote & notify customer'}
      </button>
      {!canQuote && <p className="mt-2 text-xs font-semibold text-amber-800">Requoting is disabled because payment is {paymentStatus}. Resolve/verify the payment first; paid orders cannot be requoted.</p>}
    </div>
    {msg && <p role="status" className="text-xs font-semibold text-slate-600">{msg}</p>}
  </div>;
}
