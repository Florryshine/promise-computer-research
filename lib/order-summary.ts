import { countSavedPins, parsePinText } from "@/lib/pin-delivery";

type Form = Record<string, any>;

const NAIRA = (value: unknown) => "₦" + Number(value || 0).toLocaleString();
const text = (value: unknown) => (value === undefined || value === null ? "" : String(value).trim());
const upper = (value: unknown) => text(value).toUpperCase();

export const PIN_SLUGS = ["exam-pins", "data-pins"];

/** Short, human description of what the customer asked for. */
export function describeOrdered(slug: string, form: Form = {}): { headline: string; details: Array<[string, string]> } {
  const quantity = Math.max(1, Number(form.quantity || 1));
  switch (slug) {
    case "data-pins": {
      const network = upper(form.network || form.provider_id);
      return {
        headline: `${quantity} × ${network} ${NAIRA(form.denomination)} recharge card${quantity > 1 ? "s" : ""}`,
        details: [["Network", network], ["Denomination", NAIRA(form.denomination)], ["Quantity", String(quantity)], ["Face value total", NAIRA(form.provider_amount)], ["Service fee", NAIRA(form.service_fee)]],
      };
    }
    case "exam-pins": {
      const exam = upper(form.exam_type || form.provider_id);
      return {
        headline: `${quantity} × ${exam} result-checker PIN${quantity > 1 ? "s" : ""}`,
        details: [["Exam body", exam], ["Quantity", String(quantity)], ["Unit price", NAIRA(form.unit_price)], ["Service fee", NAIRA(form.service_fee)]],
      };
    }
    case "airtime-recharge":
      return {
        headline: `${NAIRA(form.provider_amount || form.amount)} ${upper(form.network)} airtime → ${text(form.phone_number || form.mobile_number || form.phone)}`,
        details: [["Network", upper(form.network)], ["Recipient", text(form.phone_number || form.mobile_number || form.phone)], ["Airtime amount", NAIRA(form.provider_amount || form.amount)], ["Service fee", NAIRA(form.service_fee)]],
      };
    case "data-subscription":
      return {
        headline: `${upper(form.network)} ${text(form.plan_name) || "data"} → ${text(form.phone_number || form.mobile_number || form.phone)}`,
        details: [["Network", upper(form.network)], ["Plan", text(form.plan_name)], ["Validity", text(form.plan_validity)], ["Recipient", text(form.phone_number || form.mobile_number || form.phone)], ["Service fee", NAIRA(form.service_fee)]],
      };
    case "dstv-subscription":
    case "gotv-subscription":
    case "startimes-subscription":
      return {
        headline: `${upper(form.provider_id)} ${text(form.plan_name)} · ${text(form.smartcard || form.smartcard_number || form.iuc_number)}`,
        details: [["Provider", upper(form.provider_id)], ["Package", text(form.plan_name)], ["Smartcard / IUC", text(form.smartcard || form.smartcard_number || form.iuc_number)], ["Account name", text(form.verified_customer_name)], ["Service fee", NAIRA(form.service_fee)]],
      };
    case "electricity-bill":
      return {
        headline: `${NAIRA(form.provider_amount)} ${text(form.provider_id)} electricity · meter ${text(form.meter_number)}`,
        details: [["Disco", text(form.provider_id)], ["Meter number", text(form.meter_number)], ["Meter type", Number(form.meter_type) === 2 ? "Postpaid" : "Prepaid"], ["Account name", text(form.verified_customer_name)], ["Token amount", NAIRA(form.provider_amount)], ["Service fee", NAIRA(form.service_fee)]],
      };
    default:
      return { headline: "", details: [] };
  }
}

export type ReceivedSummary = {
  label: string;
  tone: "good" | "wait" | "bad" | "neutral";
  detail?: string;
  pins: Array<Record<string, string>>;
  token?: string;
};

/** What the customer has actually received so far. */
export function describeReceived(slug: string, orderStatus: string, form: Form = {}): ReceivedSummary {
  const pins = parsePinText(form.delivery_pins).filter(row => row.PIN && !/^pending$/i.test(row.PIN));
  const token = text(form.delivery_pin);
  const isTest = form.pairgate_test_mode === true;
  if (isTest) return { label: "Test-mode attempt only — nothing delivered", tone: "bad", pins: [] };

  if (PIN_SLUGS.includes(slug)) {
    const expected = Math.max(1, Number(form.quantity || 1));
    const have = Math.max(countSavedPins(form.delivery_pins), token ? 1 : 0);
    if (have >= expected) return { label: `${have} of ${expected} PIN${expected > 1 ? "s" : ""} delivered`, tone: "good", pins, token: pins.length ? undefined : token };
    if (have > 0) return { label: `${have} of ${expected} PINs delivered — incomplete`, tone: "wait", pins, token: pins.length ? undefined : token };
    return { label: "PIN not delivered yet", tone: orderStatus === "needs_information" ? "bad" : "wait", detail: text(form.delivery_status_message), pins: [] };
  }
  if (slug === "electricity-bill") {
    return token
      ? { label: "Token delivered", tone: "good", pins: [], token }
      : { label: "Token not delivered yet", tone: orderStatus === "needs_information" ? "bad" : "wait", detail: text(form.delivery_status_message), pins: [] };
  }
  if (["airtime-recharge", "data-subscription", "dstv-subscription", "gotv-subscription", "startimes-subscription"].includes(slug)) {
    if (orderStatus === "completed") return { label: "Delivered by provider", tone: "good", detail: text(form.delivery_status_message), pins: [] };
    return { label: orderStatus === "needs_information" ? "Delivery needs attention" : "Awaiting provider confirmation", tone: orderStatus === "needs_information" ? "bad" : "wait", detail: text(form.delivery_status_message), pins: [] };
  }
  return { label: orderStatus === "completed" ? "Completed" : "Fulfilled manually", tone: orderStatus === "completed" ? "good" : "neutral", pins: [] };
}

/** Keys that are internal delivery bookkeeping and should not be listed as "submitted information". */
export const DELIVERY_KEYS = [
  "delivery_pin", "delivery_pins", "delivery_completed_at", "delivery_status_message", "delivery_batch_id",
  "pairgate_delivery", "pairgate_test_mode",
];

/** Pull provider cost / margin out of the saved Pairgate purchase response. */
export function providerCostOf(transactions: any[] = []): number | null {
  for (const tx of transactions) {
    const data = tx?.response?.data ?? tx?.response;
    const total = Number(data?.total_amount);
    if (tx?.status === "successful" || data?.status === true) if (Number.isFinite(total) && total > 0) return total;
  }
  return null;
}
