import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { pairgateRequest } from '@/lib/pairgate';

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

    const baseUrl = (process.env.PAIRGATE_BASE_URL || 'https://pairgate.com/api/v1').replace(/\/+$/, '') + '/';
    const apiKey = (process.env.PAIRGATE_API_KEY || '').trim();
    const result: Record<string, unknown> = {
      ok: true,
      configured: Boolean(apiKey),
      provider: 'Pairgate',
      baseUrl,
      endpoint: baseUrl + 'wallet/balance',
    };
    if (!apiKey) {
      return NextResponse.json({ ...result, providerReachable: false, providerError: 'Pairgate API key is missing. Set PAIRGATE_API_KEY in Vercel.' }, { status: 200 });
    }

    try {
      const body = await pairgateRequest('/wallet/balance', 'GET', undefined, false);
      result.providerReachable = true;
      result.httpStatus = 200;
      result.providerOk = String(body?.status || '').toLowerCase() === 'success' && Number.isFinite(Number(body?.data?.balance));
      result.providerResponse = body;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.providerReachable = !message.startsWith('PAIRGATE_HTTP_401') && !message.startsWith('PAIRGATE_HTTP_403');
      result.providerOk = false;
      result.providerError = message;
    }
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Nifex connection check failed.' }, { status: 500 });
  }
}
