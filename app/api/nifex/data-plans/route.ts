import { NextResponse } from "next/server";
import { getNifexDataPlans } from "@/lib/nifex-catalog";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const network = searchParams.get("network") || undefined;
    const plans = await getNifexDataPlans(network);
    return NextResponse.json({ plans: plans.map(({ id, networkId, network, name, price, validity }) => ({ id, networkId, network, name, price, validity })) }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nifex catalogue is unavailable.";
    const status = message.includes("not been configured") ? 503 : 502;
    return NextResponse.json({ error: message, plans: [] }, { status });
  }
}
