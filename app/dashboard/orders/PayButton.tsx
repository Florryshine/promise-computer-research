'use client';
import {useEffect,useState} from 'react';
export default function PayButton({orderId,auto=false}:{orderId:string;auto?:boolean}){
 const [loading,setLoading]=useState(false); const [error,setError]=useState('');
 async function pay(){setLoading(true);setError('');try{const r=await fetch('/api/paystack/initialize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to start payment.');if(d.alreadyPaid){location.reload();return;}location.href=d.authorization_url;}catch(e){setError(e instanceof Error?e.message:'Payment error');setLoading(false);}}
 useEffect(()=>{if(auto) pay(); // eslint-disable-next-line react-hooks/exhaustive-deps
 },[auto]);
 return <div>{error&&<p className="mb-2 text-xs text-red-600">{error}</p>}<button onClick={pay} disabled={loading} className="rounded-xl bg-[#0757d5] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{loading?'Opening payment…':'Pay now'}</button></div>;
}