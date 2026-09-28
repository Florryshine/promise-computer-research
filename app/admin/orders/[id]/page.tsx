import {notFound,redirect} from 'next/navigation';
import Link from 'next/link';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';
import AdminOrderActions from '../../OrderActions';
import AdminDocumentActions from './AdminDocumentActions';

export default async function AdminOrderDetail({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)redirect('/login?next=/admin/orders/'+id);
  const {data:profile}=await supabase.from('profiles').select('role').eq('id',user.id).maybeSingle();
  if(profile?.role!=='admin')redirect('/dashboard');
  const admin=createAdminClient();
  const {data:order,error}=await admin.from('orders').select('id,reference,status,payment_status,amount,created_at,updated_at,customer_note,admin_note,form_data,profiles(full_name,phone),services(title,slug)').eq('id',id).maybeSingle();
  if(error||!order)notFound();
  const {data:docs}=await admin.from('order_documents').select('id,file_name,storage_path,mime_type,size_bytes,created_at').eq('order_id',id).order('created_at',{ascending:false});
  const documents=await Promise.all((docs||[]).map(async d=>({ ...d, url:(await admin.storage.from('order-documents').createSignedUrl(d.storage_path,3600)).data?.signedUrl||null })));
  return <div>
    <div className="mb-5"><Link href="/admin" className="text-sm font-bold text-[#0757d5]">← Back to orders</Link></div>
    <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
      <div className="space-y-5">
        <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Order</p><h1 className="mt-1 text-2xl font-black">{order.services?.title||'Service request'}</h1><p className="mt-1 text-xs font-bold text-slate-400">{order.reference} · {new Date(order.created_at).toLocaleString()}</p></div><div className="text-right"><p className="font-black">₦{Number(order.amount||0).toLocaleString()}</p><p className="mt-1 text-sm capitalize text-slate-500">{String(order.payment_status).replace('_',' ')}</p></div></div>
          <div className="mt-6 rounded-2xl border border-slate-200 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-400">Customer</p><p className="mt-2 font-bold">{order.profiles?.full_name||'Unknown'}</p><p className="mt-1 text-sm text-slate-600">{order.profiles?.phone||'No phone number'}</p></div>
          {order.customer_note&&<div className="mt-4 rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-400">Request details</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{order.customer_note}</p></div>}
          {order.form_data&&Object.keys(order.form_data).length>0&&<div className="mt-4"><p className="text-xs font-black uppercase tracking-wide text-slate-400">Submitted information</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{Object.entries(order.form_data as Record<string,unknown>).map(([key,value])=><div key={key} className="rounded-2xl border border-slate-200 p-4"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{key.replaceAll('_',' ')}</p><p className="mt-1 break-words text-sm font-semibold text-slate-700">{String(value??'—')}</p></div>)}</div></div>}
        </section>
        <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-7"><h2 className="text-lg font-black">Documents</h2><p className="mt-1 text-sm text-slate-500">Files attached to this order are available here.</p><div className="mt-4 space-y-2">{documents.length?documents.map(d=><div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4"><div><p className="font-bold">{d.file_name}</p><p className="text-xs text-slate-400">{d.mime_type||'File'} · {d.size_bytes?String(Math.ceil(d.size_bytes/1024))+' KB':''}</p></div><div className="flex flex-wrap gap-2">{d.url?<a href={d.url} target="_blank" rel="noreferrer" className="rounded-xl bg-[#0757d5] px-4 py-2 text-sm font-bold text-white">View / Download</a>:<span className="text-xs text-red-500">Link unavailable</span>}<AdminDocumentActions documentId={d.id} orderId={order.id}/></div></div>):<p className="rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">No documents attached.</p>}</div></section>
      </div>
      <aside><section className="rounded-3xl bg-white p-5 shadow-sm sm:p-6"><h2 className="mb-4 text-lg font-black">Update order</h2><AdminOrderActions orderId={order.id} status={order.status} note={order.admin_note||''}/></section></aside>
    </div>
  </div>;
}