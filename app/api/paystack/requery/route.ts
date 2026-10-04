import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fulfillOrder } from '@/lib/vtpass';

function diagnose(result: any, expectedAmount: number, expectedCurrency: string) {
  const status = String(result?.data?.status || '').toLowerCase();
  const amount = result?.data?.amount == null ? null : Number(result.data.amount) / 100;
  const currency = String(result?.data?.currency || '').toUpperCase();
  const expected = expectedCurrency.toUpperCase();
  if (status !== 'success') return { code: status === 'pending' || status === 'ongoing' ? 'payment_pending' : 'payment_not_successful', cause: status ? `Paystack returned transaction status: ${status}.` : 'Paystack did not return a successful transaction status.', gatewayStatus: status, returnedAmount: amount, returnedCurrency: currency, gatewayResponse: result?.data?.gateway_response || null };
  if (amount !== expectedAmount) return { code: 'amount_mismatch', cause: `Paystack returned ₦${amount ?? 'unknown'}, but PCR expected ₦${expectedAmount}.`, gatewayStatus: status, returnedAmount: amount, returnedCurrency: currency, gatewayResponse: result?.data?.gateway_response || null };
  if (currency !== expected) return { code: 'currency_mismatch', cause: `Paystack returned ${currency || 'unknown'}, but PCR expected ${expected}.`, gatewayStatus: status, returnedAmount: amount, returnedCurrency: currency, gatewayResponse: result?.data?.gateway_response || null };
  return { code: 'verified', cause: 'Paystack confirmed a successful transaction with the expected amount and currency.', gatewayStatus: status, returnedAmount: amount, returnedCurrency: currency, gatewayResponse: result?.data?.gateway_response || null };
}

export async function POST(request: Request) {
  try {
    const { orderId } = await request.json();
    if (!orderId) return NextResponse.json({ ok: false, code: 'invalid_request', message: 'Invalid order.' }, { status: 400 });
    const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
    if (!secret) return NextResponse.json({ ok: false, code: 'gateway_not_configured', message: 'Payment gateway is not configured.' }, { status: 500 });

    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, code: 'unauthorized', message: 'Please log in.' }, { status: 401 });

    const admin = createAdminClient();
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    const isAdmin = profile?.role === 'admin';
    const { data: order } = await admin.from('orders').select('id,customer_id,reference,amount,payment_status,status').eq('id', orderId).maybeSingle();
    if (!order || (!isAdmin && order.customer_id !== user.id)) return NextResponse.json({ ok: false, code: 'not_found', message: 'Order not found.' }, { status: 404 });

    const { data: payment } = await admin.from('payments').select('id,order_id,reference,amount,currency,status,gateway_response,metadata').eq('order_id', order.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!payment) return NextResponse.json({ ok: false, code: 'payment_not_found', message: 'No Paystack payment record exists for this order.' }, { status: 404 });
    if (payment.status === 'paid') return NextResponse.json({ ok: true, code: 'already_paid', message: 'Payment is already recorded as paid.' });

    const response = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(payment.reference), { headers: { Authorization: `Bearer ${secret}` }, cache: 'no-store' });
    let result: any;
    try { result = await response.json(); } catch { result = { status: false, message: 'Invalid response from Paystack.' }; }

    if (!response.ok || !result?.status) {
      const diagnosis = { code: 'gateway_error', cause: result?.message || `Paystack verification returned HTTP ${response.status}.`, gatewayStatus: String(result?.data?.status || '').toLowerCase() || null, returnedAmount: result?.data?.amount == null ? null : Number(result.data.amount) / 100, returnedCurrency: String(result?.data?.currency || '').toUpperCase() || null, gatewayResponse: result?.data?.gateway_response || null };
      await admin.from('payments').update({ gateway_response: diagnosis.cause, metadata: { ...(payment.metadata || {}), last_requery: diagnosis } }).eq('id', payment.id);
      return NextResponse.json({ ok: false, ...diagnosis, message: diagnosis.cause });
    }

    const diagnosis = diagnose(result, Number(payment.amount), String(payment.currency || 'NGN'));
    await admin.from('payments').update({ gateway_response: diagnosis.gatewayResponse || diagnosis.cause, metadata: { ...(payment.metadata || {}), last_requery: { ...diagnosis, reference: payment.reference } } }).eq('id', payment.id);

    if (diagnosis.code !== 'verified') {
      console.error('Paystack requery diagnosis', { orderId: order.id, paymentId: payment.id, reference: payment.reference, diagnosis });
      return NextResponse.json({ ok: false, ...diagnosis, message: diagnosis.cause });
    }

    const { data: claimedPayment, error: claimError } = await admin.from('payments').update({ status: 'paid', paid_at: result.data?.paid_at || new Date().toISOString(), gateway_response: result.data?.gateway_response || 'Successful', metadata: { ...(payment.metadata || {}), paystack: result.data, last_requery: diagnosis } }).eq('id', payment.id).eq('status', 'pending').select('id').maybeSingle();
    if (claimError) return NextResponse.json({ ok: false, code: 'database_error', message: 'Paystack confirmed the payment, but PCR could not record it.', cause: claimError.message }, { status: 500 });
    if (!claimedPayment) return NextResponse.json({ ok: true, code: 'already_paid', message: 'Payment was confirmed by another process.' });

    const { error: orderError } = await admin.from('orders').update({ payment_status: 'paid', status: 'processing' }).eq('id', order.id);
    if (orderError) return NextResponse.json({ ok: true, code: 'order_update_failed', message: 'Payment verified and recorded, but the order status could not be updated.', cause: orderError.message });

    try { await fulfillOrder(order.id); } catch (error) { console.error('VTpass fulfillment failed after requery:', error); }
    if (order.customer_id) await admin.from('notifications').insert({ user_id: order.customer_id, title: 'Payment confirmed', message: 'Payment for order ' + order.reference + ' has been confirmed. Your order is now being processed.' });

    return NextResponse.json({ ok: true, code: 'verified', message: 'Payment verified and order processing started.', diagnosis });
  } catch (error) {
    console.error('Paystack requery unexpected error:', error);
    return NextResponse.json({ ok: false, code: 'unexpected_error', message: 'Could not re-query the payment right now.', cause: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
