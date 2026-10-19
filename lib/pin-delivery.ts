// Shared helpers for reading recharge-card / exam PINs out of Pairgate payloads.
//
// Pairgate returns PINs as `data.pins[]`. Depending on the product an item can be a
// plain string ("1234567890123456"), a "pin<=>serial" string, or an object whose field
// names differ (pin / pin_code / pin_number / code ...). Previously only objects with a
// `pin` key were recognised, so valid purchases were treated as "no PIN delivered" and
// the PINs were never saved. Everything that reads PINs must go through this module.

export type ExtractedPin = {
  pin: string;
  serial: string;
  expiry: string;
  instructions: string;
  denomination: string;
};

function clean(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return "";
  return String(value).trim();
}

function pick(item: any, keys: string[]): string {
  for (const key of keys) {
    const value = clean(item?.[key]);
    if (value) return value;
  }
  return "";
}

const PIN_KEYS = ["pin", "pin_code", "pincode", "pin_number", "epin", "e_pin", "card_pin", "recharge_pin", "voucher_code", "voucher", "code", "token", "card_number"];
// Used where the object is NOT known to be a PIN item (the payload itself, or generic `details`).
// Generic fields such as `code` (an HTTP-style status) must never be mistaken for a PIN there.
const STRICT_PIN_KEYS = ["pin", "pin_code", "pin_number", "voucher_code", "token"];
const SERIAL_KEYS = ["serial", "serial_number", "serial_no", "serialNumber", "sn", "card_serial"];
const EXPIRY_KEYS = ["expiry", "expiry_date", "expires_at", "expires_on", "expiresOn", "expire_date"];
const INSTRUCTION_KEYS = ["instructions", "instruction", "how_to_use", "usage"];
const DENOMINATION_KEYS = ["denomination", "face_value", "value", "amount"];

function fromString(raw: string, fallbackDenomination: string): ExtractedPin | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.includes("<=>")) {
    const [pin, serial] = text.split("<=>").map(part => part.trim());
    return pin ? { pin, serial: serial || "", expiry: "", instructions: "", denomination: fallbackDenomination } : null;
  }
  return { pin: text, serial: "", expiry: "", instructions: "", denomination: fallbackDenomination };
}

function fromItem(item: any, fallbackDenomination: string, strict = false): ExtractedPin | null {
  if (item === undefined || item === null) return null;
  if (typeof item === "string" || typeof item === "number") return fromString(String(item), fallbackDenomination);
  if (typeof item !== "object") return null;
  const rawPin = pick(item, strict ? STRICT_PIN_KEYS : PIN_KEYS);
  const serial = pick(item, SERIAL_KEYS);
  const base = rawPin.includes("<=>") ? fromString(rawPin, fallbackDenomination) : null;
  const pin = base?.pin ?? rawPin;
  const resolvedSerial = serial || base?.serial || "";
  if (!pin && !resolvedSerial) return null;
  return {
    pin,
    serial: resolvedSerial,
    expiry: pick(item, EXPIRY_KEYS),
    instructions: pick(item, INSTRUCTION_KEYS),
    denomination: pick(item, DENOMINATION_KEYS) || fallbackDenomination,
  };
}

/**
 * Pull every delivered PIN out of a Pairgate payload. Accepts the raw response
 * ({code,status,data:{...}}), the inner `data` object, or a webhook event.
 */
export function extractPins(payload: any): ExtractedPin[] {
  const data = payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data : payload;
  if (!data || typeof data !== "object") return [];
  const fallbackDenomination = clean(data.face_value ?? data.denomination);
  const collected: ExtractedPin[] = [];

  for (const key of ["pins", "epins", "e_pins", "cards", "details"]) {
    const list = data[key];
    if (Array.isArray(list)) {
      for (const item of list) {
        const extracted = fromItem(item, fallbackDenomination, key === "details");
        if (extracted) collected.push(extracted);
      }
    } else if (typeof list === "string" && list.trim()) {
      for (const part of list.split(/[\n,;]+/)) {
        const extracted = fromString(part, fallbackDenomination);
        if (extracted) collected.push(extracted);
      }
    }
    if (collected.length) return collected;
  }

  // Single-PIN responses use scalar fields on the data object.
  const scalar = fromItem(data, fallbackDenomination, true);
  return scalar ? [scalar] : [];
}

/** One human-readable line per PIN: "PIN: x | Serial: y | Expires: z | Denomination: ₦100". */
export function formatPinLine(pin: ExtractedPin): string {
  return [
    pin.pin ? "PIN: " + pin.pin : "",
    pin.serial ? "Serial: " + pin.serial : "",
    pin.expiry ? "Expires: " + pin.expiry : "",
    pin.denomination ? "Denomination: ₦" + pin.denomination : "",
  ].filter(Boolean).join(" | ");
}

export function formatPins(pins: ExtractedPin[]): string {
  return pins.map(formatPinLine).filter(Boolean).join("\n");
}

/** Parse the saved `delivery_pins` text back into structured rows for display. */
export function parsePinText(text: unknown): Array<Record<string, string>> {
  if (typeof text !== "string") return [];
  return text.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
    const row: Record<string, string> = {};
    for (const part of line.split(" | ")) {
      const index = part.indexOf(":");
      if (index === -1) { row.Note = (row.Note ? row.Note + " " : "") + part.trim(); continue; }
      row[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    }
    return row;
  });
}

/** Number of real (non-pending) PINs in saved delivery text. */
export function countSavedPins(text: unknown): number {
  return parsePinText(text).filter(row => row.PIN && !/^pending$/i.test(row.PIN)).length;
}

/** Mask all but the last 4 characters, for list views. */
export function maskPin(value: string): string {
  const v = String(value || "");
  return v.length <= 4 ? v : "•".repeat(Math.max(0, v.length - 4)) + v.slice(-4);
}
