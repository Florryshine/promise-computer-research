import crypto from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    const secret = (process.env.PAIRGATE_WEBHOOK_SECRET || "").trim();
    if (!secret) return new NextResponse("Pairgate webhook secret is not configured", { status: 503 });
    const signature = request.headers.get("x-pairgate-signature") || request.headers.get("x-webhook-signature") || "";
    const timestamp = request.headers.get("x-pairgate-timestamp") || "";
    // Pairgate's documented signature is HMAC_SHA256(secret, timestamp + "." + raw body).
    // Also accept the legacy raw-body signature for installations configured before timestamp signing.
    const candidates = [
      timestamp ? crypto.createHmac("sha256", secret).update(timestamp + "." + raw).digest("hex") : "",
      crypto.createHmac("sha256", secret).update(raw).digest("hex")
    ].filter(Boolean);
    const validSignature = candidates.some(expected => {
      const supplied = Buffer.from(signature);
      const correct = Buffer.from(expected);
      return supplied.length === correct.length && crypto.timingSafeEqual(supplied, correct);
    });
    if (!validSignature) {
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
      .or("provider_reference.eq." + referenceCode.replace(/[,()]/g, "") + ",request_id.eq." + referenceCode.replace(/[,()]/g, "")).maybeSingle();
    if (txError) throw txError;
    if (!tx) return NextResponse.json({ received: true });

    const success = ["successful", "success", "completed"].includes(status);
    const rawDeliveredValue = event.pin ?? event.token ?? event.electricity_token ?? event.meter_token ?? event.token_number ?? event.voucher_code;
    const deliveredValue = typeof rawDeliveredValue === "string" && rawDeliveredValue.includes("<=>")
      ? rawDeliveredValue.split("<=>").map((part: string) => part.trim()).filter(Boolean).join(" | ")
      : rawDeliveredValue;
    const eventPins = Array.isArray(event.pins) ? event.pins : [];
    const hasDeliveredValue = deliveredValue !== undefined && deliveredValue !== null && String(deliveredValue).trim() !== "";
    const hasPinArray = eventPins.some((pin: any) => Boolean(pin && (pin.pin || pin.serial || pin.voucher_code)));
    const response = { ...(tx.response || {}), webhook: event };
    const { error: updateTxError } = await admin.from("provider_transactions").update({
      status: success ? ((tx.service_id === "electricity" || tx.service_id === "exam-pin" || tx.service_id === "exam") && !hasDeliveredValue && !hasPinArray ? "pending" : "successful") : "failed",
      provider_status: success && (tx.service_id === "electricity" || tx.service_id === "exam-pin" || tx.service_id === "exam") && !hasDeliveredValue && !hasPinArray
        ? "Provider reports success; waiting for token/PIN delivery"
        : String(event.message || status),
      response
    }).eq("request_id", tx.request_id);
    if (updateTxError) throw updateTxError;

    const { data: order, error: orderError } = await admin.from("orders")
      .select("id,reference,customer_id,form_data,services(title,slug)")
      .eq("id", tx.order_id).maybeSingle();
    if (orderError) throw orderError;
    if (!order) return NextResponse.json({ received: true });

    const service = Array.isArray(order.services) ? order.services[0] : order.services;
    const needsDeliveryValue = service?.slug === "electricity-bill" || service?.slug === "exam-pins";
    const delivered = {
      event: String(event.event || ""),
      status: success ? "successful" : "failed",
      item: String(event.item || event.plan || ""),
      message: String(event.message || ""),
      recipient: String(event.recipient || ""),
      token_or_pin: hasDeliveredValue ? String(deliveredValue) : eventPins.map((pin: any) => [pin.pin ? "PIN: " + pin.pin : "", pin.serial ? "Serial: " + pin.serial : ""].filter(Boolean).join(" | ")).filter(Boolean).join("\n"),
      completed_at: String(event.completed_at || new Date().toISOString())
    };
    const waitingForDelivery = success && needsDeliveryValue && !hasDeliveredValue && !hasPinArray;
    let orderStatus = success ? (waitingForDelivery ? "processing" : "completed") : "needs_information";
    let formData: Record<string, any> = { ...(order.form_data || {}), pairgate_delivery: JSON.stringify(delivered), delivery_status_message: waitingForDelivery ? "Provider reports success but has not returned the token/PIN yet." : delivered.message, ...(hasDeliveredValue ? { delivery_pin: String(deliveredValue) } : {}) };
    if (!waitingForDelivery) formData.delivery_completed_at = delivered.completed_at;
    let orderMessage = success
      ? (waitingForDelivery ? "Pairgate reports success, but the token/PIN has not arrived yet. The order remains processing until delivery details are received." : "Pairgate confirmed delivery. Open the order details to view the delivery information.")
      : "Pairgate reported a failed transaction. Check the provider transaction and refund before retrying.";
    if (tx.service_id === "exam-pin" || tx.service_id === "exam") {
      const { data: childRows, error: childRowsError } = await admin.from("provider_transactions")
        .select("request_id,provider_reference,status,response,service_id").eq("order_id", order.id).eq("service_id", "exam-pin");
      if (childRowsError) throw childRowsError;
      const pins = (childRows || []).map((child: any) => {
        const childEvent = child.response?.webhook || child.response?.data || child.response || {};
        const childRaw = childEvent.pin ?? childEvent.token ?? childEvent.voucher_code;
        const childValue = typeof childRaw === "string" && childRaw.includes("<=>") ? childRaw.split("<=>").map((part: string) => part.trim()).filter(Boolean).join(" | ") : childRaw;
        return "Reference: " + String(child.provider_reference || child.request_id) + " | " +
          (childValue ? "PIN: " + String(childValue) : child.status === "successful" ? "PIN delivered (value not parsed)" : "PIN pending") +
          " | " + String(childEvent.item || event.item || "") + " | " + String(child.status || "pending");
      });
      const childTransactions = childRows || [];
      const allDone = childTransactions.length > 0 && childTransactions.every((row: any) => row.status === "successful" && Boolean(row.response?.webhook?.pin || row.response?.webhook?.token || row.response?.webhook?.voucher_code || row.response?.data?.pin || row.response?.pin));
      const anyFailed = childTransactions.some((row: any) => row.status === "failed");
      orderStatus = allDone && hasDeliveredValue ? "completed" : anyFailed ? "needs_information" : "processing";
      orderMessage = allDone && hasDeliveredValue ? "All requested exam PINs have been delivered." : anyFailed ? "At least one exam PIN failed. Contact support before retrying." : "Some exam PINs are still being generated by Pairgate.";
      formData = { ...(order.form_data || {}), delivery_pins: pins.join("\n"), pairgate_delivery: JSON.stringify(delivered), delivery_status_message: delivered.message, ...(hasDeliveredValue ? { delivery_pin: String(deliveredValue) } : {}), ...(!waitingForDelivery ? { delivery_completed_at: delivered.completed_at } : {}) };
    }
    const { error: updateOrderError } = await admin.from("orders").update({
      status: orderStatus,
      form_data: formData,
      admin_note: orderMessage
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