'use client';

import { useState } from 'react';

export default function ManualDelivery({ orderId, slug, quantity }: { orderId: string; slug: string; quantity: number }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const token = slug === 'electricity-bill';

  async function submit() {
    if (!text.trim()) { setOk(false); setMsg('Paste the ' + (token ? 'token' : 'PIN(s)') + ' first.'); return; }
    if (!window.confirm('Send this to the customer now? Only use ' + (token ? 'a token' : 'PINs') + ' you copied from Pairgate for THIS order.')) return;
    setLoading(true); setMsg('');
    try {
      const response = await fetch('/api/admin/order/deliver', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, delivery: text }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not deliver.');
      setOk(true); setMsg(data.complete ? 'Delivered. The order is completed and the customer has been notified.' : 'Saved ' + data.delivered + ' of ' + data.expected + '. The order stays in processing.');
      setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      setOk(false); setMsg(error instanceof Error ? error.message : 'Could not deliver.');
    } finally { setLoading(false); }
  }

  return <section className="rounded-3xl border-2 border-amber-300 bg-amber-50 p-5 sm:p-6">
    <h2 className="text-lg font-black text-amber-950">Deliver manually</h2>
    <p className="mt-1 text-xs leading-5 text-amber-900">Use this when Pairgate sold the {token ? 'token' : 'PIN'} but it never reached the order. Copy it from the Pairgate dashboard and paste it here. {token ? '' : 'One PIN per line, optionally followed by a serial (PIN | SERIAL). This order expects ' + quantity + '.'} This replaces any PINs already saved on the order.</p>
    <textarea value={text} onChange={e => setText(e.target.value)} rows={token ? 2 : Math.min(6, Math.max(3, quantity + 1))} placeholder={token ? 'Electricity token' : 'PIN | SERIAL'} className="mt-3 block w-full rounded-xl border px-3 py-2 font-mono text-sm" />
    <button type="button" onClick={submit} disabled={loading} className="mt-3 w-full rounded-xl bg-amber-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{loading ? 'Delivering…' : 'Save & notify customer'}</button>
    {msg && <p role="status" className={'mt-2 text-xs font-semibold ' + (ok ? 'text-emerald-700' : 'text-red-700')}>{msg}</p>}
  </section>;
}
