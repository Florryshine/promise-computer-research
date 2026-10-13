import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    code: "NOT_SUPPORTED",
    message: "Pairgate airtime and data are enabled. Service variations for cable TV and other utilities have not yet been integrated.",
  }, { status: 501 });
}
