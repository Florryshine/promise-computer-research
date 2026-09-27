'use client';
import {useState} from 'react';

export default function AdminDocumentActions({documentId,orderId}:{documentId:string;orderId:string}){
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');
  async function remove(){
    if(!window.confirm('Remove this document from the order?'))return;
    setLoading(true);setMessage('');
    const response=await fetch('/api/admin/document',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({documentId})});
    const data=await response.json();
    if(!response.ok){setMessage(data.error||'Could not remove document.');setLoading(false);return;}
    window.location.reload();
  }
  async function requestDocument(){
    const note=window.prompt('Tell the customer what document is needed:','Please upload the required document for this order.');
    if(note===null)return;
    setLoading(true);setMessage('');
    const response=await fetch('/api/admin/document',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId,note})});
    const data=await response.json();
    setMessage(response.ok?'Customer notified.':data.error||'Could not notify customer.');
    setLoading(false);
  }
  return <div className="flex flex-wrap gap-2">
    <button onClick={remove} disabled={loading} className="rounded-xl border border-red-200 px-3 py-2 text-xs font-bold text-red-600 disabled:opacity-50">Remove</button>
    <button onClick={requestDocument} disabled={loading} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">Request document</button>
    {message&&<span className="self-center text-xs text-slate-500">{message}</span>}
  </div>;
}