'use client';

import { useState } from 'react';

export default function VTUTelecomHealth() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function testConnection() {
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch('/api/admin/vtu/health', { cache: 'no-store' });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ ok: false, providerReachable: false, providerError: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  const reachable = result?.providerReachable === true;
  const failed = result && !reachable;

  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-black">Nifex Data Connection</h2>
          <p className="mt-1 text-sm text-slate-500">Test whether the deployed server can reach Nifex Data using the configured API credentials.</p>
        </div>
        <button onClick={testConnection} disabled={loading} className="rounded-xl bg-[#0757d5] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">
          {loading ? 'Testing…' : 'Test Connection'}
        </button>
      </div>

      {result && (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="flex flex-wrap gap-2 font-bold">
            <span className="rounded-full bg-white px-3 py-1">Configured: {result.configured ? 'Yes' : 'No'}</span>
            <span className="rounded-full bg-white px-3 py-1">Reachable: {reachable ? 'Yes' : 'No'}</span>
            {result.httpStatus != null && <span className="rounded-full bg-white px-3 py-1">HTTP {result.httpStatus}</span>}
            {result.providerOk != null && <span className="rounded-full bg-white px-3 py-1">Provider: {result.providerOk ? 'OK' : 'Rejected'}</span>}
          </div>
          <p className="mt-3 text-xs text-slate-500">Endpoint tested: {result.endpoint || '—'}</p>
          {result.providerError && <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs text-red-700">{result.providerError}</pre>}
          {result.providerResponse !== undefined && <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs text-slate-700">{JSON.stringify(result.providerResponse, null, 2)}</pre>}
        </div>
      )}

      {failed && !result.providerError && (
        <p className="mt-4 text-sm font-semibold text-red-700">Nifex Data could not be reached.</p>
      )}
    </section>
  );
}
