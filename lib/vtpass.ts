const BASE_URL = (process.env.VTPASS_BASE_URL || 'https://sandbox.vtpass.com/api').replace(/\/$/, '');

function headers(method: 'GET' | 'POST') {
  const apiKey = process.env.VTPASS_API_KEY;
  const publicKey = process.env.VTPASS_PUBLIC_KEY;
  const secretKey = process.env.VTPASS_SECRET_KEY;
  if (!apiKey || !publicKey || !secretKey) throw new Error('VTpass server credentials are not configured.');
  return method === 'GET'
    ? { 'api-key': apiKey, 'public-key': publicKey, Accept: 'application/json' }
    : { 'api-key': apiKey, 'secret-key': secretKey, 'Content-Type': 'application/json', Accept: 'application/json' };
}

async function request(path: string, method: 'GET' | 'POST', body?: Record<string, unknown>) {
  const response = await fetch(BASE_URL + path, {
    method,
    headers: headers(method),
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!response.ok) throw new Error(data?.response_description || data?.message || 'VTpass request failed.');
  return data;
}

export async function vtpassServiceCategories() {
  return request('/service-categories', 'GET');
}

export async function vtpassVariations(serviceID: string) {
  return request('/service-variations?serviceID=' + encodeURIComponent(serviceID), 'GET');
}

export async function vtpassPay(body: Record<string, unknown>) {
  return request('/pay', 'POST', body);
}

export async function vtpassRequery(requestId: string) {
  return request('/requery', 'POST', { request_id: requestId });
}

export function vtpassBaseUrl() {
  return BASE_URL;
}
