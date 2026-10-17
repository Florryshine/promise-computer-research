export type ManualDeliverySlug = "electricity-bill" | "exam-pins" | "data-pins";
export const MANUAL_DELIVERY_SLUGS: string[] = ["electricity-bill", "exam-pins", "data-pins"];

export function normalizeManualDelivery(slug: string, input: string, quantity = 1) {
  const lines = input.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error("Enter at least one token or PIN.");
  if (slug === "electricity-bill") {
    return { delivery_pin: lines.join("\n"), delivery_pins: null };
  }
  const pins = lines.map(line => {
    if (line.includes("<=>")) {
      const [pin, ...rest] = line.split("<=>");
      return "PIN: " + pin.trim() + (rest.join("<=>").trim() ? " | Serial: " + rest.join("<=>").trim() : "");
    }
    if (/^PIN\s*:/i.test(line)) return line;
    return "PIN: " + line;
  });
  if (slug === "exam-pins" && pins.length < Math.max(1, Number(quantity) || 1)) {
    throw new Error("Only " + pins.length + " PIN(s) supplied; the order requires " + quantity + ".");
  }
  return { delivery_pin: null, delivery_pins: pins.join("\n") };
}
