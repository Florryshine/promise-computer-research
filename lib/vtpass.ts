import crypto from 'crypto';
import {createAdminClient} from '@/lib/supabase/admin';

const BASE_URL=(process.env.VTPASS_BASE_URL||'https://sandbox.vtpass.com/api').replace(/\/$/,'');
const API_KEY=process.env.VTPASS_API_KEY?.trim();
const SECRET_KEY=process.env.VTPASS_SECRET_KEY?.trim();
const PUBLIC_KEY=process.env.VTPASS_PUBLIC_KEY?.trim();

function headers(){return {'Content-Type':'application/json','api-key':API_KEY||'','secret-key':SECRET_KEY||'','public-key':PUBLIC_KEY||''};}
function first(obj:any,...keys:string[]){for(const k of keys){const v=obj?.[k];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;}return '';}
function clean(v:unknown){return String(v??'').trim();}
export function vtpassConfigured(){return Boolean(API_KEY&&SECRET_KEY&&PUBLIC_KEY&&BASE_URL);}

export async function vtpassVariations(serviceID:string){
  if(!vtpassConfigured()) throw new Error('VTpass environment variables are missing.');
  const r=await fetch(BASE_URL+'/service-variations?serviceID='+encodeURIComponent(serviceID),{headers:headers(),cache:'no-store'});
  const text=await r.text(); let data:any; try{data=JSON.parse(text)}catch{throw new Error('Invalid VTpass variations response.');}
  if(!r.ok || String(data?.response_description||'')!=='000') throw new Error(data?.response_description||data?.message||'Could not load VTpass variations.');
  return data;
}

export async function verifyMerchant(serviceID:string,billersCode:string,type?:string){
  if(!vtpassConfigured()) throw new Error('VTpass environment variables are missing.');
  const body:any={serviceID,billersCode}; if(type) body.type=type;
  const r=await fetch(BASE_URL+'/merchant-verify',{method:'POST',headers:headers(),body:JSON.stringify(body),cache:'no-store'});
  const text=await r.text(); let data:any; try{data=JSON.parse(text)}catch{throw new Error('Invalid VTpass verification response.');}
  if(!r.ok || String(data?.code||data?.response_description||'')!=='000') throw new Error(data?.response_description||data?.message||'VTpass verification failed.');
  return data;
}

function makeRequestId(order:any){return 'PCR-VT-'+String(order.reference).replace(/[^A-Za-z0-9_-]/g,'')+'-'+crypto.createHash('sha1').update(order.id).digest('hex').slice(0,10);}

function networkService(network:string,type:'airtime'|'data'){
  const n=clean(network).toLowerCase();
  if(n==='mtn') return type==='airtime'?'mtn':'mtn-data';
  if(n==='airtel') return type==='airtime'?'airtel':'airtel-data';
  if(n==='glo') return type==='airtime'?'glo':'glo-data';
  if(n==='9mobile'||n==='etisalat') return type==='airtime'?'etisalat':'etisalat-data';
  return '';
}

function normalized(order:any){
  const slug=String(order.services?.slug||'');
  const form=(order.form_data||{}) as Record<string,any>;
  if(slug==='airtime-recharge'){
    const serviceID=networkService(form.network,'airtime');
    return {kind:'airtime',serviceID,amount:Number(form.provider_amount||form.amount),phone:clean(form.phone_number||form.phone)};
  }
  if(slug==='data-subscription'){
    const serviceID=networkService(form.network,'data');
    return {kind:'data',serviceID,variation_code:clean(form.variation_code),amount:Number(form.provider_amount||form.amount),billersCode:clean(form.phone_number||form.phone),phone:clean(form.phone_number||form.phone)};
  }
  if(slug==='dstv-subscription'){
    return {kind:'dstv',serviceID:'dstv',variation_code:clean(form.variation_code),amount:Number(form.provider_amount||form.amount),billersCode:clean(form.smartcard_number||form.billersCode),phone:clean(form.phone||form.phone_number),subscription_type:clean(form.subscription_type)||'change'};
  }
  if(slug==='electricity-bill'){
    return {kind:'electricity',serviceID:'ikeja-electric',variation_code:clean(form.meter_type).toLowerCase(),amount:Number(form.provider_amount||form.amount),billersCode:clean(form.meter_number||form.billersCode),phone:clean(form.phone||form.phone_number)};
  }
  return null;
}

export async function fulfillOrder(orderId:string){
  const admin=createAdminClient();
  const {data:order,error}=await admin.from('orders').select('id,reference,status,payment_status,amount,form_data,customer_id,services(slug,title)').eq('id',orderId).maybeSingle();
  if(error) throw error;
  if(!order) throw new Error('Order not found');
  if(order.payment_status!=='paid') return {status:'skipped',message:'Order is not paid.'};

  const p=normalized(order);
  if(!p) return {status:'skipped',message:'Service is not configured for VTpass automation.'};
  if(!p.serviceID) throw new Error('Unsupported network selected.');
  if(!p.billersCode && ['data','dstv','electricity'].includes(p.kind)) throw new Error('Recipient/meter/smartcard number is missing.');
  if(!p.phone && ['airtime','data','dstv','electricity'].includes(p.kind)) throw new Error('Phone number is missing.');
  if(!Number.isFinite(p.amount)||p.amount<=0) throw new Error('Provider purchase amount is missing.');
  if(p.kind==='data'&&!p.variation_code) throw new Error('Data variation is missing.');
  if(p.kind==='dstv'&&p.subscription_type==='change'&&!p.variation_code) throw new Error('DStv bouquet variation is missing.');
  if(!vtpassConfigured()) throw new Error('VTpass environment variables are missing.');

  if(p.kind==='dstv'){
    const verify=await verifyMerchant('dstv',p.billersCode);
    if(!verify?.content) throw new Error('DStv smartcard could not be verified.');
  }
  if(p.kind==='electricity'){
    const verify=await verifyMerchant('ikeja-electric',p.billersCode,p.variation_code);
    if(!verify?.content || verify.content.WrongBillersCode===true) throw new Error('Electricity meter could not be verified.');
  }

  const request_id=makeRequestId(order);
  const {data:existing}=await admin.from('provider_transactions').select('*').eq('request_id',request_id).maybeSingle();
  if(existing?.status==='successful'){
    await admin.from('orders').update({status:'completed',admin_note:'VTpass fulfillment completed automatically.'}).eq('id',order.id);
    return {status:'successful',message:'Already fulfilled.',transaction:existing};
  }

  const body:any={request_id,serviceID:p.serviceID,amount:p.amount};
  if(p.billersCode) body.billersCode=p.billersCode;
  if(p.variation_code) body.variation_code=p.variation_code;
  if(p.phone) body.phone=p.phone;
  if(p.subscription_type) body.subscription_type=p.subscription_type;

  if(!existing){
    const {error:insertError}=await admin.from('provider_transactions').insert({
      order_id:order.id,provider:'vtpass',request_id,service_id:p.serviceID,amount:p.amount,status:'pending',provider_status:'pending',request_data:body
    });
    if(insertError && !String(insertError.message).toLowerCase().includes('duplicate')) throw insertError;
  }

  const response=await fetch(BASE_URL+'/pay',{method:'POST',headers:headers(),body:JSON.stringify(body),cache:'no-store'});
  const raw=await response.text();
  let result:any={}; try{result=JSON.parse(raw)}catch{result={message:raw}};
  const tx=result?.content?.transactions||{};
  const code=String(result?.code||'');
  const statusText=String(tx?.status||result?.response_description||result?.message||'').toLowerCase();
  const successful=response.ok && (code==='000' || /delivered|completed|successful|success/.test(statusText));
  const pending=response.ok && !successful && !/failed|error|rejected/.test(statusText);
  const failed=!successful&&!pending;
  const providerReference=first(tx,'transactionId','transaction_id')||first(result,'transactionId','transaction_id');

  await admin.from('provider_transactions').update({
    provider_reference:providerReference||null,provider_status:code||statusText||'unknown',
    status:successful?'successful':failed?'failed':'pending',response:result
  }).eq('request_id',request_id);

  if(successful){
    await admin.from('orders').update({status:'completed',admin_note:'VTpass fulfillment completed automatically.'}).eq('id',order.id);
    await admin.from('notifications').insert({user_id:order.customer_id,title:'Order completed',message:'Your '+(order.services?.[0]?.title||'service')+' order '+order.reference+' was completed automatically.'});
  }else if(failed){
    await admin.from('orders').update({status:'needs_information',admin_note:'VTpass could not complete this order automatically. Provider response recorded for review.'}).eq('id',order.id);
  }
  return {status:successful?'successful':failed?'failed':'pending',result};
}
