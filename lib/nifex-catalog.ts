const BASE_URL = (process.env.NIFEX_BASE_URL || "https://nifexdataapp.com.ng/api/").replace(/\/+$/, "") + "/";
const API_KEY = (process.env.NIFEX_API_KEY || process.env.VTUTELECOM_API_KEY || "").trim();

export type NifexDataPlan = {
  id: string;
  networkId: number | null;
  network: string;
  name: string;
  price: number;
  validity: string;
  raw?: unknown;
};

function text(value: unknown) { return String(value ?? "").trim(); }
function first(row: any, keys: string[]) {
  for (const key of keys) if (row?.[key] !== undefined && row?.[key] !== null && text(row[key])) return row[key];
  return undefined;
}
function networkId(value: unknown): number | null {
  const v = text(value).toLowerCase();
  if (/^\d+$/.test(v)) return Number(v);
  const ids: Record<string, number> = { mtn: 1, glo: 2, "9mobile": 3, etisalat: 3, airtel: 4 };
  if (ids[v] != null) return ids[v];
  if (v.includes("9mobile") || v.includes("etisalat")) return 3;
  if (v.includes("mtn")) return 1;
  if (v.includes("airtel")) return 4;
  if (v.includes("glo")) return 2;
  return null;
}
function networkName(id: number | null, label: unknown): string {
  const supplied = text(label);
  if (supplied) return supplied;
  return ({1:"MTN",2:"Glo",3:"9mobile",4:"Airtel"} as Record<number,string>)[id ?? 0] ?? "";
}
function rowsFrom(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data","plans","results","variations","items","packages"]) {
    const value = payload?.[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      for (const nested of ["data","plans","results","items"]) if (Array.isArray(value[nested])) return value[nested];
    }
  }
  return [];
}

/**
 * Catalogue path is deliberately provider-configured: the API docs supplied to
 * PCR document purchase endpoints but do not document a list-plans endpoint.
 * Set NIFEX_DATA_PLANS_PATH to the exact path confirmed by Nifex support.
 */
export async function getNifexDataPlans(network?: string): Promise<NifexDataPlan[]> {
  if (!API_KEY) throw new Error("Nifex API key is not configured.");
  const path = text(process.env.NIFEX_DATA_PLANS_PATH);
  if (!path) throw new Error("Nifex data-plan catalogue endpoint has not been configured by the provider.");
  const url = new URL(path.replace(/^\/+/, ""), BASE_URL);
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: "Token " + API_KEY, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000)
  });
  const body = await response.text();
  let payload: any;
  try { payload = body ? JSON.parse(body) : {}; } catch { throw new Error("Nifex catalogue endpoint did not return JSON."); }
  if (!response.ok) throw new Error("Nifex catalogue request failed with HTTP " + response.status + ".");
  const rows = rowsFrom(payload);
  if (!rows.length) throw new Error("Nifex catalogue response did not contain a recognized plan list.");
  const plans = rows.map((row: any): NifexDataPlan | null => {
    const id = text(first(row, ["id","plan_id","planId","provider_plan_id","serviceID","service_id","code","variation_code"]));
    const label = first(row, ["network","network_name","networkName","operator","provider"]);
    const nid = networkId(first(row, ["network_id","networkId","network","network_name","networkName"]));
    const name = text(first(row, ["name","plan_name","planName","title","variation_name","description"]));
    const price = Number(first(row, ["price","amount","selling_price","sellingPrice","cost","variation_amount"]));
    const validity = text(first(row, ["validity","duration","validity_period","validityPeriod"]));
    if (!id || !name || !Number.isFinite(price) || price <= 0) return null;
    return { id, networkId: nid, network: networkName(nid, label), name, price, validity, raw: row };
  }).filter((plan: NifexDataPlan | null): plan is NifexDataPlan => Boolean(plan));
  if (!plans.length) throw new Error("Nifex catalogue records did not include plan IDs, names and prices.");
  const wantedId = networkId(network);
  return wantedId == null ? plans : plans.filter(plan => plan.networkId === wantedId || networkId(plan.network) === wantedId);
}
