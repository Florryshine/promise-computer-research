import {NextResponse} from 'next/server';
import {createAdminClient} from '@/lib/supabase/admin';

function first(obj:any,...keys:string[]){for(const k of keys){const v=obj?.[k];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;}return '';}

async function handle(request:Request){
  try{
    const body=await request.json().catch(()=>({}));
    const requestId=String(first(body,'request_id','requestId')||body?.content?.transactions?.request_id||'');
    const providerReference=String(first(body,'transactionId','transaction_id')||body?.content?.transactions?.transactionId||'');
    const statusText=String(first(body,'status','response_description','message')||body?.content?.transactions?.status||'').toLowerCase();
    if(!requestId&&!providerReference)return NextResponse.json({received:true});
    const admin=createAdminClient();
    let q=admin.from('provider_transactions').select('id,order_id');
    const {data:tx}=requestId?await q.eq('request_id',requestId).maybeSingle():await q.eq('provider_reference',providerReference).maybeSingle();
    if(!tx)return NextResponse.json({received:true});
    const successful=/000|delivered|completed|successful|success/.test(statusText);
    const failed=/failed|error|rejected/.test(statusText);
    await admin.from('provider_transactions').update({
      provider_reference:providerReference||null,
      provider_status:statusText||'callback',
      status:successful?'successful':failed?'failed':'pending',
      response:body
    }).eq('id',tx.id);
    if(successful){
      const {data:order}=await admin.from('orders').select('id,reference,customer_id,services(title)').eq('id',tx.order_id).maybeSingle();
      await admin.from('orders').update({status:'completed',admin_note:'VTpass fulfillment confirmed by provider callback.'}).eq('id',tx.order_id);
      if(order?.customer_id)await admin.from('notifications').insert({user_id:order.customer_id,title:'Order completed',message:'Your '+(order.services?.[0]?.title||'service')+' order '+order.reference+' has been completed.'});
    }else if(failed){
      await admin.from('orders').update({status:'needs_information',admin_note:'VTpass provider callback reported a failed transaction. Provider response is recorded for review.'}).eq('id',tx.order_id);
    }
    return NextResponse.json({received:true});
  }catch(error){console.error('VTpass callback error:',error);return NextResponse.json({received:false},{status:500});}
}
export async function POST(request:Request){return handle(request);}
export async function GET(request:Request){
  const url=new URL(request.url);
  return handle(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(url.searchParams.entries()))}));
}
