import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

const BASE_URL = (process.env.NIFEX_BASE_URL || 'https://nifexdataapp.com.ng/api/').replace(/\/+$/, '') + '/';
const API_KEY = (process.env.NIFEX_API_KEY || process.env.VTUTELECOM_API_KEY || '').trim();

function clean(v: unknown) { return String(v ?? '').trim(); }
function first(o: any, ...keys: string[]) { for (const k of keys) if (o?.[k] != null && clean(o[k])) return o[k]; return ''; }
export function vtpassConfigured() { return Boolean(API_KEY && BASE_URL); }

function providerId(value: unknown, envName: string): number | null {
  const raw = clean(value);
  if (/^\d+$/.test(raw)) return Number(raw);

  // Nifex documents these network IDs directly. Keep them built in so airtime
  // and data orders do not require manual Vercel mapping for the four networks.
  const defaults: Record<string, Record<string, number>> = {
    NIFEX_NETWORK_IDS: {
      mtn: 1,
      glo: 2,
      '9mobile': 3,
      etisalat: 3,
      airtel: 4
    }
  };

  // Explicit environment configuration can override built-in mappings.
  const configured = process.env[envName];
  if (configured) {
    try {
      const map = JSON.parse(configured) as Record<string, unknown>;
      const id = map[raw] ?? map[raw.toLowerCase()] ?? map[raw.toUpperCase()];
      if (typeof id === 'number' && Number.isInteger(id)) return id;
      if (typeof id === 'string' && /^\d+$/.test(id)) return Number(id);
    } catch {}
  }

  const fallback = defaults[envName]?.[raw.toLowerCase()];
  return Number.isInteger(fallback) ? fallback : null;
}

async function request(path: string, method: 'GET' | 'POST', params: Record<string, unknown> = {}) {
  if (!API_KEY) throw new Error('Nifex API key is missing. Set NIFEX_API_KEY in Vercel.');
  const url = new URL(path.replace(/^\//, ''), BASE_URL);
  const options: RequestInit = {
    method,
    headers: { Authorization: 'Token ' + API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000)
  };
  if (method === 'GET') {
    for (const [k, v] of Object.entries(params)) if (v != null && clean(v)) url.searchParams.set(k, String(v));
  } else {
    options.body = JSON.stringify(params);
  }
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    // A timeout or connection drop is ambiguous: the provider might have received a purchase.
    const message = error instanceof Error ? error.message : 'Network error';
    throw new Error('NIFEX_NETWORK_AMBIGUOUS: ' + message);
  }
  const raw = await response.text();
  let data: any;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!response.ok) {
    throw new Error('NIFEX_HTTP_' + response.status + ': ' + (data?.message || data?.detail || data?.error || raw || 'Nifex API request failed.'));
  }
  return data;
}

function requestId(order: any) {
  return 'PCR-NIFEX-' + String(order.reference).replace(/[^A-Za-z0-9_-]/g, '') + '-' +
    crypto.createHash('sha1').update(order.id).digest('hex').slice(0, 10);
}

function normalize(order: any) {
  const service = Array.isArray(order.services) ? order.services[0] : order.services;
  const slug = String(service?.slug || '');
  const f = (order.form_data || {}) as Record<string, any>;
  const amount = Number(f.provider_amount || f.amount || order.amount);
  if (slug === 'airtime-recharge') return {
    kind: 'airtime', network: providerId(f.network_id ?? f.network, 'NIFEX_NETWORK_IDS'),
    phone: clean(f.mobile_number || f.phone_number || f.phone), amount,
    airtimeType: clean(f.airtime_type) || 'VTU'
  };
  if (slug === 'data-subscription') return {
    kind: 'data', network: providerId(f.network_id ?? f.network, 'NIFEX_NETWORK_IDS'),
    phone: clean(f.mobile_number || f.phone_number || f.phone),
    plan: providerId(f.provider_plan_id ?? f.plan_id ?? f.plan ?? f.variation_code ?? f.plan_code, 'NIFEX_DATA_PLAN_IDS'),
    amount
  };
  if (slug === 'exam-pins') return {
    kind: 'exam', provider: providerId(f.provider_id ?? f.provider, 'NIFEX_EXAM_PROVIDER_IDS'),
    quantity: Math.max(1, Math.floor(Number(f.quantity || 1))), amount
  };
  if (slug === 'data-pins') return {
    kind: 'datapin', network: providerId(f.network_id ?? f.network, 'NIFEX_NETWORK_IDS'),
    plan: providerId(f.data_plan_id ?? f.data_plan ?? f.plan_id ?? f.plan, 'NIFEX_DATAPIN_PLAN_IDS'),
    quantity: Math.max(1, Math.floor(Number(f.quantity || 1))), amount
  };
  if (['dstv-subscription', 'gotv-subscription', 'startimes-subscription'].includes(slug)) return {
    kind: 'cable',
    cable: providerId(f.cablename_id ?? f.cablename ?? f.cable_provider_id ?? f.serviceID ?? (slug === 'dstv-subscription' ? 'dstv' : slug === 'gotv-subscription' ? 'gotv' : 'startimes'), 'NIFEX_CABLE_IDS'),
    plan: providerId(f.cableplan_id ?? f.cableplan ?? f.plan_id ?? f.variation_code ?? f.bouquet ?? f.plan, 'NIFEX_CABLE_PLAN_IDS'),
    smartCard: clean(f.smart_card_number || f.smartcard_number || f.billersCode || f.smartcard),
    amount
  };
  if (slug === 'electricity-bill') return {
    kind: 'electricity',
    disco: providerId(f.disco_id ?? f.disco ?? f.distribution_company ?? f.serviceID, 'NIFEX_ELECTRICITY_IDS'),
    meterNumber: clean(f.meter_number || f.billersCode || f.meter),
    meterType: providerId(f.meter_type_id ?? f.meter_type ?? f.type, 'NIFEX_METER_TYPE_IDS'),
    amount
  };
  return null;
}

function statusText(data: any) {
  return clean(data?.Status || data?.status || data?.message || data?.msg || data?.detail).toLowerCase();
}
function successful(data: any) {
  const s = statusText(data);
  return data?.success === true || s === 'success' || s === 'successful' || s === 'completed' || s === 'complete' || s === 'delivered' || s === 'approved';
}
function failed(data: any) {
  const s = statusText(data);
  return data?.success === false || ['failed', 'failure', 'error', 'rejected', 'declined', 'cancelled'].includes(s);
}

async function markNeedsAttention(admin: any, order: any, message: string) {
  await admin.from('orders').update({
    status: 'needs_information',
    admin_note: 'Payment received, but Nifex fulfillment could not start: ' + message
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
  if (!p) return { status: 'skipped', message: 'Service is not configured for Nifex automation.' };
  const problem =
    !Number.isFinite(p.amount) || p.amount <= 0 ? 'A valid provider purchase amount is missing.' :
    p.kind === 'airtime' && p.network == null ? 'Nifex network ID is missing. Configure NIFEX_NETWORK_IDS in Vercel.' :
    ['airtime', 'data'].includes(p.kind) && !p.phone ? 'Mobile number is missing.' :
    p.kind === 'data' && (p.network == null || p.plan == null) ? 'Nifex data network/plan ID is missing. Configure NIFEX_NETWORK_IDS and NIFEX_DATA_PLAN_IDS.' :
    p.kind === 'exam' && p.provider == null ? 'Nifex exam provider ID is missing. Configure NIFEX_EXAM_PROVIDER_IDS.' :
    p.kind === 'datapin' && (p.network == null || p.plan == null) ? 'Nifex data-pin network/plan ID is missing. Configure NIFEX_NETWORK_IDS and NIFEX_DATAPIN_PLAN_IDS.' :
    p.kind === 'cable' && (p.cable == null || p.plan == null || !p.smartCard) ? 'Nifex cable provider ID, plan ID or smart card number is missing. Configure NIFEX_CABLE_IDS and NIFEX_CABLE_PLAN_IDS.' :
    p.kind === 'electricity' && (p.disco == null || p.meterType == null || !p.meterNumber) ? 'Nifex electricity provider ID, meter type ID or meter number is missing. Configure NIFEX_ELECTRICITY_IDS and NIFEX_METER_TYPE_IDS.' : '';
  if (problem) return markNeedsAttention(admin, order, problem);

  const rid = requestId(order);
  const { data: existing } = await admin.from('provider_transactions').select('*').eq('request_id', rid).maybeSingle();
  if (existing?.status === 'successful') return { status: 'successful', message: 'Already fulfilled.', transaction: existing };

  if (existing && existing.response && Object.keys(existing.response).length > 0 && existing.status !== 'failed') {
    return {
      status: String(existing.status),
      message: 'Nifex was already contacted (status: ' + existing.status + ', provider said: ' + (existing.provider_status || 'no detail') + '). Not sending the purchase again to avoid double delivery. Check Nifex transaction history before retrying.',
      result: existing.response
    };
  }

  if (!existing) {
    const { error: e } = await admin.from('provider_transactions').insert({
      order_id: order.id, provider: 'nifex', request_id: rid, service_id: p.kind,
      amount: p.amount, status: 'pending', provider_status: 'pending', request_data: p
    });
    if (e && !clean(e.message).toLowerCase().includes('duplicate')) throw e;
  }

  let result: any;
  try {
    if (p.kind === 'airtime') {
      result = await request('/airtime/', 'POST', {
        network: p.network, amount: p.amount, mobile_number: p.phone,
        airtime_type: p.airtimeType, portion_ref: rid
      });
    } else if (p.kind === 'data') {
      result = await request('/data/', 'POST', {
        network: p.network, mobile_number: p.phone, plan: p.plan, portion_ref: rid
      });
    } else if (p.kind === 'exam') {
      result = await request('/exam/', 'POST', { provider: p.provider, quantity: p.quantity });
    } else if (p.kind === 'datapin') {
      result = await request('/datapin/', 'POST', { network: p.network, data_plan: p.plan, quantity: p.quantity });
    } else if (p.kind === 'cable') {
      const verified = await request('/cabletv/verify/', 'GET', { cablename: p.cable, smart_card_number: p.smartCard });
      if (failed(verified) || !verified?.name) throw new Error('Nifex did not confirm the cable TV customer. Check the response before retrying.');
      result = await request('/cabletv/', 'POST', {
        cablename: p.cable, cableplan: p.plan, smart_card_number: p.smartCard
      });
    } else {
      const verified = await request('/electricity/verify/', 'GET', {
        disco: p.disco, meter_number: p.meterNumber, meter_type: p.meterType
      });
      if (failed(verified) || !verified?.name) throw new Error('Nifex did not confirm the electricity meter. Check the response before retrying.');
      result = await request('/electricity/', 'POST', {
        disco: p.disco, amount: p.amount, meter_number: p.meterNumber, meter_type: p.meterType
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nifex request failed.';
    const ambiguous = message.startsWith('NIFEX_NETWORK_AMBIGUOUS:');
    // Keep uncertain network failures pending so the same paid order cannot be resubmitted blindly.
    await admin.from('provider_transactions').update({
      status: ambiguous ? 'pending' : 'failed',
      provider_status: ambiguous ? 'unknown — check Nifex history before retrying' : 'error',
      response: { error: message, ambiguous }
    }).eq('request_id', rid);
    await admin.from('orders').update({
      status: 'needs_information',
      admin_note: ambiguous
        ? 'Nifex connection dropped during the request. Transaction outcome is unknown; check Nifex history before any retry.'
        : 'Payment received, but Nifex fulfillment failed: ' + message
    }).eq('id', order.id);
    await admin.from('notifications').insert({
      user_id: order.customer_id,
      title: 'Payment received — order needs attention',
      message: 'Your payment was successful, but the service needs a manual check. We are reviewing order ' + order.reference + '.'
    });
    return { status: ambiguous ? 'pending' : 'failed', message };
  }

  const ok = successful(result), bad = failed(result);
  const status = ok ? 'successful' : bad ? 'failed' : 'pending';
  await admin.from('provider_transactions').update({
    provider_reference: first(result, 'transref', 'transaction_id', 'transactionId', 'transaction_reference', 'reference') || null,
    provider_status: first(result, 'Status', 'status', 'msg', 'message', 'detail') || status,
    status, response: result
  }).eq('request_id', rid);

  if (ok) {
    await admin.from('orders').update({ status: 'completed', admin_note: 'Nifex fulfillment completed automatically.' }).eq('id', order.id);
    const service = Array.isArray(order.services) ? order.services[0] : order.services;
    await admin.from('notifications').insert({
      user_id: order.customer_id, title: 'Order completed',
      message: 'Your ' + (service?.title || 'service') + ' order ' + order.reference + ' was completed automatically.'
    });
  } else if (bad) {
    await admin.from('orders').update({ status: 'needs_information', admin_note: 'Nifex could not complete this order automatically. Provider response was recorded for review.' }).eq('id', order.id);
  } else {
    await admin.from('orders').update({ admin_note: 'Nifex returned an unconfirmed status. Check Nifex transaction history before retrying: ' + JSON.stringify(result).slice(0, 300) }).eq('id', order.id);
  }
  return { status, result };
}

// The supplied Nifex documentation does not describe a plan/variation-list endpoint.
export async function vtpassVariations(serviceID: string) {
  return {
    code: 'NOT_SUPPORTED',
    message: 'Nifex documentation supplied for this integration does not list a variations endpoint. Configure numeric provider IDs for networks and plans.',
    serviceID
  };
}

export async function verifyMerchant(serviceID: string, billersCode: string, type?: string) {
  const service = clean(serviceID).toLowerCase();
  if (service.includes('electric')) {
    const disco = providerId(serviceID, 'NIFEX_ELECTRICITY_IDS');
    const meterType = providerId(type, 'NIFEX_METER_TYPE_IDS');
    if (disco == null || meterType == null) throw new Error('Nifex electricity IDs are not configured. Set NIFEX_ELECTRICITY_IDS and NIFEX_METER_TYPE_IDS.');
    return request('/electricity/verify/', 'GET', { disco, meter_number: billersCode, meter_type: meterType });
  }
  if (service.includes('dstv') || service.includes('gotv') || service.includes('startimes') || service.includes('cable')) {
    const cable = providerId(serviceID, 'NIFEX_CABLE_IDS');
    if (cable == null) throw new Error('Nifex cable provider ID is not configured. Set NIFEX_CABLE_IDS.');
    return request('/cabletv/verify/', 'GET', { cablename: cable, smart_card_number: billersCode });
  }
  throw new Error('Merchant verification is only supported for cable TV and electricity services.');
}
