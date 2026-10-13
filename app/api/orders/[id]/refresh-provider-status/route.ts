import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fulfillOrder } from "@/lib/pairgate";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, message: "Please sign in to refresh this order." }, { status: 401 });

    const admin = createAdminClient();
    const { data: order, error } = await admin.from("orders")
      .select("id,customer_id,payment_status,status")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!order || order.customer_id !== user.id) return NextResponse.json({ ok: false, message: "Order not found." }, { status: 404 });
    if (order.payment_status !== "paid") return NextResponse.json({ ok: false, message: "Provider status can only be checked after payment is confirmed." }, { status: 409 });
    if (["completed", "cancelled"].includes(String(order.status))) {
      return NextResponse.json({ ok: true, status: order.status, message: "This order is already marked " + order.status + "." });
    }

    // fulfillOrder is idempotent: when a provider transaction already exists, it queries
    // Pairgate's status endpoint instead of submitting a second purchase.
    const result = await fulfillOrder(id);
    const { data: latest, error: latestError } = await admin.from("orders")
      .select("status,admin_note")
      .eq("id", id)
      .single();
    if (latestError) throw latestError;

    const status = String(latest.status || result.status || "processing");
    const message = status === "completed"
      ? "Pairgate confirms delivery. This order is now completed."
      : status === "needs_information"
      ? (latest.admin_note || "This order needs a manual provider-status check.")
      : "Pairgate still reports this transaction as processing. No new purchase was submitted.";
    return NextResponse.json({ ok: true, status, message });
  } catch (error) {
    console.error("Refresh Pairgate order status failed:", error);
    return NextResponse.json({
      ok: false,
      message: error instanceof Error ? error.message : "Could not refresh provider status. Try again.",
    }, { status: 500 });
  }
}
