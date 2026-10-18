import {notFound,redirect} from 'next/navigation';
import Link from 'next/link';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';
import DocumentUpload from './DocumentUpload';
import PayButton from '../PayButton';

export default async function OrderDetail({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)redirect('/login');

  // Verify ownership before using the service-role client to create private-file links.
  const {data:order}=await supabase
    .from('orders')
    .select('id,reference,status,payment_status,amount,created_at,updated_at,customer_note,admin_note,form_data,services(title,slug,category)')
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

  const expectedPins = Math.max(1, Number(order.form_data?.quantity || 1));
  const savedPinsText = typeof order.form_data?.delivery_pins === 'string' ? order.form_data.delivery_pins : '';
  const deliveredPinCount = Math.max((savedPinsText.match(/PIN:\s*(?!pending\b)[^|\n]+/gi) || []).length, typeof order.form_data?.delivery_pin === 'string' && order.form_data.delivery_pin.trim() ? 1 : 0);
  const missingRequiredDelivery = order.form_data?.pairgate_test_mode === true
    ? true
    : service?.slug === 'electricity-bill'
    ? !(typeof order.form_data?.delivery_pin === 'string' && order.form_data.delivery_pin.trim())
    : service?.slug === 'exam-pins' || service?.slug === 'data-pins'
    ? deliveredPinCount < expectedPins || /PIN pending/i.test(savedPinsText)
    : false;

  return <div>
    <div className="mb-5"><Link href="/dashboard/orders" className="text-sm font-bold text-[#0757d5]">← Back to my orders</Link></div>
    <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Order reference · {order.reference}</p><h1 className="mt-1 text-2xl font-black">{service?.title||'Service request'} details</h1><p className="mt-2 text-sm text-slate-500">Placed on {new Date(order.created_at).toLocaleString('en-NG',{dateStyle:'medium',timeStyle:'short'})}</p></div>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold capitalize text-[#0757d5]">{String(order.status).replace('_',' ')}</span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-400">Payment</p><p className="mt-1 font-bold capitalize">{String(order.payment_status).replace('_',' ')}</p></div>
        <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-400">Amount</p><p className="mt-1 font-bold">₦{Number(order.amount||0).toLocaleString()}</p>{Number(order.amount||0)<=0&&order.payment_status!=='paid'&&<p className="mt-2 text-sm text-amber-800">Awaiting a quote from Promise Computer Research. You will see the amount here when it is ready.</p>}{Number(order.amount||0)>0&&['unpaid','failed'].includes(String(order.payment_status))&&<div className="mt-3"><PayButton orderId={order.id}/></div>}</div>
      </div>
      {order.form_data?.pairgate_test_mode!==true && typeof order.form_data?.delivery_pin==='string' && order.form_data.delivery_pin.trim() && <div className="mt-5 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-5"><p className="text-xs font-black uppercase tracking-wide text-emerald-800">{service?.slug==='electricity-bill'?'Your prepaid electricity token':service?.slug==='exam-pins'?'Your examination PIN':'Your delivery PIN / token'}</p><p className="mt-2 break-words font-mono text-xl font-black tracking-wide text-slate-900">{order.form_data.delivery_pin}</p><p className="mt-2 text-sm text-emerald-900">{service?.slug==='electricity-bill'?'Enter this token on your prepaid meter. Keep it for your records.':'Keep this delivery information for your records.'}</p></div>}
      {order.form_data?.pairgate_test_mode!==true && (service?.slug==='exam-pins' || service?.slug==='data-pins') && typeof order.form_data?.delivery_pins==='string' && order.form_data.delivery_pins.trim() && <div className="mt-5 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-5"><p className="text-xs font-black uppercase tracking-wide text-emerald-800">service?.slug==='data-pins'?'Your recharge card PIN details':'All examination PIN delivery details'</p><p className="mt-2 whitespace-pre-wrap break-words font-mono text-sm font-bold text-slate-900">{order.form_data.delivery_pins}</p></div>}
      {order.payment_status==='paid' && String(service?.category||'').trim().toUpperCase()==='JAMB' && <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="font-black text-emerald-900">Payment received</p><p className="mt-1 text-sm text-emerald-800">PCR will fulfil this service manually. If you want to send your order details on WhatsApp as well, you can do so below; this is optional.</p><a href={"https://wa.me/2347058391188?text="+encodeURIComponent("PCR JAMB SERVICE ORDER\nService: "+String(service?.title||"") +"\nOrder reference: "+order.reference+"\nFull name: "+String(order.form_data?.full_name||"")+"\nPhone: "+String(order.form_data?.phone||"")+"\nExam year: "+String(order.form_data?.exam_year||"")+"\nJAMB registration number: "+String(order.form_data?.jamb_registration_number||"Not provided"))} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white">Optional: Continue on WhatsApp</a></div>}
      <div className="mt-5">
        <p className="text-xs font-black uppercase tracking-wide text-slate-400">Submitted information</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{Object.entries(order.form_data||{}).filter(([key])=>!['pairgate_test_mode','delivery_pin','delivery_pins','delivery_completed_at','delivery_status_message','provider_reference','provider_response','diagnosis','cause','error','admin_note'].includes(key)).map(([key,value])=><div key={key} className="rounded-2xl border border-slate-200 p-4"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{key.replaceAll('_',' ')}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold text-slate-700">{typeof value==="object"&&value!==null?JSON.stringify(value,null,2):String(value??"—")}</p></div>)}</div>
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
