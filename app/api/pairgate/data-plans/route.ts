import { NextResponse } from "next/server";
import { getPairgateDataPlans } from "@/lib/pairgate";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const network = new URL(request.url).searchParams.get("network") || undefined;
    const plans = await getPairgateDataPlans(network);
    return NextResponse.json({
      plans: plans.map(({ id, networkId, network, name, price, validity, planType }) => ({
        id, networkId, network, name, price, validity, planType,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pairgate catalogue is unavailable.";
    const status = message.includes("API key is missing") ? 503 : 502;
    return NextResponse.json({ error: message, plans: [] }, { status });
  }
}
