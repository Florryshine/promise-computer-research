import {createClient} from '@/lib/supabase/server';
import Link from 'next/link';
import PayButton from './PayButton';
import RequeryPaymentButton from '@/components/payments/RequeryPaymentButton';

export default async function Orders({searchParams}:{searchParams:Promise<{new?:string;pay?:string}>}){
  const params=await searchParams;
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  const {data:ordersData}=await supabase.from('orders').select('id,reference,status,payment_status,amount,created_at,customer_note,services(title)').eq('customer_id',user!.id).order('created_at',{ascending:false});
  const orders=ordersData??[];
  return <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-7">
    <div className="mb-6"><h1 className="text-2xl font-black">My Orders</h1><p className="mt-1 text-sm text-slate-500">Every request you submit will appear here.</p></div>
    {orders.length===0?<div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center"><p className="font-bold">No orders yet.</p><Link href="/services" className="mt-4 inline-flex rounded-xl bg-[#0757d5] px-5 py-3 font-bold text-white">Browse services</Link></div>:<div className="space-y-3">
      {orders.map((o:any)=><div key={o.id} className="rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black"><Link href={'/dashboard/orders/'+o.id} className="hover:text-[#0757d5] hover:underline">{o.services?.title||'Service request'}</Link></p><p className="mt-1 text-xs font-bold text-slate-400">{o.reference} · {new Date(o.created_at).toLocaleDateString()}</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold capitalize text-[#0757d5]">{String(o.status).replace('_',' ')}</span></div>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4 text-sm"><div className="flex flex-wrap gap-5"><span><b>Payment:</b> <span className="capitalize">{String(o.payment_status).replace('_',' ')}</span></span><span><b>Amount:</b> ₦{Number(o.amount||0).toLocaleString()}</span></div>
          {Number(o.amount)>0 && o.payment_status==='pending' && <RequeryPaymentButton orderId={o.id}/>} 
          {Number(o.amount)>0 && o.payment_status==='failed' && <PayButton orderId={o.id} auto={params.pay==='1' && params.new===o.id}/>} 
        </div>
        {Number(o.amount)>0 && o.payment_status==='pending' && <p className="mt-2 text-xs text-slate-500">A payment is already in progress. Check its status instead of paying again.</p>}
      </div>)}
    </div>}
  </section>
}
