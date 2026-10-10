import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: 'Login required.' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profile?.role !== 'admin') {
      return NextResponse.json({ ok: false, error: 'Admin access required.' }, { status: 403 });
    }

    const baseUrl = (process.env.NIFEX_BASE_URL || 'https://nifexdataapp.com.ng/api/').replace(/\/+$/, '') + '/';
    const apiKey = (process.env.NIFEX_API_KEY || process.env.VTUTELECOM_API_KEY || '').trim();
    const mappingNames = [
      'NIFEX_NETWORK_IDS',
      'NIFEX_DATA_PLAN_IDS',
      'NIFEX_CABLE_IDS',
      'NIFEX_CABLE_PLAN_IDS',
      'NIFEX_ELECTRICITY_IDS',
      'NIFEX_METER_TYPE_IDS',
      'NIFEX_EXAM_PROVIDER_IDS',
      'NIFEX_DATAPIN_PLAN_IDS',
    ];
    const mappings: Record<string, { configured: boolean; validJson: boolean; entryCount: number }> = {};
    for (const name of mappingNames) {
      const raw = process.env[name]?.trim() || '';
      let validJson = false;
      let entryCount = 0;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          validJson = Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
          entryCount = validJson ? Object.keys(parsed).length : 0;
        } catch {}
      }
      mappings[name] = { configured: raw.length > 0, validJson, entryCount };
    }
    const result: Record<string, unknown> = {
      ok: true,
      configured: Boolean(apiKey),
      provider: 'Nifex Data',
      baseUrl,
      endpoint: baseUrl + 'user/',
      mappings,
    };
    if (!apiKey) {
      return NextResponse.json({ ...result, providerReachable: false, providerError: 'Nifex API key is missing. Set NIFEX_API_KEY in Vercel.' }, { status: 200 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(baseUrl + 'user/', {
        method: 'GET',
        headers: { Authorization: 'Token ' + apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      const raw = await response.text();
      let body: any = raw;
      try { body = raw ? JSON.parse(raw) : {}; } catch {}
      result.providerReachable = true;
      result.httpStatus = response.status;
      result.providerOk = response.ok && String(body?.status || '').toLowerCase() === 'success';
      result.providerResponse = body;
    } catch (error) {
      result.providerReachable = false;
      result.providerError = error instanceof Error ? error.message : String(error);
      result.errorName = error instanceof Error ? error.name : undefined;
    } finally {
      clearTimeout(timeout);
    }
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Nifex connection check failed.' }, { status: 500 });
  }
}
