import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const BASE_URL = (process.env.PAIRGATE_BASE_URL || "https://pairgate.com/api/v1").replace(/\/+$/, "");
const API_KEY = (process.env.PAIRGATE_API_KEY || "").trim();
const TEST_MODE = (process.env.PAIRGATE_TEST_MODE || "false").toLowerCase() === "true";

function clean(value: unknown) { return String(value ?? "").trim(); }
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

  const categoryPayload = await pairgateRequest("/data-plans/categories");
  const categories = Array.isArray(categoryPayload?.data) ? categoryPayload.data : [];
  const matchingTypes = categories
    .filter((row: any) => networkSlug(row?.provider_name || row?.provider_id) === wanted && clean(row?.service_type).toLowerCase() === "data")
    .map((row: any) => clean(row?.plan_type).toUpperCase())
    .filter((type: string) => ["CG", "CG_LITE", "SME", "GIFTING", "AWOOF"].includes(type));
  const planTypes = [...new Set(matchingTypes)];
  if (!planTypes.length) throw new Error("Pairgate returned no data-plan categories for " + wanted + ".");

  const results = await Promise.all(planTypes.map(async (rawPlanType: unknown) => {
    // Set/array inference can leave this value as unknown; normalize it before using it in the API request and returned plan.
    const planType: string = clean(rawPlanType).toUpperCase();
    const payload = await pairgateRequest("/data-plans", "GET", { provider_id: wanted, plan_type: planType });
    return dataRows(payload, wanted).map((row: any): PairgateDataPlan | null => {
      const id = clean(first(row, "plan_id", "id", "planId"));
      const name = clean(first(row, "name", "plan_name", "title"));
      const price = Number(first(row, "price", "amount", "selling_price"));
      const duration = first(row, "duration", "validity", "validity_period");
      if (!id || !name || !Number.isFinite(price) || price <= 0) return null;
      return {
        id,
        networkId: wanted,
        network: ({ mtn: "MTN", airtel: "Airtel", glo: "Glo", "9mobile": "9mobile" } as Record<string, string>)[wanted],
        name,
        price,
        validity: duration === "" ? "" : /^\d+$/.test(clean(duration)) ? clean(duration) + " days" : clean(duration),
        planType,
      };
    }).filter((plan: PairgateDataPlan | null): plan is PairgateDataPlan => Boolean(plan));
  }));

  const unique = new Map<string, PairgateDataPlan>();
  for (const plan of results.flat()) unique.set(plan.id, plan);
  return [...unique.values()].sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
}

function requestId(order: any) {
  return "PCR-PAIRGATE-" + String(order.reference).replace(/[^A-Za-z0-9_-]/g, "") + "-" +
    crypto.createHash("sha1").update(order.id).digest("hex").slice(0, 10);
}

function normalize(order: any) {
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
    return {
      kind: "data",
      network: networkSlug(form.network_id || form.network),
      phone,
      plan: clean(form.provider_plan_id || form.plan_id || form.plan),
      amount,
    };
  }
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
  await admin.from("provider_transactions").update({
    provider_reference: first(providerData, "reference_code", "transaction_id", "transaction_reference", "reference") || transaction.provider_reference || null,
    provider_status: providerMessage,
    status: status === "successful" ? "successful" : status === "failed" ? "failed" : "pending",
    response,
  }).eq("request_id", transaction.request_id);

  if (status === "successful") {
    await admin.from("orders").update({ status: "completed", admin_note: "Pairgate confirmed the service transaction as successful." }).eq("id", order.id);
    const service = Array.isArray(order.services) ? order.services[0] : order.services;
    await admin.from("notifications").insert({
      user_id: order.customer_id,
      title: "Order completed",
      message: "Your " + (service?.title || "service") + " order " + order.reference + " was completed successfully.",
    });
  } else if (status === "failed") {
    await admin.from("orders").update({ status: "needs_information", admin_note: "Pairgate reports that the transaction failed. Check Pairgate transaction history and wallet refund before taking further action." }).eq("id", order.id);
    await admin.from("notifications").insert({
      user_id: order.customer_id,
      title: "Order needs attention",
      message: "Your order " + order.reference + " needs a service-status check. We are reviewing the provider result.",
    });
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
    const status = result?.data?.test_mode === true ? "pending" : statusOf(result);
    await updateFinalStatus(admin, order, transaction, status, result);
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
  if (order.payment_status !== "paid") return { status: "skipped", message: "Order is not paid." };

  const product = normalize(order);
  if (!product) return markNeedsAttention(admin, order, "This service is not yet enabled in the Pairgate adapter. Airtime and mobile data are supported in this integration pass; other services need their exact Pairgate fields/catalogues before automation.");

  const problem =
    !Number.isFinite(product.amount) || product.amount <= 0 ? "A valid provider purchase amount is missing." :
    !product.network ? "Pairgate network slug is missing." :
    !/^0\d{10}$|^234\d{10}$/.test(product.phone) ? "Recipient phone number must be 11 digits starting with 0 or 13 digits starting with 234." :
    product.kind === "airtime" && product.amount < 50 ? "Pairgate airtime minimum is ₦50." :
    product.kind === "data" && !product.plan ? "Pairgate data plan ID is missing." : "";
  if (problem) return markNeedsAttention(admin, order, problem);

  const rid = requestId(order);
  const { data: existing, error: existingError } = await admin.from("provider_transactions").select("*").eq("request_id", rid).maybeSingle();
  if (existingError) throw existingError;
  if (existing?.status === "successful") return { status: "successful", message: "Already fulfilled.", transaction: existing };
  if (existing && existing.response && Object.keys(existing.response).length > 0) {
    return checkPendingTransaction(admin, order, existing);
  }
  if (existing) {
    await admin.from("orders").update({
      status: "needs_information",
      admin_note: "A Pairgate transaction record exists without a saved provider response. It was not resubmitted to prevent a possible duplicate charge. Check Pairgate transaction history before taking action.",
    }).eq("id", order.id);
    return { status: "pending", message: "Existing Pairgate transaction has no saved response. It was not resubmitted to avoid a possible duplicate charge." };
  }

  const { error: insertError } = await admin.from("provider_transactions").insert({
    order_id: order.id, provider: "pairgate", request_id: rid, service_id: product.kind,
    amount: product.amount, status: "pending", provider_status: "pending", request_data: product,
  });
  if (insertError) throw insertError;

  let result: any;
  try {
    result = await pairgateRequest(
      product.kind === "airtime" ? "/airtime/purchase" : "/data/purchase",
      "POST",
      {
        provider_id: product.network,
        ...(product.kind === "data" ? { plan_id: product.plan } : { amount: product.amount }),
        recipient: product.phone,
        reference: rid,
      },
    );
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
  const status = statusOf(result);
  const transaction = {
    request_id: rid,
    provider_reference: providerReference,
    response: result,
  };
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
