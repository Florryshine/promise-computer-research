'use client';
import { useState } from 'react';

export default function ManualDeliveryForm({ orderId, slug, paymentStatus }: { orderId: string; slug: string; paymentStatus: string }) {
  const [delivery, setDelivery] = useState('');
  const [note, setNote] = useState('Delivery details reconciled manually from Pairgate.');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  if (paymentStatus !== 'paid' || !['electricity-bill', 'exam-pins', 'data-pins'].includes(slug)) return null;

  async function submit() {
    if (!delivery.trim()) { setMessage('Paste the token or PIN details first.'); return; }
    if (!window.confirm('Save these delivery details to the paid order and make them visible to the customer?')) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/admin/orders/' + orderId + '/delivery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery, note })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save delivery.');
      setMessage('Delivery saved. The order is completed; reload to verify.');
      setDelivery('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save delivery.'); }
    finally { setBusy(false); }
  }

  return <section className="mt-5 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
    <h3 className="font-black text-slate-900">Recover missing delivery details</h3>
    <p className="mt-1 text-sm text-slate-700">For a paid order, paste the token/PIN copied from Pairgate. Put each PIN on a separate line; WAEC PIN and serial can use PIN&lt;=&gt;SERIAL.</p>
    <textarea value={delivery} onChange={e => setDelivery(e.target.value)} rows={5} className="mt-3 w-full rounded-xl border bg-white p-3 font-mono text-sm" placeholder="Paste token or PIN/serial details here" />
    <label className="mt-3 block text-xs font-bold">Customer note
      <input value={note} onChange={e => setNote(e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm" />
    </label>
    <button onClick={submit} disabled={busy} className="mt-3 rounded-xl bg-amber-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save delivery to order'}</button>
    {message && <p role="status" className="mt-3 text-sm font-semibold">{message}</p>}
  </section>;
}
