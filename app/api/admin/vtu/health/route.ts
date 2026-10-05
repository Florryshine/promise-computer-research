import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { vtpassConfigured } from '@/lib/vtpass';

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

    const baseUrl = (process.env.VTUTELECOM_BASE_URL || 'https://vtutelecom.ng/api').replace(/\/$/, '');
    const apiKey = process.env.VTUTELECOM_API_KEY?.trim();

    const result: Record<string, unknown> = {
      ok: true,
      configured: Boolean(apiKey && baseUrl),
      baseUrl,
      sandbox: baseUrl.includes('sandbox'),
      endpoint: baseUrl + '/user/',
    };

    if (!apiKey) {
      return NextResponse.json({ ...result, providerReachable: false, providerError: 'VTUTelecom API key is missing.' }, { status: 200 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(baseUrl + '/user/', {
        method: 'GET',
        headers: {
          Authorization: 'Token ' + apiKey,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        signal: controller.signal,
      });

      const raw = await response.text();
      let body: unknown = raw;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {}

      result.providerReachable = true;
      result.httpStatus = response.status;
      result.providerOk = response.ok;
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
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'VTUTelecom connection check failed.'
    }, { status: 500 });
  }
}
