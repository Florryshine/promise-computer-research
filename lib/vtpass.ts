import crypto from 'crypto';
import {createAdminClient} from '@/lib/supabase/admin';

const BASE_URL=(process.env.VTPASS_BASE_URL||'https://sandbox.vtpass.com/api').replace(/\/$/,'');
const API_KEY=process.env.VTPASS_API_KEY;
const SECRET_KEY=process.env.VTPASS_SECRET_KEY;
const PUBLIC_KEY=process.env.VTPASS_PUBLIC_KEY;

function headers(){return {'Content-Type':'application/json','api-key':API_KEY||'','secret-key':SECRET_KEY||'','public-key':PUBLIC_KEY||''};}
function clean(v:unknown){return String(v??'').trim();}
function first(obj:any,...keys:string[]){for(const k of keys){const v=obj?.[k];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;}return '';}

export function vtpassConfigured(){return Boolean(API_KEY&&SECRET_KEY&&PUBLIC_KEY&&BASE_URL);}

function normalizeService(slug:string, form:any){
  const s=slug.toLowerCase();
  if(/airtime|air-time|recharge/.test(s)) return {serviceID:first(form,'serviceID')||'mtn-airtime',amount:Number(first(form,'amount')),phone:first(form,'phone','phone_number','billersCode')};
  if(/data/.test(s)) return {serviceID:first(form,'serviceID')||'mtn-data',variation_code:first(form,'variation_code','variationCode'),billersCode:first(form,'billersCode','phone','phone_number'),phone:first(form,'phone','phone_number','billersCode'),subscription_type:first(form,'subscription_type')||'prepaid'};
  if(/dstv|gotv|cable|tv/.test(s)) return {serviceID:first(form,'serviceID')||'dstv',billersCode:first(form,'billersCode','smartcard','smartcard_number','decoder_number'),variation_code:first(form,'variation_code','variationCode'),subscription_type:first(form,'subscription_type')||'change'};
  if(/electric|power|bill/.test(s)) return {serviceID:first(form,'serviceID')||'ikeja-electric',billersCode:first(form,'billersCode','meter_number','meterNumber'),variation_code:first(form,'variation_code','variationCode'),phone:first(form,'phone','phone_number'),subscription_type:first(form,'subscription_type')||'prepaid'};
  return null;
}

function makeRequestId(order:any){return 'PCR-VT-'+String(order.reference).replace(/[^A-Za-z0-9_-]/g,'')+'-'+crypto.createHash('sha1').update(order.id).digest('hex').slice(0,10);}

export async function fulfillOrder(orderId:string){
  const admin=createAdminClient();
  const {data:order,error}=await admin.from('orders').select('id,reference,status,payment_status,amount,form_data,customer_id,services(slug,title)').eq('id',orderId).maybeSingle();
  if(error) throw error;
  if(!order) throw new Error('Order not found');
  if(order.payment_status!=='paid') return {status:'skipped',message:'Order is not paid.'};

  const slug=(order as any).services?.slug||'';
  const form=(order.form_data||{}) as Record<string,unknown>;
  const payload=normalizeService(slug,form);
  if(!payload) return {status:'skipped',message:'Service is not configured for VTpass automation.'};

  const missing=Object.entries(payload).filter(([k,v])=>k!=='subscription_type'&&k!=='variation_code'&&k!=='amount'&&!clean(v));
  if(missing.length) throw new Error('Missing VTpass field(s): '+missing.map(([k])=>k).join(', '));
  if(['mtn-airtime'].includes(String(payload.serviceID))&&(!payload.amount||payload.amount<=0)) throw new Error('Airtime amount is missing.');
  if(!vtpassConfigured()) throw new Error('VTpass environment variables are missing.');

  const request_id=makeRequestId(order);
  const {data:existing}=await admin.from('provider_transactions').select('*').eq('request_id',request_id).maybeSingle();
  if(existing?.status==='successful'){
    await admin.from('orders').update({status:'completed',admin_note:'VTpass fulfillment completed automatically.'}).eq('id',order.id);
    return {status:'successful',message:'Already fulfilled.',transaction:existing};
  }

  const amount=Number((payload as any).amount||order.amount||0);
  const body:any={request_id,serviceID:(payload as any).serviceID,amount:amount>0?amount:undefined,billersCode:(payload as any).billersCode,variation_code:(payload as any).variation_code,phone:(payload as any).phone,subscription_type:(payload as any).subscription_type};
  Object.keys(body).forEach(k=>{if(body[k]===undefined||body[k]==='')delete body[k];});

  if(!existing){
    const {error:insertError}=await admin.from('provider_transactions').insert({order_id:order.id,provider:'vtpass',request_id,service_id:String(body.serviceID),amount:body.amount||null,status:'pending',provider_status:'pending',request_data:body});
    if(insertError && !String(insertError.message).toLowerCase().includes('duplicate')) throw insertError;
  }

  const response=await fetch(BASE_URL+'/pay',{method:'POST',headers:headers(),body:JSON.stringify(body),cache:'no-store'});
  const raw=await response.text();
  let result:any={}; try{result=JSON.parse(raw);}catch{result={message:raw};}
  const code=String(result?.code||result?.content?.transactions?.status||result?.content?.transactions?.transaction?.status||'');
  const statusText=String(result?.content?.transactions?.status||result?.content?.transactions?.transaction?.status||result?.response_description||result?.message||'').toLowerCase();
  const successful=response.ok && (code==='000' || /delivered|completed|successful|success/.test(statusText));
  const pending=response.ok && !successful && !/failed|error|rejected/.test(statusText);
  const failed=!successful&&!pending;

  await admin.from('provider_transactions').update({
    provider_reference:first(result,'transactionId','transaction_id')||first(result?.content?.transactions,'transactionId','transaction_id'),
    provider_status:code||statusText||'unknown',
    status:successful?'successful':failed?'failed':'pending',
    response:result
  }).eq('request_id',request_id);

  if(successful){
    await admin.from('orders').update({status:'completed',admin_note:'VTpass fulfillment completed automatically.'}).eq('id',order.id);
    await admin.from('notifications').insert({user_id:(order as any).customer_id,title:'Order completed',message:'Your '+((order as any).services?.title||'service')+' order '+order.reference+' was completed automatically.'});
  } else if(failed){
    await admin.from('orders').update({status:'needs_information',admin_note:'VTpass could not complete this order automatically. Provider response recorded for review.'}).eq('id',order.id);
  }
  return {status:successful?'successful':failed?'failed':'pending',result};
}
