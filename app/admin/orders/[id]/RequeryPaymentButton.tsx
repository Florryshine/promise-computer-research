'use client';

import {useState} from 'react';

export default function RequeryPaymentButton({orderId,disabled=false}:{orderId:string;disabled?:boolean}) {
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState<any>(null);

  async function requery() {
    setLoading(true); setResult(null);
    try {
      const r=await fetch('/api/paystack/requery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId})});
      const d=await r.json();
      setResult(d);
      if (d.ok || d.code === 'already_paid' || d.code === 'payment_recorded_order_update_failed') {
        setTimeout(()=>window.location.reload(),700);
      }
    } catch {
      setResult({message:'Could not contact the payment service. Try again.'});
    } finally { setLoading(false); }
  }

  return <div className="mt-4 rounded-2xl bg-slate-50 p-4">
    <button onClick={requery} disabled={disabled||loading} className="rounded-xl bg-[#0757d5] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
      {loading?'Checking Paystack…':'Re-query Paystack'}
    </button>
    {result&&<div className="mt-3 text-sm">
      <p className="font-bold">{result.message||result.cause}</p>
      {result.diagnosis&&<div className="mt-2 space-y-1 text-xs text-slate-600">
        <p><b>Diagnosis:</b> {result.diagnosis.code}</p>
        <p><b>Cause:</b> {result.diagnosis.cause}</p>
        <p><b>Gateway status:</b> {result.diagnosis.gatewayStatus||'—'}</p>
        <p><b>Returned amount:</b> {result.diagnosis.returnedAmount==null?'—':'₦'+Number(result.diagnosis.returnedAmount).toLocaleString()}</p>
        <p><b>Returned currency:</b> {result.diagnosis.returnedCurrency||'—'}</p>
      </div>}
    </div>}
  </div>;
}
