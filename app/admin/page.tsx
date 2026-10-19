import Link from 'next/link';
import {redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';
import AdminOrderActions from './OrderActions';
import RequeryPaymentButton from '@/components/payments/RequeryPaymentButton';
import {describeOrdered,describeReceived,DELIVERY_KEYS,providerCostOf} from '@/lib/order-summary';
import {maskPin} from '@/lib/pin-delivery';

const FILTERS:Array<[string,string]>=[['all','All'],['attention','Needs attention'],['unpaid','Unpaid'],['processing','Processing'],['completed','Completed'],['cancelled','Cancelled']];
const OPEN_STATUSES=['pending','processing','needs_information'];
const toneClass={good:'bg-emerald-50 text-emerald-800 border-emerald-200',wait:'bg-amber-50 text-amber-800 border-amber-200',bad:'bg-red-50 text-red-800 border-red-200',neutral:'bg-slate-50 text-slate-700 border-slate-200'} as const;
const paymentClass:Record<string,string>={paid:'bg-emerald-50 text-emerald-800',pending:'bg-amber-50 text-amber-800',unpaid:'bg-slate-100 text-slate-700',failed:'bg-red-50 text-red-800',refunded:'bg-purple-50 text-purple-800'};
const orderClass:Record<string,string>={completed:'bg-emerald-50 text-emerald-800',processing:'bg-blue-50 text-blue-800',needs_information:'bg-red-50 text-red-800',pending:'bg-amber-50 text-amber-800',cancelled:'bg-slate-100 text-slate-500'};
const naira=(v:unknown)=>'₦'+Number(v||0).toLocaleString();

export default async function Admin({searchParams}:{searchParams:Promise<{filter?:string;q?:string}>}){
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)redirect('/login?next=/admin');
  const {data:profile}=await supabase.from('profiles').select('role').eq('id',user.id).maybeSingle();
  if(profile?.role!=='admin')redirect('/dashboard');

  const admin=createAdminClient();
  const params=await searchParams;
  const filter=FILTERS.some(([key])=>key===params.filter)?String(params.filter):'all';
  const q=String(params.q||'').replace(/[%,()]/g,'').trim().slice(0,60);

  let query=admin.from('orders').select('id,reference,status,payment_status,amount,created_at,updated_at,customer_note,admin_note,form_data,profiles(full_name,phone),services(title,slug)').order('created_at',{ascending:false}).limit(200);
  if(filter==='attention')query=query.eq('payment_status','paid').in('status',OPEN_STATUSES as any);
  else if(filter==='unpaid')query=query.in('payment_status',['unpaid','pending','failed'] as any);
  else if(filter==='processing')query=query.eq('status','processing');
  else if(filter==='completed')query=query.eq('status','completed');
  else if(filter==='cancelled')query=query.eq('status','cancelled');
  if(q)query=query.ilike('reference','%'+q+'%');

  const [{data:orders},{count:totalOrders},{count:paidOrders},{count:attentionOrders},{count:completedOrders},{data:paidRows}]=await Promise.all([
    query,
    admin.from('orders').select('*',{count:'exact',head:true}),
    admin.from('orders').select('*',{count:'exact',head:true}).eq('payment_status','paid'),
    admin.from('orders').select('*',{count:'exact',head:true}).eq('payment_status','paid').in('status',OPEN_STATUSES as any),
    admin.from('orders').select('*',{count:'exact',head:true}).eq('status','completed'),
    admin.from('orders').select('amount').eq('payment_status','paid').limit(5000)
  ]);
  const revenue=(paidRows||[]).reduce((sum:number,row:any)=>sum+Number(row.amount||0),0);

  const ids=(orders||[]).map((o:any)=>o.id);
  const {data:txRows}=ids.length?await admin.from('provider_transactions').select('order_id,service_id,request_id,provider_reference,provider_status,status,amount,response,created_at').in('order_id',ids).order('created_at',{ascending:false}):{data:[] as any[]};
  const txByOrder=new Map<string,any[]>();
  for(const tx of txRows||[]){const list=txByOrder.get(tx.order_id)||[];list.push(tx);txByOrder.set(tx.order_id,list);}

  const cards:Array<[string,string|number,string?]>=[['Total orders',totalOrders??0],['Paid',paidOrders??0],['Paid, not yet delivered',attentionOrders??0,(attentionOrders??0)>0?'text-red-600':undefined],['Completed',completedOrders??0],['Paid revenue',naira(revenue)]];

  return <div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{cards.map(([label,value,color])=><div key={label} className="rounded-2xl bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">{label}</p><p className={'mt-2 text-3xl font-black '+(color||'text-[#0b1730]')}>{value}</p></div>)}</div>
    <div className="mt-6 rounded-3xl bg-white p-5 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 className="text-xl font-black">Order book</h2><p className="mt-1 text-sm text-slate-500">What each customer ordered, what they received, and what it cost.</p></div>
        <form className="flex gap-2" action="/admin"><input type="hidden" name="filter" value={filter}/><input name="q" defaultValue={q} placeholder="Search reference e.g. PCR-2355" className="w-56 rounded-xl border border-slate-200 px-3 py-2 text-sm"/><button className="rounded-xl bg-[#0757d5] px-4 py-2 text-sm font-bold text-white">Search</button></form>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">{FILTERS.map(([key,label])=><Link key={key} href={'/admin?filter='+key+(q?'&q='+encodeURIComponent(q):'')} className={'rounded-full px-4 py-1.5 text-sm font-bold '+(filter===key?'bg-[#071a3a] text-white':'bg-slate-100 text-slate-600 hover:bg-slate-200')}>{label}</Link>)}</div>
      <p className="mt-3 text-xs text-slate-400">Showing the {(orders||[]).length} most recent order(s){filter!=='all'?' in “'+FILTERS.find(([k])=>k===filter)?.[1]+'”':''}{q?' matching “'+q+'”':''}.</p>

      <div className="mt-5 space-y-4">{(orders||[]).map((o:any)=>{
        const customer=Array.isArray(o.profiles)?o.profiles[0]:o.profiles;
        const service=Array.isArray(o.services)?o.services[0]:o.services;
        const slug=String(service?.slug||'');
        const form=(o.form_data||{}) as Record<string,any>;
        const ordered=describeOrdered(slug,form);
        const received=describeReceived(slug,String(o.status),form);
        const txs=txByOrder.get(o.id)||[];
        const latest=txs[0];
        const cost=providerCostOf(txs);
        const paid=o.payment_status==='paid';
        const margin=paid&&cost!==null?Number(o.amount||0)-cost:null;
        const genericFields=Object.entries(form).filter(([k,v])=>!DELIVERY_KEYS.includes(k)&&v!==null&&typeof v!=='object'&&String(v).trim()!=='');
        return <div key={o.id} className="rounded-2xl border border-slate-200 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-black"><Link href={'/admin/orders/'+o.id} className="hover:text-[#0757d5] hover:underline">{service?.title||'Service'}</Link></p>
              <p className="mt-1 text-xs font-bold text-slate-400">{o.reference} · {new Date(o.created_at).toLocaleString()}</p>
              <p className="mt-2 text-sm"><b>{customer?.full_name||'Unknown customer'}</b> · {customer?.phone||'No phone'}</p>
            </div>
            <div className="text-right text-sm">
              <p className="text-lg font-black">{naira(o.amount)}</p>
              <div className="mt-1 flex flex-wrap justify-end gap-1.5"><span className={'rounded-full px-2.5 py-1 text-xs font-bold capitalize '+(paymentClass[o.payment_status]||'bg-slate-100')}>Payment: {String(o.payment_status).replace('_',' ')}</span><span className={'rounded-full px-2.5 py-1 text-xs font-bold capitalize '+(orderClass[o.status]||'bg-slate-100')}>Order: {String(o.status).replace('_',' ')}</span></div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">Ordered</p>
              {ordered.headline?<p className="mt-1 text-sm font-bold text-slate-800">{ordered.headline}</p>:<div className="mt-1 space-y-0.5">{genericFields.slice(0,6).map(([k,v])=><p key={k} className="break-words text-sm text-slate-700"><span className="font-bold capitalize">{k.replaceAll('_',' ')}:</span> {String(v)}</p>)}{genericFields.length===0&&<p className="text-sm text-slate-500">No details submitted.</p>}</div>}
              {o.customer_note&&<p className="mt-2 text-xs text-slate-500"><b>Note:</b> {o.customer_note}</p>}
            </div>
            <div className={'rounded-2xl border p-4 '+toneClass[received.tone]}>
              <p className="text-[11px] font-black uppercase tracking-wide opacity-70">Received</p>
              <p className="mt-1 text-sm font-bold">{received.label}</p>
              {received.pins.length>0&&<details className="mt-2"><summary className="cursor-pointer text-xs font-bold">{received.pins.map(p=>maskPin(p.PIN)).join(', ')} — show full</summary><div className="mt-2 space-y-1">{received.pins.map((p,i)=><p key={i} className="break-all font-mono text-xs">PIN {p.PIN}{p.Serial?' · SN '+p.Serial:''}</p>)}</div></details>}
              {received.token&&<details className="mt-2"><summary className="cursor-pointer text-xs font-bold">Token — show</summary><p className="mt-1 break-all font-mono text-xs">{received.token}</p></details>}
              {received.detail&&received.tone!=='good'&&<p className="mt-1 text-xs">{received.detail}</p>}
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 text-sm">
              <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">Provider (Pairgate)</p>
              {latest?<>
                <p className="mt-1"><b>Status:</b> <span className="capitalize">{String(latest.status).replace('_',' ')}</span>{latest.provider_status?' · '+latest.provider_status:''}</p>
                <p className="break-all text-xs text-slate-500">Ref: {latest.provider_reference||latest.request_id}</p>
                <p className="text-xs text-slate-500">{txs.length} attempt{txs.length>1?'s':''}{cost!==null?' · cost '+naira(cost):''}{margin!==null?' · margin '+naira(margin):''}</p>
              </>:<p className="mt-1 text-slate-500">{paid?'No provider purchase recorded.':'Not submitted yet.'}</p>}
            </div>
          </div>

          {o.admin_note&&<p className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-slate-700"><b>Admin note:</b> {o.admin_note}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3"><Link href={'/admin/orders/'+o.id} className="text-sm font-bold text-[#0757d5]">Open full details →</Link>{paid&&o.status!=='completed'&&o.status!=='cancelled'&&<RequeryPaymentButton orderId={o.id} paid/>}</div>
          <AdminOrderActions orderId={o.id} status={o.status} note={o.admin_note||''} amount={Number(o.amount||0)} paymentStatus={o.payment_status}/>
        </div>;
      })}{(!orders||orders.length===0)&&<p className="py-10 text-center text-slate-500">No orders match this view.</p>}</div>
    </div>
  </div>;
}
