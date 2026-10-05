import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fulfillOrder } from '@/lib/vtpass';

function diagnose(result: any, expectedAmount: number, expectedCurrency: string) {
  const gatewayStatus = String(result?.data?.status || '').toLowerCase();
  const returnedAmount = result?.data?.amount == null ? null : Number(result.data.amount) / 100;
  const requestedAmount = result?.data?.requested_amount == null ? null : Number(result.data.requested_amount) / 100;
  const returnedCurrency = String(result?.data?.currency || '').toUpperCase();
  const expected = expectedCurrency.toUpperCase();
  if (gatewayStatus !== 'success') return { code: gatewayStatus === 'pending' || gatewayStatus === 'ongoing' ? 'payment_pending' : gatewayStatus === 'abandoned' ? 'payment_abandoned' : 'payment_not_successful', cause: gatewayStatus ? `Paystack returned transaction status: ${gatewayStatus}.` : 'Paystack did not return a successful transaction status.', gatewayStatus, returnedAmount, requestedAmount, returnedCurrency, gatewayResponse: result?.data?.gateway_response || null };
  if (requestedAmount !== null && requestedAmount !== expectedAmount) return { code: 'amount_mismatch', cause: `Paystack reports a requested amount of ₦${requestedAmount}, but PCR expected ₦${expectedAmount}.`, gatewayStatus, returnedAmount, requestedAmount, returnedCurrency, gatewayResponse: result?.data?.gateway_response || null };
  if (returnedAmount !== null && returnedAmount < expectedAmount) return { code: 'amount_mismatch', cause: `Underpayment: expected at least ₦${expectedAmount}, Paystack charged ₦${returnedAmount}.`, gatewayStatus, returnedAmount, requestedAmount, returnedCurrency, gatewayResponse: result?.data?.gateway_response || null };
  if (requestedAmount === null && returnedAmount !== expectedAmount) return { code: 'amount_mismatch', cause: `Paystack returned ₦${returnedAmount ?? 'unknown'}, but PCR expected ₦${expectedAmount}.`, gatewayStatus, returnedAmount, requestedAmount, returnedCurrency, gatewayResponse: result?.data?.gateway_response || null };
  if (returnedCurrency !== expected) return { code: 'currency_mismatch', cause: `Paystack returned ${returnedCurrency || 'unknown'}, but PCR expected ${expected}.`, gatewayStatus, returnedAmount, requestedAmount, returnedCurrency, gatewayResponse: result?.data?.gateway_response || null };
  return { code: 'verified', cause: requestedAmount !== null && returnedAmount !== null && returnedAmount !== expectedAmount ? `Paystack confirmed the ₦${expectedAmount} transaction. The customer was charged ₦${returnedAmount}, including Paystack's transaction fee.` : 'Paystack confirmed a successful transaction with the expected amount and currency.', gatewayStatus, returnedAmount, requestedAmount, returnedCurrency, gatewayResponse: result?.data?.gateway_response || null };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const reference = String(body?.reference || '').trim();
    if (!reference || reference.length > 200) return NextResponse.json({ paid: false, message: 'Invalid payment reference.' }, { status: 400 });
    const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
    if (!secret) return NextResponse.json({ paid: false, message: 'Payment gateway is not configured.' }, { status: 500 });

    const admin = createAdminClient();
    const { data: payment, error: paymentError } = await admin.from('payments').select('id,order_id,amount,currency,reference,status,metadata').eq('reference', reference).maybeSingle();
    if (paymentError || !payment) return NextResponse.json({ paid: false, code: 'payment_not_found', message: 'Payment not found.' }, { status: 404 });

    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: orderOwner } = await admin.from('orders').select('customer_id').eq('id', payment.order_id).maybeSingle();
        if (orderOwner?.customer_id && orderOwner.customer_id !== user.id) return NextResponse.json({ paid: false, message: 'Payment not found.' }, { status: 404 });
      }
    } catch {}

    if (payment.status === 'paid') return NextResponse.json({ paid: true, code: 'already_paid', message: 'Payment verified successfully.' });

    const response = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), { headers: { Authorization: `Bearer ${secret}` }, cache: 'no-store' });
    let result: any;
    try { result = await response.json(); } catch { result = { status: false, message: 'Paystack returned an invalid response.' }; }

    if (!response.ok || !result?.status) {
      const diagnosis = { code: 'gateway_error', cause: result?.message || `Paystack verification returned HTTP ${response.status}.`, gatewayStatus: String(result?.data?.status || '').toLowerCase() || null, returnedAmount: result?.data?.amount == null ? null : Number(result.data.amount) / 100, requestedAmount: result?.data?.requested_amount == null ? null : Number(result.data.requested_amount) / 100, returnedCurrency: String(result?.data?.currency || '').toUpperCase() || null, gatewayResponse: result?.data?.gateway_response || null };
      await admin.from('payments').update({ gateway_response: diagnosis.cause, metadata: { ...(payment.metadata || {}), last_verification: diagnosis } }).eq('id', payment.id);
      return NextResponse.json({ paid: false, ...diagnosis, message: diagnosis.cause }, { status: 502 });
    }

    const diagnosis = diagnose(result, Number(payment.amount), String(payment.currency || 'NGN'));
    await admin.from('payments').update({ gateway_response: diagnosis.gatewayResponse || diagnosis.cause, metadata: { ...(payment.metadata || {}), last_verification: { ...diagnosis, reference } } }).eq('id', payment.id);
    if (diagnosis.code !== 'verified') return NextResponse.json({ paid: false, ...diagnosis, message: diagnosis.cause });

    const { data: claimedPayment, error: claimError } = await admin.from('payments').update({ status: 'paid', paid_at: result.data.paid_at || new Date().toISOString(), gateway_response: result.data.gateway_response || 'Successful', metadata: { ...(payment.metadata || {}), paystack: result.data, last_verification: diagnosis } }).eq('id', payment.id).eq('status', 'pending').select('id').maybeSingle();
    if (claimError) return NextResponse.json({ paid: false, code: 'database_error', message: 'Paystack confirmed the payment, but PCR could not record it.', cause: claimError.message }, { status: 500 });
    if (!claimedPayment) return NextResponse.json({ paid: true, code: 'already_paid', message: 'Payment verified successfully.' });

    const { error: orderUpdateError } = await admin.from('orders').update({ payment_status: 'paid', status: 'processing' }).eq('id', payment.order_id);
    if (orderUpdateError) return NextResponse.json({ paid: true, code: 'order_update_failed', message: 'Payment verified and recorded, but the order status could not be updated.', cause: orderUpdateError.message });

    const { data: orderOwner } = await admin.from('orders').select('customer_id,reference').eq('id', payment.order_id).maybeSingle();
    if (orderOwner?.customer_id) await admin.from('notifications').insert({ user_id: orderOwner.customer_id, title: 'Payment confirmed', message: 'Payment for order ' + orderOwner.reference + ' has been confirmed. Your order is now being processed.' });
    return NextResponse.json({ paid: true, code: 'verified', message: 'Payment verified successfully.' });
  } catch (error) {
    console.error('Paystack verification unexpected error:', error);
    return NextResponse.json({ paid: false, code: 'unexpected_error', message: 'Unexpected verification error.', cause: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
