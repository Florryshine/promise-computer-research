import { NextResponse } from "next/server";
import { pairgateRequest } from "@/lib/pairgate";

export async function GET(request: Request) {
  try {
    const provider = new URL(request.url).searchParams.get("provider") || "";
    if (!["dstv", "gotv", "startimes"].includes(provider)) {
      return NextResponse.json({ error: "Choose a valid cable provider." }, { status: 400 });
    }
    const payload = await pairgateRequest("/cable-plans", "GET", { provider_id: provider });
    const data = payload?.data ?? payload;
    const groups = Array.isArray(data) ? data : Object.values(data || {}).find(Array.isArray) || [];
    const plans = (groups as any[]).map(row => ({
      id: String(row.plan_id ?? row.id ?? ""),
      name: String(row.name ?? row.plan_name ?? ""),
      price: Number(row.price)
    })).filter(row => row.id && row.name && Number.isFinite(row.price) && row.price > 0);
    return NextResponse.json({ plans }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load cable plans." }, { status: 502 });
  }
}