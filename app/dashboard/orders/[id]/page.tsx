import {notFound,redirect} from 'next/navigation';
import Link from 'next/link';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';
import DocumentUpload from './DocumentUpload';
import RequeryPaymentButton from '@/components/payments/RequeryPaymentButton';

export default async function OrderDetail({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)redirect('/login');

  // Verify ownership before using the service-role client to create private-file links.
  const {data:order}=await supabase
    .from('orders')
    .select('id,reference,status,payment_status,amount,created_at,updated_at,customer_note,admin_note,form_data,services(title)')
    .eq('id',id)
    .eq('customer_id',user.id)
    .maybeSingle();

  if(!order)notFound();
  const service=Array.isArray(order.services)?order.services[0]:order.services;

  const {data:docs}=await supabase
    .from('order_documents')
    .select('id,file_name,storage_path,mime_type,size_bytes,created_at')
    .eq('order_id',id)
    .order('created_at',{ascending:false});

  const admin=createAdminClient();
  const documents=await Promise.all((docs||[]).map(async d=>{
    const storage=admin.storage.from('order-documents');
    const [{data:viewData},{data:downloadData}]=await Promise.all([
      storage.createSignedUrl(d.storage_path,3600),
      storage.createSignedUrl(d.storage_path,3600,{download:d.file_name})
    ]);
    return {
      ...d,
      viewUrl:viewData?.signedUrl||null,
      downloadUrl:downloadData?.signedUrl||null,
      fromAdmin:d.storage_path.startsWith('admin/')
    };
  }));

  return <div>
    <div className="mb-5"><Link href="/dashboard/orders" className="text-sm font-bold text-[#0757d5]">← Back to my orders</Link></div>
    <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Order {order.reference}</p><h1 className="mt-1 text-2xl font-black">{service?.title||'Service request'}</h1></div>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold capitalize text-[#0757d5]">{String(order.status).replace('_',' ')}</span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-400">Payment</p><p className="mt-1 font-bold capitalize">{String(order.payment_status).replace('_',' ')}</p>{order.payment_status!=='paid'&&Number(order.amount||0)>0&&<RequeryPaymentButton orderId={order.id}/>}</div>
        <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-400">Amount</p><p className="mt-1 font-bold">₦{Number(order.amount||0).toLocaleString()}</p></div>
      </div>
      {order.admin_note&&<div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-[#0757d5]">Update from Promise Computer Research</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{order.admin_note}</p></div>}
      <div className="mt-5">
        <p className="text-xs font-black uppercase tracking-wide text-slate-400">Submitted information</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{Object.entries(order.form_data||{}).map(([key,value])=><div key={key} className="rounded-2xl border border-slate-200 p-4"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{key.replaceAll('_',' ')}</p><p className="mt-1 break-words text-sm font-semibold text-slate-700">{String(value??'—')}</p></div>)}</div>
      </div>
      <div className="mt-5">
        <p className="text-xs font-black uppercase tracking-wide text-slate-400">Documents</p>
        <p className="mt-1 text-sm text-slate-500">Open or download files attached to this order. Download links expire after one hour; reopen this page to generate fresh links.</p>
        <div className="mt-3 space-y-2">
          {documents.length?documents.map(d=><div key={d.id} className="rounded-2xl border border-slate-200 p-4">
            <p className="break-words font-bold">{d.file_name}</p>
            <p className="mt-1 text-xs text-slate-400">{d.fromAdmin?'Document from Promise Computer Research':'Document you uploaded'} · {d.mime_type||'File'}{d.size_bytes?' · '+Math.ceil(Number(d.size_bytes)/1024)+' KB':''}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {d.viewUrl&&<a href={d.viewUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700">View</a>}
              {d.downloadUrl&&<a href={d.downloadUrl} className="rounded-xl bg-[#0757d5] px-4 py-2 text-sm font-bold text-white">Download</a>}
              {!d.viewUrl&&!d.downloadUrl&&<span className="text-xs text-red-500">File link unavailable. Please contact support.</span>}
            </div>
          </div>):<p className="text-sm text-slate-500">No documents attached to this order.</p>}
          <DocumentUpload orderId={order.id}/>
        </div>
      </div>
    </section>
  </div>;
}
