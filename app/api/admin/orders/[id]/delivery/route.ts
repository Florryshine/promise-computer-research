import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MANUAL_DELIVERY_SLUGS, normalizeManualDelivery } from "@/lib/manual-delivery";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await request.json();
    const input = String(body.delivery || "").trim();
    if (!input) return NextResponse.json({ error: "Delivery details are required." }, { status: 400 });

    const admin = createAdminClient();
    const { data: order, error } = await admin.from("orders")
      .select("id,reference,customer_id,payment_status,status,form_data,services(slug,title)")
      .eq("id", id).maybeSingle();
    if (error) throw error;
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    if (order.payment_status !== "paid") return NextResponse.json({ error: "Only paid orders can receive delivery details." }, { status: 409 });

    const service = Array.isArray(order.services) ? order.services[0] : order.services;
    const slug = String(service?.slug || "");
    if (!MANUAL_DELIVERY_SLUGS.includes(slug)) return NextResponse.json({ error: "Manual delivery is only enabled for electricity bills, exam PINs, and data PINs." }, { status: 400 });
    const normalized = normalizeManualDelivery(slug, input, Number(order.form_data?.quantity || 1));
    const formData: Record<string, any> = { ...(order.form_data || {}), delivery_completed_at: new Date().toISOString(), delivery_method: "manual_pairgate_reconciliation" };
    delete formData.pairgate_test_mode;
    if (normalized.delivery_pin) {
      formData.delivery_pin = normalized.delivery_pin;
      delete formData.delivery_pins;
    } else {
      formData.delivery_pins = normalized.delivery_pins;
      delete formData.delivery_pin;
    }
    const { error: updateError } = await admin.from("orders").update({
      form_data: formData, status: "completed",
      admin_note: String(body.note || "Delivery details reconciled manually from Pairgate.").slice(0, 2000)
    }).eq("id", id);
    if (updateError) throw updateError;
    const { error: notificationError } = await admin.from("notifications").insert({
      user_id: order.customer_id, title: "Your order delivery is ready",
      message: "Delivery details for order " + order.reference + " are now available in My Orders."
    });
    if (notificationError) console.error("Could not notify customer of manual delivery", notificationError);
    return NextResponse.json({ ok: true, status: "completed" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save delivery details." }, { status: 500 });
  }
}
