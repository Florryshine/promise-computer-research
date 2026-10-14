import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const allowed = ['pending', 'processing', 'needs_information', 'completed', 'cancelled'];
  if (!allowed.includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  if (!body.orderId || typeof body.orderId !== 'string') return NextResponse.json({ error: 'Order ID is required.' }, { status: 400 });

  const isQuote = body.quoteAmount !== undefined && body.quoteAmount !== null && String(body.quoteAmount).trim() !== '';
  const quoteAmount = isQuote ? Number(body.quoteAmount) : null;
  if (isQuote && (!Number.isFinite(quoteAmount) || quoteAmount! <= 0 || quoteAmount! > 100000000)) {
    return NextResponse.json({ error: 'Enter a valid quote greater than ₦0.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: order, error: loadError } = await admin.from('orders')
    .select('id,customer_id,status,admin_note,reference,amount,payment_status')
    .eq('id', body.orderId).maybeSingle();
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  if (isQuote) {
    if (order.payment_status === 'paid') return NextResponse.json({ error: 'A paid order cannot be requoted.' }, { status: 409 });
    if (order.payment_status === 'pending') return NextResponse.json({ error: 'A payment is already in progress. Verify or resolve that payment before changing the quote.' }, { status: 409 });
    const { data: pendingPayment, error: paymentLookupError } = await admin.from('payments')
      .select('reference').eq('order_id', order.id).eq('status', 'pending').limit(1).maybeSingle();
    if (paymentLookupError) return NextResponse.json({ error: paymentLookupError.message }, { status: 500 });
    if (pendingPayment) return NextResponse.json({ error: 'A payment is already in progress. Verify or resolve that payment before changing the quote.' }, { status: 409 });
  }

  const note = String(body.adminNote || '').slice(0, 2000);
  const updates: Record<string, unknown> = { status: body.status, admin_note: note };
  if (isQuote) {
    updates.amount = quoteAmount;
    updates.payment_status = 'unpaid';
  }

  const { error: updateError } = await admin.from('orders').update(updates).eq('id', body.orderId);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  const noteChanged = (order.admin_note || '') !== note;
  const statusChanged = order.status !== body.status;
  const quoteChanged = isQuote && Number(order.amount || 0) !== quoteAmount;
  if (isQuote && (quoteChanged || noteChanged)) {
    const quoteNote = note ? ' Note: ' + note : '';
    const { error: notificationError } = await admin.from('notifications').insert({
      user_id: order.customer_id,
      title: 'Your service quote is ready',
      message: 'A quote of ₦' + Number(quoteAmount).toLocaleString('en-NG') + ' is ready for order ' + order.reference + '. Open My Orders to review and pay.' + quoteNote
    });
    if (notificationError) return NextResponse.json({ error: 'Quote saved, but customer notification failed: ' + notificationError.message }, { status: 500 });
  } else if (statusChanged || noteChanged) {
    const title = body.status === 'completed' ? 'Order completed' : body.status === 'cancelled' ? 'Order cancelled' : 'Order updated';
    const message = note ? 'Order ' + order.reference + ': ' + note : 'Order ' + order.reference + ' status is now ' + String(body.status).replace('_', ' ') + '.';
    await admin.from('notifications').insert({ user_id: order.customer_id, title, message });
  }
  return NextResponse.json({ ok: true, quoted: Boolean(isQuote), amount: isQuote ? quoteAmount : Number(order.amount || 0) });
}
