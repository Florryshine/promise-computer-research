import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

const BASE_URL = (process.env.VTUTELECOM_BASE_URL || 'https://vtutelecom.ng/api').replace(/\/$/, '');
const API_KEY = process.env.VTUTELECOM_API_KEY?.trim();

function clean(v: unknown) { return String(v ?? '').trim(); }
function first(o: any, ...keys: string[]) { for (const k of keys) if (o?.[k] != null && clean(o[k])) return o[k]; return ''; }

export function vtpassConfigured() { return Boolean(API_KEY && BASE_URL); }

async function get(path: string, params: Record<string, unknown>) {
  if (!API_KEY) throw new Error('VTUTelecom API key is missing.');
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params)) if (v != null && clean(v)) url.searchParams.set(k, String(v));
  const r = await fetch(url, { method: 'GET', headers: { Authorization: 'Token ' + API_KEY, 'Content-Type': 'application/json' }, cache: 'no-store' });
  const raw = await r.text();
  let data: any; try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!r.ok) throw new Error(data?.message || data?.detail || data?.error || 'VTUTelecom request failed.');
  return data;
}

function requestId(order: any) {
  return 'PCR-NIFEX-' + String(order.reference).replace(/[^A-Za-z0-9_-]/g, '') + '-' +
    crypto.createHash('sha1').update(order.id).digest('hex').slice(0, 10);
}

function network(v: unknown) {
  const n = clean(v).toLowerCase();
  return n === '9mobile' ? 'etisalat' : n;
}

function normalize(order: any) {
  const service = Array.isArray(order.services) ? order.services[0] : order.services;
  const slug = String(service?.slug || '');
  const f = (order.form_data || {}) as Record<string, any>;
  if (slug === 'airtime-recharge') return { kind: 'airtime', network: network(f.network), phone: clean(f.phone_number || f.phone), amount: Number(f.provider_amount || f.amount) };
  if (slug === 'data-subscription') return { kind: 'data', network: network(f.network), phone: clean(f.phone_number || f.phone), variation: clean(f.variation_code || f.plan || f.plan_code), amount: Number(f.provider_amount || f.amount) };
  if (['dstv-subscription', 'gotv-subscription', 'startimes-subscription'].includes(slug)) return {
    kind: 'cable',
    service: slug === 'dstv-subscription' ? 'dstv' : slug === 'gotv-subscription' ? 'gotv' : 'startimes',
    billersCode: clean(f.smartcard_number || f.billersCode || f.smartcard),
    variation: clean(f.variation_code || f.bouquet || f.plan),
    phone: clean(f.phone || f.phone_number),
    subscription_type: clean(f.subscription_type || f.action) || 'change',
    amount: Number(f.provider_amount || f.amount)
  };
  if (slug === 'electricity-bill') return {
    kind: 'electricity',
    service: clean(f.serviceID || f.disco || f.distribution_company) || 'ikeja-electric',
    billersCode: clean(f.meter_number || f.billersCode || f.meter),
    meter_type: clean(f.meter_type || f.type).toLowerCase(),
    phone: clean(f.phone || f.phone_number),
    amount: Number(f.provider_amount || f.amount)
  };
  return null;
}

function successful(data: any) {
  const s = JSON.stringify(data).toLowerCase();
  return data?.success === true || data?.status === true || /"status"\s*:\s*"(successful|success|completed|complete|delivered|approved)"/.test(s);
}
function failed(data: any) {
  const s = JSON.stringify(data).toLowerCase();
  return data?.success === false || /"status"\s*:\s*"(failed|failure|error|rejected|declined|cancelled)"/.test(s);
}

async function markNeedsAttention(admin: any, order: any, message: string) {
  await admin.from('orders').update({
    status: 'needs_information',
    admin_note: 'Payment received, but fulfillment could not start: ' + message
  }).eq('id', order.id);
  return { status: 'failed', message };
}

export async function fulfillOrder(orderId: string) {
  const admin = createAdminClient();
  const { data: order, error } = await admin.from('orders')
    .select('id,reference,status,payment_status,amount,form_data,customer_id,services(slug,title)')
    .eq('id', orderId).maybeSingle();
  if (error) throw error;
  if (!order) throw new Error('Order not found');
  if (order.payment_status !== 'paid') return { status: 'skipped', message: 'Order is not paid.' };

  const p = normalize(order);
  if (!p) return { status: 'skipped', message: 'Service is not configured for VTUTelecom automation.' };
  const problem =
    !Number.isFinite(p.amount) || p.amount <= 0 ? 'Provider purchase amount is missing.' :
    ['airtime', 'data'].includes(p.kind) && !p.phone ? 'Phone number is missing.' :
    p.kind === 'airtime' && !p.network ? 'Airtime network is missing.' :
    p.kind === 'data' && (!p.network || !p.variation) ? 'Data network or plan is missing.' :
    p.kind === 'cable' && !p.billersCode ? 'Smartcard/customer number is missing.' :
    p.kind === 'electricity' && !p.billersCode ? 'Meter number is missing.' : '';
  if (problem) return markNeedsAttention(admin, order, problem);

  const rid = requestId(order);
  const { data: existing } = await admin.from('provider_transactions').select('*').eq('request_id', rid).maybeSingle();
  if (existing?.status === 'successful') return { status: 'successful', message: 'Already fulfilled.', transaction: existing };

  // If the provider has already accepted/processed this request, do not send it again.
  // A recorded failure is retryable; an ambiguous/pending response is not, because
  // retrying could double-deliver airtime/data if the provider actually accepted it.
  if (existing && existing.response && Object.keys(existing.response).length > 0 && existing.status !== 'failed') {
    return {
      status: String(existing.status),
      message: 'Provider was already contacted (status: ' + existing.status + ', provider said: ' + (existing.provider_status || 'no detail') + '). Not sending again to avoid double delivery. Check the VTUTelecom dashboard before retrying.',
      result: existing.response
    };
  }

  if (!existing) {
    const { error: e } = await admin.from('provider_transactions').insert({
      order_id: order.id, provider: 'vtutelecom', request_id: rid, service_id: p.kind,
      amount: p.amount, status: 'pending', provider_status: 'pending', request_data: p
    });
    if (e && !clean(e.message).toLowerCase().includes('duplicate')) throw e;
  }

  let result: any;
  try {
    if (p.kind === 'airtime') {
      result = await get('/airtime/', { network: p.network, phone: p.phone, phone_number: p.phone, amount: p.amount, request_id: rid });
    } else if (p.kind === 'data') {
      result = await get('/data/', { network: p.network, phone: p.phone, phone_number: p.phone, variation_code: p.variation, plan: p.variation, amount: p.amount, request_id: rid });
    } else if (p.kind === 'cable') {
      const v = await get('/cabletv/verify/', { service: p.service, serviceID: p.service, billersCode: p.billersCode, smartcard_number: p.billersCode });
      if (failed(v)) throw new Error(v?.message || v?.detail || 'Cable customer could not be verified.');
      result = await get('/cabletv/', { service: p.service, serviceID: p.service, billersCode: p.billersCode, smartcard_number: p.billersCode, variation_code: p.variation, plan: p.variation, amount: p.amount, phone: p.phone, subscription_type: p.subscription_type, request_id: rid });
    } else {
      const v = await get('/electricity/verify/', { service: p.service, serviceID: p.service, billersCode: p.billersCode, meter_number: p.billersCode, type: p.meter_type });
      if (failed(v)) throw new Error(v?.message || v?.detail || 'Electricity meter could not be verified.');
      result = await get('/electricity/', { service: p.service, serviceID: p.service, billersCode: p.billersCode, meter_number: p.billersCode, type: p.meter_type, meter_type: p.meter_type, amount: p.amount, phone: p.phone, request_id: rid });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Provider request failed.';
    await admin.from('provider_transactions').update({
      status: 'failed',
      provider_status: 'error',
      response: { error: message }
    }).eq('request_id', rid);
    await admin.from('orders').update({
      status: 'needs_information',
      admin_note: 'Payment received, but automatic provider fulfillment failed: ' + message
    }).eq('id', order.id);
    await admin.from('notifications').insert({
      user_id: order.customer_id,
      title: 'Payment received — order needs attention',
      message: 'Your payment was successful, but the service could not be completed automatically. We are reviewing order ' + order.reference + '.'
    });
    return { status: 'failed', message };
  }

  const ok = successful(result), bad = failed(result);
  const status = ok ? 'successful' : bad ? 'failed' : 'pending';
  await admin.from('provider_transactions').update({
    provider_reference: first(result, 'transaction_id','transactionId','transaction_reference','reference') || null,
    provider_status: first(result, 'status','message','detail') || status,
    status, response: result
  }).eq('request_id', rid);

  if (ok) {
    await admin.from('orders').update({ status: 'completed', admin_note: 'VTUTelecom fulfillment completed automatically.' }).eq('id', order.id);
    await admin.from('notifications').insert({ user_id: order.customer_id, title: 'Order completed', message: 'Your ' + ((((Array.isArray(order.services) ? order.services[0] : order.services) as any)?.title || 'service')) + ' order ' + order.reference + ' was completed automatically.' });
  } else if (bad) {
    await admin.from('orders').update({ status: 'needs_information', admin_note: 'VTUTelecom could not complete this order automatically. Provider response was recorded for review.' }).eq('id', order.id);
  } else {
    await admin.from('orders').update({ admin_note: 'VTUTelecom returned an unconfirmed status. Check the VTUTelecom dashboard before retrying: ' + JSON.stringify(result).slice(0, 300) }).eq('id', order.id);
  }

  return { status, result };
}


// Compatibility helpers for the existing /api/vtu routes.
// VTUTelecom's published API does not document a separate variations endpoint,
// so we do not pretend that VTpass's variation catalogue still exists.
export async function vtpassVariations(serviceID: string) {
  return {
    code: 'NOT_SUPPORTED',
    message: 'VTUTelecom does not publish a separate variations endpoint. Use the provider plan/network values configured by the application.',
    serviceID
  };
}

export async function verifyMerchant(serviceID: string, billersCode: string, type?: string) {
  const service = clean(serviceID).toLowerCase();
  if (service.includes('electric')) {
    return get('/electricity/verify/', {
      service: serviceID,
      serviceID,
      billersCode,
      meter_number: billersCode,
      type
    });
  }

  if (service.includes('dstv') || service.includes('gotv') || service.includes('startimes') || service.includes('cable')) {
    return get('/cabletv/verify/', {
      service: serviceID,
      serviceID,
      billersCode,
      smartcard_number: billersCode,
      type
    });
  }

  throw new Error('Merchant verification is only supported for cable TV and electricity services.');
}
