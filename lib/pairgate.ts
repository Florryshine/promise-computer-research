import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const BASE_URL = (process.env.PAIRGATE_BASE_URL || "https://pairgate.com/api/v1").replace(/\/+$/, "");
const API_KEY = (process.env.PAIRGATE_API_KEY || "").trim();
const TEST_MODE = (process.env.PAIRGATE_TEST_MODE || "true").toLowerCase() === "true";

function clean(value: unknown) { return String(value ?? "").trim(); }
function isTestModePayload(payload: any): boolean {
  return payload?.test_mode === true || payload?.data?.test_mode === true || payload?.data?.data?.test_mode === true;
}
function first(object: any, ...keys: string[]) {
  for (const key of keys) if (object?.[key] !== undefined && object?.[key] !== null && clean(object[key])) return object[key];
  return "";
}

export function pairgateConfigured() {
  return Boolean(API_KEY);
}

export async function pairgateRequest(path: string, method: "GET" | "POST" = "GET", params?: Record<string, unknown>, useTestMode = TEST_MODE) {
  if (!API_KEY) throw new Error("Pairgate API key is missing. Set PAIRGATE_API_KEY in Vercel.");
  const cleanPath = path.replace(/^\/+/, "");
  const testPath = useTestMode && !cleanPath.startsWith("test/") ? "test/" + cleanPath : cleanPath;
  const url = new URL(testPath, BASE_URL + "/");
  const options: RequestInit = {
    method,
    headers: {
      Authorization: "Bearer " + API_KEY,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  };
  if (method === "GET") {
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && clean(value)) url.searchParams.set(key, String(value));
    }
  } else if (params) {
    options.body = JSON.stringify(params);
  }

  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    throw new Error("PAIRGATE_NETWORK_AMBIGUOUS: " + message);
  }

  const raw = await response.text();
  let payload: any;
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { payload = { message: raw }; }

  if (!response.ok || String(payload?.status || "").toLowerCase() === "error") {
    const message = first(payload, "message", "detail", "error") || "Pairgate API request failed.";
    throw new Error("PAIRGATE_HTTP_" + response.status + ": " + message);
  }
  return payload;
}

function normalizePhone(value: unknown): string {
  const digits = clean(value).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) return digits;
  if (digits.length === 13 && digits.startsWith("234")) return digits;
  if (digits.length === 10) return "0" + digits;
  return digits;
}

function networkSlug(value: unknown): string | null {
  const v = clean(value).toLowerCase().replace(/\s+/g, "");
  if (["mtn", "airtel", "glo", "9mobile"].includes(v)) return v;
  if (v === "etisalat") return "9mobile";
  if (v.includes("mtn")) return "mtn";
  if (v.includes("airtel")) return "airtel";
  if (v === "glo" || v.includes(" glo")) return "glo";
  if (v.includes("9mobile") || v.includes("etisalat")) return "9mobile";
  return null;
}

function dataRows(payload: any, wantedNetwork: string): any[] {
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const wanted = wantedNetwork.toLowerCase();
  for (const [key, value] of Object.entries(data)) {
    if (networkSlug(key) === wanted && Array.isArray(value)) return value as any[];
  }
  for (const key of ["plans", "results", "items", "data"]) {
    if (Array.isArray((data as any)[key])) return (data as any)[key];
  }
  return [];
}

async function catalogueRequest(path: string, params?: Record<string, unknown>) {
  try {
    return await pairgateRequest(path, "GET", params);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("PAIRGATE_HTTP_429")) throw error;
    const seconds = Number(message.match(/wait\s+(\d+)\s+seconds?/i)?.[1] || 2);
    // Pairgate explicitly rate-limits catalogue requests. Wait beyond its requested window, then retry once.
    await new Promise(resolve => setTimeout(resolve, Math.max(1500, seconds * 1000 + 500)));
    return await pairgateRequest(path, "GET", params);
  }
}

export type PairgateDataPlan = {
  id: string;
  networkId: string;
  network: string;
  name: string;
  price: number;
  validity: string;
  planType: string;
};

export async function getPairgateDataPlans(networkInput?: string): Promise<PairgateDataPlan[]> {
  const wanted = networkSlug(networkInput || "mtn");
  if (!wanted) throw new Error("Choose a supported network: MTN, Airtel, Glo or 9mobile.");

  const categoryPayload = await catalogueRequest("/data-plans/categories");
  const categories = Array.isArray(categoryPayload?.data) ? categoryPayload.data : [];
  const matchingTypes = categories
    .filter((row: any) => networkSlug(row?.provider_name || row?.provider_id) === wanted && clean(row?.service_type).toLowerCase() === "data")
    .map((row: any) => clean(row?.plan_type).toUpperCase())
    .filter((type: string) => ["CG", "CG_LITE", "SME", "GIFTING", "AWOOF"].includes(type));
  const planTypes = [...new Set(matchingTypes)];
  if (!planTypes.length) throw new Error("Pairgate returned no data-plan categories for " + wanted + ".");

  // Respect the cooldown between the categories request and the first plans request.
  await new Promise(resolve => setTimeout(resolve, 2200));
  // Do not fan out requests with Promise.all: that burst repeatedly trips Pairgate's 429 limit.
  const allPlans: PairgateDataPlan[] = [];
  for (let index = 0; index < planTypes.length; index++) {
    const planType = clean(planTypes[index]).toUpperCase();
    if (index > 0) await new Promise(resolve => setTimeout(resolve, 2200));
    const payload = await catalogueRequest("/data-plans", { provider_id: wanted, plan_type: planType });
    const rows = dataRows(payload, wanted);
    for (const row of rows) {
      const id = clean(first(row, "plan_id", "id", "planId"));
      const name = clean(first(row, "name", "plan_name", "title"));
      const price = Number(first(row, "price", "amount", "selling_price"));
      const duration = first(row, "duration", "validity", "validity_period");
      if (!id || !name || !Number.isFinite(price) || price <= 0) continue;
      allPlans.push({
        id, networkId: wanted,
        network: ({ mtn: "MTN", airtel: "Airtel", glo: "Glo", "9mobile": "9mobile" } as Record<string, string>)[wanted],
        name, price,
        validity: duration === "" ? "" : /^\d+$/.test(clean(duration)) ? clean(duration) + " days" : clean(duration),
        planType,
      });
    }
  }
  const unique = new Map<string, PairgateDataPlan>();
  for (const plan of allPlans) unique.set(plan.id, plan);
  return [...unique.values()].sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
}

function requestId(order: any) {
  return "PCR-PAIRGATE-" + String(order.reference).replace(/[^A-Za-z0-9_-]/g, "") + "-" +
    crypto.createHash("sha1").update(order.id).digest("hex").slice(0, 10);
}

type PairgateProduct =
  | { kind: "airtime"; network: string | null; phone: string; amount: number }
  | { kind: "data"; network: string | null; phone: string; plan: string; amount: number }
  | { kind: "cable"; provider: string; plan: string; smartcard: string; recipientName: string; amount: number }
  | { kind: "electricity"; provider: string; meterNumber: string; meterType: number; recipientName: string; amount: number }
  | { kind: "exam"; provider: string; quantity: number; amount: number }
  | { kind: "epin"; network: string | null; denomination: number; quantity: number; amount: number };

function normalize(order: any): PairgateProduct | null {
  const service = Array.isArray(order.services) ? order.services[0] : order.services;
  const slug = String(service?.slug || "");
  const form = (order.form_data || {}) as Record<string, any>;
  const phone = normalizePhone(form.mobile_number || form.phone_number || form.phone);
  if (slug === "airtime-recharge") {
    const amount = Number(form.provider_amount || form.amount || order.amount);
    return { kind: "airtime", network: networkSlug(form.network_id || form.network), phone, amount };
  }
  if (slug === "data-subscription") {
    const amount = Number(form.provider_amount || order.amount);
    return { kind: "data", network: networkSlug(form.network_id || form.network), phone, plan: clean(form.provider_plan_id || form.plan_id || form.plan), amount };
  }
  if (["dstv-subscription", "gotv-subscription", "startimes-subscription"].includes(slug)) {
    const provider = slug === "dstv-subscription" ? "dstv" : slug === "gotv-subscription" ? "gotv" : "startimes";
    return { kind: "cable", provider, plan: clean(form.provider_plan_id || form.plan_id), smartcard: clean(form.smartcard || form.smartcard_number || form.iuc_number), recipientName: clean(form.full_name || form.recipient_name), amount: Number(form.provider_amount || 0) };
  }
  if (slug === "electricity-bill") return { kind: "electricity", provider: clean(form.provider_id || form.disco_id), meterNumber: clean(form.meter_number), meterType: Number(form.meter_type || form.meter_type_id), recipientName: clean(form.full_name || form.recipient_name), amount: Number(form.provider_amount || form.amount || 0) };
  if (slug === "exam-pins") return { kind: "exam", provider: clean(form.exam_type || form.provider_id).toLowerCase(), quantity: Number(form.quantity || 1), amount: Number(form.provider_amount || order.amount || 0) };
  if (slug === "data-pins") return { kind: "epin", network: networkSlug(form.network || form.provider_id), denomination: Number(form.denomination || 0), quantity: Number(form.quantity || 1), amount: Number(form.provider_amount || order.amount || 0) };
  return null;
}

function statusOf(payload: any): string {
  const nested = payload?.data ?? payload;
  const value = nested?.status;
  if (value === true) return "processing";
  if (value === false) return "failed";
  const status = clean(value || payload?.status || nested?.message || payload?.message).toLowerCase();
  if (["successful", "success", "completed", "complete", "delivered"].includes(status)) return "successful";
  if (["failed", "failure", "error", "rejected", "declined", "cancelled"].includes(status)) return "failed";
  return "pending";
}

async function updateFinalStatus(admin: any, order: any, transaction: any, status: string, response: any) {
  const providerData = response?.data ?? response;
  const providerMessage = clean(first(providerData, "message", "status")) || status;
  const service = Array.isArray(order.services) ? order.services[0] : order.services;
  const slug = String(service?.slug || "");
  const rawDeliveredPin = clean(first(providerData, "pin", "token", "electricity_token", "meter_token", "token_number", "voucher_code"));
  const deliveredPin = slug === "exam-pins" && rawDeliveredPin.includes("<=>")
    ? rawDeliveredPin.split("<=>").map((part: string, index: number) => (index === 0 ? "PIN: " : "Serial: ") + part.trim()).filter((part: string) => !part.endsWith(": ")).join(" | ")
    : rawDeliveredPin;
  const pins = Array.isArray(providerData?.pins) ? providerData.pins : [];
  const pinText = pins.map((item: any) => [
    item.pin ? "PIN: " + item.pin : "",
    item.serial ? "Serial: " + item.serial : "",
    item.denomination ? "Denomination: ₦" + item.denomination : ""
  ].filter(Boolean).join(" | ")).join("\n");
  const hasDeliveryData = Boolean(deliveredPin || pinText);
  const tokenRequired = slug === "electricity-bill";
  const pinRequired = slug === "exam-pins";
  // A provider's generic "successful" status is not proof that the customer
  // received the electricity token or exam PIN. Keep it re-checkable until
  // the actual deliverable is present.
  const deliveryPending = status === "successful" && ((tokenRequired || pinRequired) && !hasDeliveryData);
  const persistedStatus = status === "successful" && deliveryPending ? "pending" : status;

  const { error: txUpdateError } = await admin.from("provider_transactions").update({
    provider_reference: first(providerData, "reference_code", "transaction_id", "transaction_reference", "reference") || transaction.provider_reference || null,
    provider_status: deliveryPending ? "Provider reports success; waiting for token/PIN delivery" : providerMessage,
    status: persistedStatus === "successful" ? "successful" : persistedStatus === "failed" ? "failed" : "pending",
    response,
  }).eq("request_id", transaction.request_id);
  if (txUpdateError) throw txUpdateError;

  if (status === "successful") {
    const updatedForm = {
      ...(order.form_data || {}),
      ...(deliveredPin ? { delivery_pin: deliveredPin } : {}),
      ...(pinText ? { delivery_pins: pinText } : {}),
      ...(clean(first(providerData, "batch_id")) ? { delivery_batch_id: clean(first(providerData, "batch_id")) } : {}),
      delivery_status_message: deliveryPending ? "Pairgate reports success but has not returned the token/PIN yet. Please refresh later or contact support." : providerMessage,
      delivery_completed_at: hasDeliveryData ? (clean(first(providerData, "completed_at")) || new Date().toISOString()) : (order.form_data?.delivery_completed_at || ""),
    };
    const completed = !deliveryPending;
    const { error: orderUpdateError } = await admin.from("orders").update({
      status: completed ? "completed" : "processing",
      admin_note: completed
        ? "Pairgate confirmed the service transaction and returned the delivery details."
        : "Pairgate reports a successful transaction, but no electricity token/exam PIN was returned yet. The order remains processing until delivery details arrive.",
      form_data: updatedForm,
    }).eq("id", order.id);
    if (orderUpdateError) throw orderUpdateError;

    if (completed && order.customer_id) {
      await admin.from("notifications").insert({
        user_id: order.customer_id,
        title: "Order completed",
        message: "Your " + (service?.title || "service") + " order " + order.reference + " was completed successfully. Open order details to view the delivery information.",
      });
    }
  } else if (status === "failed") {
    const { error: orderUpdateError } = await admin.from("orders").update({
      status: "needs_information",
      admin_note: "Pairgate reports that the transaction failed. Check Pairgate transaction history and wallet refund before taking further action."
    }).eq("id", order.id);
    if (orderUpdateError) throw orderUpdateError;
    if (order.customer_id) {
      await admin.from("notifications").insert({
        user_id: order.customer_id,
        title: "Order needs attention",
        message: "Your order " + order.reference + " needs a service-status check. We are reviewing the provider result.",
      });
    }
  }
}

async function markNeedsAttention(admin: any, order: any, message: string) {
  await admin.from("orders").update({
    status: "needs_information",
    admin_note: "Payment received, but Pairgate fulfillment could not start: " + message,
  }).eq("id", order.id);
  return { status: "failed", message };
}

async function checkPendingTransaction(admin: any, order: any, transaction: any) {
  const referenceCode = clean(transaction.provider_reference || first(transaction.response?.data, "reference_code"));
  if (!referenceCode) {
    return { status: "pending", message: "Pairgate was contacted but did not return a transaction reference. Check Pairgate history before any retry." };
  }
  try {
    const result = await pairgateRequest("/transaction/status", "GET", { reference_code: referenceCode });
    const status = (TEST_MODE || isTestModePayload(result)) ? "pending" : statusOf(result);
    await updateFinalStatus(admin, order, transaction, status, result);
    if (status === "pending") {
      const service = Array.isArray(order.services) ? order.services[0] : order.services;
      const slug = String(service?.slug || "");
      const hasToken = Boolean(clean(order.form_data?.delivery_pin));
      const pinsText = clean(order.form_data?.delivery_pins);
      const expectedPins = Math.max(1, Number(order.form_data?.quantity || 1));
      const deliveredPins = Math.max((pinsText.match(/PIN:\s*(?!pending\b)[^|\n]+/gi) || []).length, hasToken ? 1 : 0);
      const deliveryStillMissing = slug === "electricity-bill" ? !hasToken : slug === "exam-pins" ? deliveredPins < expectedPins || /PIN pending/i.test(pinsText) : false;
      if (deliveryStillMissing) {
        const { error: orderUpdateError } = await admin.from("orders").update({
          status: "processing",
          admin_note: "The previous order status did not have proof of delivery. Pairgate has not yet confirmed the required token/PIN delivery; the order is being tracked and was not resubmitted.",
        }).eq("id", order.id);
        if (orderUpdateError) throw orderUpdateError;
      }
    }
    return { status, result, message: status === "pending" ? "Pairgate transaction is still processing. It was not resubmitted." : "Pairgate transaction status checked: " + status + "." };
  } catch (error) {
    return { status: "pending", message: "Existing Pairgate transaction was not resubmitted. Status check failed: " + (error instanceof Error ? error.message : "unknown error") };
  }
}

export async function fulfillOrder(orderId: string) {
  const admin = createAdminClient();
  const { data: order, error } = await admin.from("orders")
    .select("id,reference,status,payment_status,amount,form_data,customer_id,services(slug,title)")
    .eq("id", orderId).maybeSingle();
  if (error) throw error;
  if (!order) throw new Error("Order not found");
  if (String(order.status) === "cancelled") return { status: "cancelled", message: "This order is cancelled. No provider purchase was submitted." };
  if (order.payment_status !== "paid") return { status: "skipped", message: "Order is not paid." };

  const service = Array.isArray(order.services) ? order.services[0] : order.services;
  const slug = String(service?.slug || "");
  const savedPin = clean(order.form_data?.delivery_pin);
  const savedPinsText = clean(order.form_data?.delivery_pins);
  const expectedPins = Math.max(1, Number(order.form_data?.quantity || 1));
  const deliveredPinCount = Math.max((savedPinsText.match(/PIN:\s*(?!pending\b)[^|\n]+/gi) || []).length, savedPin ? 1 : 0);
  const hasRequiredDelivery = slug === "electricity-bill"
    ? Boolean(savedPin)
    : slug === "exam-pins"
    ? deliveredPinCount >= expectedPins && !/PIN pending/i.test(savedPinsText)
    : true;
  // Repair legacy orders that were incorrectly marked completed without the
  // actual electricity token or all requested exam PINs.
  if (String(order.status) === "completed" && hasRequiredDelivery) {
    return { status: "completed", message: "This order already has its required delivery details." };
  }

  const product = normalize(order);
  if (!product) return markNeedsAttention(admin, order, "This service is not yet enabled in the Pairgate adapter. Airtime and mobile data are supported in this integration pass; other services need their exact Pairgate fields/catalogues before automation.");

  const phoneKind = product.kind === "airtime" || product.kind === "data";
  const problem =
    !Number.isFinite(product.amount) || product.amount <= 0 ? "A valid provider purchase amount is missing." :
    phoneKind && !product.network ? "Pairgate network slug is missing." :
    phoneKind && !/^0\d{10}$|^234\d{10}$/.test(product.phone) ? "Recipient phone number must be 11 digits starting with 0 or 13 digits starting with 234." :
    product.kind === "airtime" && product.amount < 50 ? "Pairgate airtime minimum is ₦50." :
    product.kind === "data" && !product.plan ? "Pairgate data plan ID is missing." :
    product.kind === "cable" && (!product.plan || !/^\d{6,20}$/.test(product.smartcard)) ? "A valid TV package and smartcard/IUC number are required." :
    product.kind === "electricity" && (!product.provider || !/^\d{1,20}$/.test(product.meterNumber) || ![1,2].includes(product.meterType) || product.amount < 1000) ? "A valid disco, meter number/type and amount of at least ₦1,000 are required." :
    product.kind === "exam" && (!["waec","neco","nabt"].includes(product.provider) || !Number.isInteger(product.quantity) || product.quantity < 1 || product.quantity > 10) ? "Choose a supported exam body and quantity from 1 to 10." :
    product.kind === "epin" && (!product.network || ![100,200,500,1000,2000,5000,10000,20000].includes(product.denomination) || !Number.isInteger(product.quantity) || product.quantity < 1 || product.quantity > 10) ? "Choose a supported network, denomination and quantity from 1 to 10." : "";
  if (problem) return markNeedsAttention(admin, order, problem);

  const baseRequestId = requestId(order);
  const { data: existing, error: existingError } = await admin.from("provider_transactions")
    .select("*").eq("order_id", order.id).eq("service_id", product.kind).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existingError) throw existingError;
  if (existing?.status === "successful" && hasRequiredDelivery) return { status: "successful", message: "Already fulfilled with delivery details.", transaction: existing };

  const responseStatus = clean(existing?.response?.data?.status ?? existing?.response?.status).toLowerCase();
  const testModeAttempt = Boolean(existing && (
    existing.response?.test_mode === true ||
    existing.response?.retryable_test_attempt === true ||
    existing.response?.data?.test_mode === true ||
    existing.response?.data?.data?.test_mode === true
  ));
  if (testModeAttempt && TEST_MODE) {
    return { status: "test_mode", message: "This order's previous attempt used Pairgate TEST MODE. Set PAIRGATE_TEST_MODE=false in the deployed environment, verify Pairgate has sufficient live wallet funds, then retry this already-paid order. No live purchase has been confirmed." };
  }
  const explicitProviderRejection = Boolean(existing && existing.status === "failed" && (
    existing?.response?.data?.status === false ||
    existing?.response?.status === false ||
    ["failed", "failure", "error", "rejected", "declined", "cancelled"].includes(responseStatus) ||
    (Boolean(existing?.response?.error) && existing?.response?.ambiguous !== true && !/fetch failed|network|timeout|timed out|dns|socket|econn|connection reset/i.test(clean(existing?.response?.error)))
  ));
  // A confirmed provider rejection can be retried against the same paid order.
  // Unknown outcomes are status-checked, never blindly resubmitted, to reduce duplicate delivery.
  const retryableProviderRejection = explicitProviderRejection || (testModeAttempt && !TEST_MODE);

  if (existing && existing.response && Object.keys(existing.response).length > 0 && !retryableProviderRejection) {
    return checkPendingTransaction(admin, order, existing);
  }
  if (existing && !retryableProviderRejection) {
    await admin.from("orders").update({
      status: "needs_information",
      admin_note: "A Pairgate transaction record exists without a saved provider response. It was not resubmitted to prevent a possible duplicate charge. Check Pairgate transaction history before taking action.",
    }).eq("id", order.id);
    return { status: "pending", message: "Existing Pairgate transaction has no saved response. It was not resubmitted to avoid a possible duplicate charge." };
  }

  // Preserve the original failed attempt and use a unique reference for the safe retry.
  const rid = retryableProviderRejection
    ? baseRequestId + (testModeAttempt ? "-LIVE-" : "-R-") + Date.now().toString(36).toUpperCase()
    : baseRequestId;
  if (retryableProviderRejection) {
    await admin.from("orders").update({
      status: "processing",
      admin_note: "Pairgate explicitly rejected the previous delivery attempt. A new delivery attempt is being submitted against the existing successful payment.",
    }).eq("id", order.id);
  }

  const { error: insertError } = await admin.from("provider_transactions").insert({
    order_id: order.id, provider: "pairgate", request_id: rid, service_id: product.kind,
    amount: product.amount, status: "pending", provider_status: retryableProviderRejection ? "confirmed-failure retry submitted" : "pending", request_data: product,
  });
  if (insertError) throw insertError;

  let result: any;
  try {
    const endpoints: Record<string,string> = { airtime:"/airtime/purchase", data:"/data/purchase", cable:"/cable/purchase", electricity:"/electricity/purchase", exam:"/education/purchase", epin:"/epin/purchase" };
    const requestBody: Record<string,unknown> = product.kind === "airtime"
      ? { provider_id: product.network, amount: product.amount, recipient: product.phone, reference: rid }
      : product.kind === "data"
      ? { provider_id: product.network, plan_id: product.plan, recipient: product.phone, reference: rid }
      : product.kind === "cable"
      ? { provider_id: product.provider, plan_id: product.plan, smartcard: product.smartcard, recipient_name: product.recipientName || "Unknown Customer", reference: rid }
      : product.kind === "electricity"
      ? { provider_id: product.provider, amount: product.amount, meter_number: product.meterNumber, meter_type: product.meterType, recipient_name: product.recipientName || "Unknown Customer", reference: rid }
      : product.kind === "exam"
      ? { provider_id: product.provider, quantity: product.quantity, reference: rid }
      : { provider_id: product.network, quantity: product.quantity, denomination: product.denomination, reference: rid };
    result = await pairgateRequest(endpoints[product.kind], "POST", requestBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pairgate request failed.";
    const ambiguous = message.startsWith("PAIRGATE_NETWORK_AMBIGUOUS") || /PAIRGATE_HTTP_5\d\d/.test(message);
    await admin.from("provider_transactions").update({
      status: ambiguous ? "pending" : "failed",
      provider_status: ambiguous ? "unknown — check Pairgate transaction history before retrying" : "error",
      response: { error: message, ambiguous },
    }).eq("request_id", rid);
    await admin.from("orders").update({
      status: "needs_information",
      admin_note: ambiguous
        ? "Pairgate connection failed during the purchase request. The result is unknown; check Pairgate transaction history before any retry."
        : "Payment received, but Pairgate rejected the purchase request: " + message,
    }).eq("id", order.id);
    await admin.from("notifications").insert({
      user_id: order.customer_id,
      title: "Payment received — order needs attention",
      message: "Your payment was successful, but the provider transaction needs a manual check. We are reviewing order " + order.reference + ".",
    });
    return { status: ambiguous ? "pending" : "failed", message };
  }

  const nested = result?.data ?? result;
  const providerReference = clean(first(nested, "reference_code", "transaction_id", "transaction_reference", "reference"));
  const testMode = TEST_MODE || isTestModePayload(result);
  const status = testMode ? "pending" : statusOf(result);
  const transaction = {
    request_id: rid,
    provider_reference: providerReference,
    service_id: product.kind,
    response: result,
  };
  if (testMode) {
    // Test endpoints must never make a paid customer order look delivered.
    const { error: testTxError } = await admin.from("provider_transactions").update({
      status: "pending",
      provider_status: "TEST MODE — no live purchase was made",
      response: { ...result, test_mode: true, retryable_test_attempt: true },
      provider_reference: providerReference || null,
    }).eq("request_id", rid);
    if (testTxError) throw testTxError;
    const { error: testOrderError } = await admin.from("orders").update({
      status: "needs_information",
      admin_note: "Pairgate TEST MODE was used. This response is not a live purchase and no delivery should be assumed. Confirm live mode and explicitly retry this paid order.",
      form_data: { ...(order.form_data || {}), pairgate_test_mode: true, delivery_status_message: "Test-mode attempt only — awaiting a live provider purchase." },
    }).eq("id", order.id);
    if (testOrderError) throw testOrderError;
    return { status: "test_mode", message: "Pairgate test mode was used. No live fulfilment is confirmed; a deliberate live retry is required.", result };
  }
  if (product.kind === "exam") {
    const details = Array.isArray(nested?.details) ? nested.details : [];
    const children = details.map((item: any) => clean(item.reference ?? item.reference_code ?? item.transaction_reference)).filter(Boolean);
    for (const childReference of children) {
      const { error: childInsertError } = await admin.from("provider_transactions").upsert({
        order_id: order.id, provider: "pairgate", request_id: childReference,
        provider_reference: childReference, service_id: "exam-pin", amount: Number(nested?.unit_price || product.amount / product.quantity),
        status: "pending", provider_status: "pending", request_data: { provider: product.provider, parent_reference: rid },
        response: { parent_reference: rid }
      }, { onConflict: "request_id" });
      if (childInsertError) throw new Error("Pairgate returned exam PIN references but saving child transaction " + childReference + " failed: " + childInsertError.message);
    }
    if (children.length > 0 && children.length < product.quantity) {
      const { error: partialExamError } = await admin.from("orders").update({
        status: "processing",
        admin_note: "Pairgate returned only " + children.length + " of " + product.quantity + " expected exam PIN transaction references. Do not resubmit; reconcile Pairgate history first.",
      }).eq("id", order.id);
      if (partialExamError) throw partialExamError;
    }
  }
  await updateFinalStatus(admin, order, transaction, status, result);
  if (status === "pending") {
    await admin.from("orders").update({
      status: "processing",
      admin_note: "Pairgate accepted the purchase request. Waiting for final provider status; do not resubmit while it is pending.",
    }).eq("id", order.id);
  }
  return { status, result };
}

export async function pairgateHealth() {
  const payload = await pairgateRequest("/wallet/balance");
  return payload;
}
