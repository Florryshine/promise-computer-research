import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    code: "NOT_SUPPORTED",
    message: "Pairgate customer verification for cable TV and electricity is not yet integrated.",
  }, { status: 501 });
}
