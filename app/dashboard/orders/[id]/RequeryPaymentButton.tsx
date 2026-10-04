'use client';

import {useState} from 'react';

export default function RequeryPaymentButton({orderId,disabled=false}:{orderId:string;disabled?:boolean}) {
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');

  async function requery() {
    setLoading(true); setMessage('');
    try {
      const r=await fetch('/api/paystack/requery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId})});
      const d=await r.json();
      setMessage(d.message || d.cause || 'Re-query completed.');
      if (d.ok || d.code === 'already_paid' || d.code === 'payment_recorded_order_update_failed') {
        setTimeout(()=>window.location.reload(),700);
      }
    } catch {
      setMessage('Could not contact the payment service. Try again.');
    } finally { setLoading(false); }
  }

  return <div className="mt-4">
    <button onClick={requery} disabled={disabled||loading} className="rounded-xl bg-[#0757d5] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
      {loading?'Checking Paystack…':'Re-query payment'}
    </button>
    {message&&<p className="mt-2 text-xs font-semibold text-slate-600">{message}</p>}
  </div>;
}
