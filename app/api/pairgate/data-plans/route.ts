import { NextResponse } from "next/server";
import { getPairgateDataPlans } from "@/lib/pairgate";
import { SERVICE_UNAVAILABLE_MESSAGE } from "@/lib/service-errors";

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
    console.error("Pairgate data-plan catalogue failed:", error);
    return NextResponse.json({ error: SERVICE_UNAVAILABLE_MESSAGE, plans: [] }, { status: 503 });
  }
}
