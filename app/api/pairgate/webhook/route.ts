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

    const parsedEvent = JSON.parse(raw);
    const event = parsedEvent?.data && typeof parsedEvent.data === "object" && !Array.isArray(parsedEvent.data)
      ? { ...parsedEvent.data, ...parsedEvent }
      : parsedEvent;
    const referenceCode = String(event.reference_code || event.client_reference || event.reference || event.transaction_reference || "").trim();
    const status = String(event.status || event.data?.status || "").toLowerCase();
    if (!referenceCode || !["successful", "success", "completed", "failed", "failure"].includes(status)) {
      return NextResponse.json({ received: true });
    }

    const admin = createAdminClient();
    let { data: tx, error: txError } = await admin.from("provider_transactions")
      .select("request_id,order_id,status,response,service_id,provider_reference")
      .eq("provider_reference", referenceCode).maybeSingle();
    if (txError) throw txError;
    // Some Pairgate events send our client reference rather than their transaction reference.
    if (!tx) {
      const clientReference = String(event.client_reference || event.reference || event.request_id || referenceCode).trim();
      const fallback = await admin.from("provider_transactions")
        .select("request_id,order_id,status,response,service_id,provider_reference")
        .eq("request_id", clientReference).maybeSingle();
      if (fallback.error) throw fallback.error;
      tx = fallback.data;
    }
    if (!tx) {
      console.warn("Pairgate webhook reference did not match a stored transaction", { referenceCode });
      // Acknowledge unknown events so a provider retry storm does not occur; reconcile from transaction status polling.
      return NextResponse.json({ received: true, matched: false });
    }

    const success = ["successful", "success", "completed"].includes(status);
    const rawDeliveredValue = event.pin ?? event.token ?? event.electricity_token ?? event.meter_token ?? event.token_number ?? event.voucher_code;
    const deliveredValue = typeof rawDeliveredValue === "string" && rawDeliveredValue.includes("<=>")
      ? rawDeliveredValue.split("<=>").map((part: string, index: number) => (index === 0 ? "PIN: " : "Serial: ") + part.trim()).filter((part: string) => !part.endsWith(": ")).join(" | ")
      : rawDeliveredValue;
    const eventPins = Array.isArray(event.pins) ? event.pins : [];
    const hasDeliveredValue = deliveredValue !== undefined && deliveredValue !== null && String(deliveredValue).trim() !== "";
    const hasPinArray = eventPins.some((pin: any) => Boolean(pin && (pin.pin || pin.voucher_code)));
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
        const childValue = typeof childRaw === "string" && childRaw.includes("<=>")
          ? childRaw.split("<=>").map((part: string, index: number) => (index === 0 ? "PIN: " : "Serial: ") + part.trim()).filter((part: string) => !part.endsWith(": ")).join(" | ")
          : childRaw || (Array.isArray(childEvent.pins) ? childEvent.pins.map((pin: any) => [pin.pin ? "PIN: " + pin.pin : "", pin.serial ? "Serial: " + pin.serial : ""].filter(Boolean).join(" | ")).filter(Boolean).join("; ") : "");
        return "Reference: " + String(child.provider_reference || child.request_id) + " | " +
          (childValue ? String(childValue).startsWith("PIN: ") ? String(childValue) : "PIN: " + String(childValue) : child.status === "successful" ? "PIN delivered (value not parsed)" : "PIN pending") +
          " | " + String(childEvent.item || event.item || "") + " | " + String(child.status || "pending");
      });
      const childTransactions = childRows || [];
      const expectedPinCount = Math.max(1, Number(order.form_data?.quantity || 1));
      const allDone = childTransactions.length >= expectedPinCount && childTransactions.every((row: any) => {
        const childEvent = row.response?.webhook || row.response?.data || row.response || {};
        return row.status === "successful" && Boolean(childEvent.pin || childEvent.token || childEvent.voucher_code || childEvent.electricity_token || childEvent.meter_token || childEvent.token_number || (Array.isArray(childEvent.pins) && childEvent.pins.some((pin: any) => pin?.pin || pin?.voucher_code)));
      });
      const anyFailed = childTransactions.some((row: any) => row.status === "failed");
      orderStatus = allDone ? "completed" : anyFailed ? "needs_information" : "processing";
      orderMessage = allDone ? "All requested exam PINs have been delivered." : anyFailed ? "At least one exam PIN failed. Contact support before retrying." : "Some exam PINs are still being generated by Pairgate.";
      formData = { ...(order.form_data || {}), delivery_pins: pins.join("\n"), pairgate_delivery: JSON.stringify(delivered), delivery_status_message: delivered.message, ...(hasDeliveredValue ? { delivery_pin: String(deliveredValue) } : {}), ...(!waitingForDelivery ? { delivery_completed_at: delivered.completed_at } : {}) };
    }
    const { error: updateOrderError } = await admin.from("orders").update({
      status: orderStatus,
      form_data: formData,
      admin_note: orderMessage
    }).eq("id", order.id);
    if (updateOrderError) throw updateOrderError;

    if (order.customer_id) {
      const actuallyCompleted = orderStatus === "completed";
      await admin.from("notifications").insert({
        user_id: order.customer_id,
        title: actuallyCompleted ? "Order completed" : orderStatus === "needs_information" ? "Order needs attention" : "Order update",
        message: actuallyCompleted
          ? "Pairgate completed order " + order.reference + ". Open your order details to view delivery information."
          : success
          ? "Pairgate reported success for order " + order.reference + ", but delivery is not yet fully confirmed. The order remains under processing."
          : "Pairgate reported a failed transaction for order " + order.reference + ". Contact support if the provider wallet has not been refunded."
      });
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Pairgate webhook failed:", error);
    return new NextResponse("Webhook processing failed", { status: 500 });
  }
}