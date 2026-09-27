'use client';
import {useState} from 'react';
export default function MarkNotificationsRead({hasUnread}:{hasUnread:boolean}){
  const [loading,setLoading]=useState(false);
  async function markAll(){
    setLoading(true);
    const response=await fetch('/api/notifications',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({all:true})});
    if(response.ok) window.location.reload(); else setLoading(false);
  }
  return hasUnread?<button onClick={markAll} disabled={loading} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50">{loading?'Marking…':'Mark all as read'}</button>:null;
}