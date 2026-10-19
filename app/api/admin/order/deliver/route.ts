import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';
import {formatPinLine,type ExtractedPin} from '@/lib/pin-delivery';

const SLUGS=['exam-pins','data-pins','electricity-bill'];

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const orderId = typeof body.orderId === 'string' ? body.orderId : '';
  const lines = String(body.delivery || '').split('\n').map((l: string) => l.trim()).filter(Boolean);
  if (!orderId) return NextResponse.json({ error: 'Order ID is required.' }, { status: 400 });
  if (!lines.length) return NextResponse.json({ error: 'Paste at least one PIN or token.' }, { status: 400 });
  if (lines.length > 20) return NextResponse.json({ error: 'Too many lines (max 20).' }, { status: 400 });

  const admin = createAdminClient();
  const { data: order, error: loadError } = await admin.from('orders')
    .select('id,reference,status,payment_status,customer_id,form_data,services(slug,title)').eq('id', orderId).maybeSingle();
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  const service: any = Array.isArray(order.services) ? order.services[0] : order.services;
  const slug = String(service?.slug || '');
  if (!SLUGS.includes(slug)) return NextResponse.json({ error: 'Manual delivery is only for exam PINs, recharge card PINs and electricity tokens.' }, { status: 400 });
  if (order.payment_status !== 'paid') return NextResponse.json({ error: 'The order must be paid before delivery.' }, { status: 409 });
  if (order.status === 'cancelled') return NextResponse.json({ error: 'This order is cancelled.' }, { status: 409 });

  const form: Record<string, any> = { ...(order.form_data || {}) };
  const expected = Math.max(1, Number(form.quantity || 1));
  const valid = /^[A-Za-z0-9][A-Za-z0-9\- ]{3,63}$/;
  const patch: Record<string, unknown> = {};
  let deliveredCount = 0;
  let customerText = '';

  if (slug === 'electricity-bill') {
    const token = lines.join(' ').trim();
    if (!valid.test(token)) return NextResponse.json({ error: 'That does not look like a valid token.' }, { status: 400 });
    patch.delivery_pin = token; deliveredCount = 1; customerText = token;
  } else {
    const pins: ExtractedPin[] = [];
    for (const line of lines) {
      const [pin, serial = ''] = line.split(/\s*(?:\||<=>|,)\s*/).map((part: string) => part.trim());
      if (!valid.test(pin) || (serial && !valid.test(serial))) return NextResponse.json({ error: 'Line not recognised as a PIN: "' + line.slice(0, 40) + '"' }, { status: 400 });
      pins.push({ pin, serial, expiry: '', instructions: '', denomination: slug === 'data-pins' ? String(form.denomination || '') : '' });
    }
    if (pins.length > expected) return NextResponse.json({ error: 'You pasted ' + pins.length + ' PINs but this order is for ' + expected + '.' }, { status: 400 });
    customerText = pins.map(formatPinLine).join('\n');
    patch.delivery_pins = customerText; deliveredCount = pins.length;
  }

  const complete = deliveredCount >= expected;
  const now = new Date().toISOString();
  const newForm = {
    ...form, ...patch, pairgate_test_mode: false,
    delivery_status_message: complete ? 'Delivered by Promise Computer Research.' : 'Partly delivered (' + deliveredCount + ' of ' + expected + ').',
    delivery_source: 'manual',
    delivery_completed_at: complete ? now : '',
  };
  const { error: updateError } = await admin.from('orders').update({
    status: complete ? 'completed' : 'processing',
    form_data: newForm,
    admin_note: complete ? 'Delivered manually by an administrator.' : 'Partly delivered manually (' + deliveredCount + ' of ' + expected + ').',
  }).eq('id', order.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  if (complete) {
    const { error: txError } = await admin.from('provider_transactions').update({ status: 'successful', provider_status: 'Delivered manually by admin' }).eq('order_id', order.id).eq('status', 'pending');
    if (txError) return NextResponse.json({ error: 'Delivery was saved, but provider transaction status could not be updated: ' + txError.message }, { status: 500 });
  }

  const { error: notifyError } = await admin.from('notifications').insert({
    user_id: order.customer_id,
    title: complete ? 'Your PIN is ready' : 'Part of your order is ready',
    message: 'Your ' + (service?.title || 'service') + ' order ' + order.reference + (complete ? ' is complete.' : ' is partly delivered.') + '\n\nDelivery details:\n' + customerText + '\n\nYou can also open the order details at any time to view this again.',
  });
  return NextResponse.json({ ok: true, complete, delivered: deliveredCount, expected, notified: !notifyError });
}
