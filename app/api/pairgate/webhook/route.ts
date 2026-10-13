import crypto from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    const secret = (process.env.PAIRGATE_WEBHOOK_SECRET || "").trim();
    if (!secret) return new NextResponse("Pairgate webhook secret is not configured", { status: 503 });
    const signature = request.headers.get("x-pairgate-signature") || request.headers.get("x-webhook-signature") || "";
    const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    const supplied = Buffer.from(signature);
    const correct = Buffer.from(expected);
    if (supplied.length !== correct.length || !crypto.timingSafeEqual(supplied, correct)) {
      return new NextResponse("Invalid signature", { status: 401 });
    }

    const event = JSON.parse(raw);
    const referenceCode = String(event.reference_code || "").trim();
    const status = String(event.status || "").toLowerCase();
    if (!referenceCode || !["successful", "success", "completed", "failed", "failure"].includes(status)) {
      return NextResponse.json({ received: true });
    }

    const admin = createAdminClient();
    const { data: tx, error: txError } = await admin.from("provider_transactions")
      .select("request_id,order_id,status,response,service_id,provider_reference")
      .eq("provider_reference", referenceCode).maybeSingle();
    if (txError) throw txError;
    if (!tx) return NextResponse.json({ received: true });

    const success = ["successful", "success", "completed"].includes(status);
    const response = { ...(tx.response || {}), webhook: event };
    const { error: updateTxError } = await admin.from("provider_transactions").update({
      status: success ? "successful" : "failed",
      provider_status: String(event.message || status),
      response
    }).eq("request_id", tx.request_id);
    if (updateTxError) throw updateTxError;

    const { data: order, error: orderError } = await admin.from("orders")
      .select("id,reference,customer_id,form_data,services(title)")
      .eq("id", tx.order_id).maybeSingle();
    if (orderError) throw orderError;
    if (!order) return NextResponse.json({ received: true });

    const delivered = {
      event: String(event.event || ""),
      status: success ? "successful" : "failed",
      item: String(event.item || event.plan || ""),
      message: String(event.message || ""),
      recipient: String(event.recipient || ""),
      token_or_pin: event.pin ? String(event.pin) : "",
      completed_at: String(event.completed_at || new Date().toISOString())
    };
    const formData = { ...(order.form_data || {}), pairgate_delivery: delivered };
    const { error: updateOrderError } = await admin.from("orders").update({
      status: success ? "completed" : "needs_information",
      form_data: formData,
      admin_note: success
        ? "Pairgate confirmed delivery. The token/PIN is included in the order details when provided."
        : "Pairgate reported a failed transaction. Check the provider transaction and refund before retrying."
    }).eq("id", order.id);
    if (updateOrderError) throw updateOrderError;

    if (order.customer_id) {
      await admin.from("notifications").insert({
        user_id: order.customer_id,
        title: success ? "Order completed" : "Order needs attention",
        message: success
          ? "Pairgate completed order " + order.reference + ". Open your order details to view delivery information."
          : "Pairgate reported a failed transaction for order " + order.reference + ". Contact support if the provider wallet has not been refunded."
      });
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Pairgate webhook failed:", error);
    return new NextResponse("Webhook processing failed", { status: 500 });
  }
}