import {createClient} from '@/lib/supabase/server'; import AdminOrderActions from './OrderActions';

export default async function Admin(){
  const supabase=await createClient();
  const [{data:orders},{count:totalOrders},{count:paidOrders},{count:processingOrders},{count:completedOrders}]=await Promise.all([
    supabase.from('orders').select('id,reference,status,payment_status,amount,created_at,customer_note,admin_note,profiles(full_name,phone),services(title)').order('created_at',{ascending:false}),
    supabase.from('orders').select('*',{count:'exact',head:true}),
    supabase.from('orders').select('*',{count:'exact',head:true}).eq('payment_status','paid'),
    supabase.from('orders').select('*',{count:'exact',head:true}).eq('status','processing'),
    supabase.from('orders').select('*',{count:'exact',head:true}).eq('status','completed')
  ]);
  const cards=[['Total orders',totalOrders??0],['Paid',paidOrders??0],['Processing',processingOrders??0],['Completed',completedOrders??0]];
  return <div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label,value])=><div key={String(label)} className="rounded-2xl bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">{label}</p><p className="mt-2 text-3xl font-black text-[#0b1730]">{value}</p></div>)}</div>
    <div className="mt-6 rounded-3xl bg-white p-5 shadow-sm sm:p-7">
      <div className="mb-6"><h2 className="text-xl font-black">Orders</h2><p className="mt-1 text-sm text-slate-500">Manage customer requests, payment status and processing progress.</p></div>
      <div className="space-y-4">{(orders??[]).map((o:any)=><div key={o.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex flex-wrap justify-between gap-4"><div><p className="font-black">{o.services?.title||'Service'}</p><p className="mt-1 text-xs font-bold text-slate-400">{o.reference} · {new Date(o.created_at).toLocaleString()}</p><p className="mt-3 text-sm"><b>Customer:</b> {o.profiles?.full_name||'Unknown'} · {o.profiles?.phone||'No phone'}</p>{o.customer_note&&<p className="mt-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{o.customer_note}</p>}</div><div className="text-right text-sm"><p className="font-black">₦{Number(o.amount||0).toLocaleString()}</p><p className="mt-1 capitalize text-slate-500">{String(o.payment_status).replace('_',' ')}</p></div></div><AdminOrderActions orderId={o.id} status={o.status} note={o.admin_note||''}/></div>)}{(!orders||orders.length===0)&&<p className="py-10 text-center text-slate-500">No orders yet.</p>}</div>
    </div>
  </div>;
}