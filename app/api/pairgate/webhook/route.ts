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

    const testModeAttempt = Boolean(
      tx.response?.test_mode === true ||
      tx.response?.retryable_test_attempt === true ||
      tx.response?.data?.test_mode === true ||
      tx.response?.data?.data?.test_mode === true
    );
    if (testModeAttempt) {
      const { error: testTxError } = await admin.from("provider_transactions").update({
        status: "pending",
        provider_status: "TEST MODE webhook ignored; no live purchase confirmed",
        response: { ...(tx.response || {}), webhook: event, test_mode: true, retryable_test_attempt: true }
      }).eq("request_id", tx.request_id);
      if (testTxError) throw testTxError;
      const { data: testOrder, error: testOrderLoadError } = await admin.from("orders")
        .select("id,form_data").eq("id", tx.order_id).maybeSingle();
      if (testOrderLoadError) throw testOrderLoadError;
      // Only update an order still marked as awaiting a test-mode retry. A delayed
      // webhook from an old test attempt must never overwrite a newer live delivery.
      if (testOrder?.form_data?.pairgate_test_mode === true) {
        const { error: testOrderUpdateError } = await admin.from("orders").update({
          status: "needs_information",
          admin_note: "A Pairgate TEST MODE webhook was received. It is not proof of live fulfilment; no token/PIN from this event was accepted. Switch to live mode and deliberately retry this already-paid order.",
          form_data: { ...(testOrder.form_data || {}), pairgate_test_mode: true, delivery_status_message: "Test-mode webhook ignored — awaiting a live provider purchase." }
        }).eq("id", testOrder.id);
        if (testOrderUpdateError) throw testOrderUpdateError;
      }
      return NextResponse.json({ received: true, test_mode: true });
    }

    const success = ["successful", "success", "completed"].includes(status);
    const rawDeliveredValue = event.pin ?? event.token ?? event.electricity_token ?? event.meter_token ?? event.token_number ?? event.voucher_code;
    const deliveredValue = typeof rawDeliveredValue === "string" && rawDeliveredValue.includes("<=>")
      ? rawDeliveredValue.split("<=>").map((part: string, index: number) => (index === 0 ? "PIN: " : "Serial: ") + part.trim()).filter((part: string) => !part.endsWith(": ")).join(" | ")
      : rawDeliveredValue;
    const eventPins = Array.isArray(event.pins) ? event.pins : [];
    const normalizePin = (pin: any) => {
      const raw = pin?.pin ?? pin?.pin_code ?? pin?.voucher_code ?? pin?.token ?? "";
      const serial = pin?.serial ?? pin?.serial_number ?? "";
      if (typeof raw === "string" && raw.includes("<=>")) {
        return raw.split("<=>").map((part: string, index: number) => (index === 0 ? "PIN: " : "Serial: ") + part.trim()).filter((part: string) => !part.endsWith(": ")).join(" | ");
      }
      return [raw ? "PIN: " + String(raw) : "", serial ? "Serial: " + String(serial) : ""].filter(Boolean).join(" | ");
    };
    const hasDeliveredValue = deliveredValue !== undefined && deliveredValue !== null && String(deliveredValue).trim() !== "";
    const normalizedEventPins = eventPins.map(normalizePin).filter(Boolean);
    const hasPinArray = normalizedEventPins.length > 0;
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
    const baseFormData = { ...(order.form_data || {}) };
    if (baseFormData.pairgate_test_mode === true) {
      delete baseFormData.delivery_pin;
      delete baseFormData.delivery_pins;
      delete baseFormData.delivery_completed_at;
    }
    const delivered = {
      event: String(event.event || ""),
      status: success ? "successful" : "failed",
      item: String(event.item || event.plan || ""),
      message: String(event.message || ""),
      recipient: String(event.recipient || ""),
      token_or_pin: hasDeliveredValue ? String(deliveredValue) : normalizedEventPins.join("\n"),
      completed_at: String(event.completed_at || new Date().toISOString())
    };
    const waitingForDelivery = success && needsDeliveryValue && !hasDeliveredValue && !hasPinArray;
    let orderStatus = success ? (waitingForDelivery ? "processing" : "completed") : "needs_information";
    let formData: Record<string, any> = {
      ...(order.form_data || {}),
      pairgate_delivery: JSON.stringify(delivered),
      delivery_status_message: waitingForDelivery ? "Provider reports success but has not returned the token/PIN yet." : delivered.message,
      ...(hasDeliveredValue ? { delivery_pin: String(deliveredValue) } : {}),
      ...(!hasDeliveredValue && normalizedEventPins.length ? { delivery_pins: normalizedEventPins.join("\n") } : {})
    };
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
      if (allDone) {
        const { error: parentUpdateError } = await admin.from("provider_transactions").update({
          status: "successful",
          provider_status: "All requested exam PIN child transactions delivered"
        }).eq("order_id", order.id).eq("service_id", "exam");
        if (parentUpdateError) throw parentUpdateError;
      }
      orderStatus = allDone ? "completed" : anyFailed ? "needs_information" : "processing";
      orderMessage = allDone ? "All requested exam PINs have been delivered." : anyFailed ? "At least one exam PIN failed. Contact support before retrying." : "Some exam PINs are still being generated by Pairgate.";
      formData = { ...baseFormData, pairgate_test_mode: false, delivery_pins: pins.join("\n"), pairgate_delivery: JSON.stringify(delivered), delivery_status_message: delivered.message, ...(hasDeliveredValue ? { delivery_pin: String(deliveredValue) } : {}), ...(!waitingForDelivery ? { delivery_completed_at: delivered.completed_at } : {}) };
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