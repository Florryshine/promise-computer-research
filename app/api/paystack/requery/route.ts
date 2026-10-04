import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fulfillOrder } from '@/lib/vtpass';
import { diagnosePaystackVerification, verifyPaystackTransaction } from '@/lib/paystack';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orderId = String(body?.orderId || '').trim();
    if (!orderId || orderId.length > 100) {
      return NextResponse.json({ ok: false, code: 'invalid_request', message: 'Invalid order.' }, { status: 400 });
    }

    const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
    if (!secret) {
      return NextResponse.json({ ok: false, code: 'gateway_not_configured', message: 'Payment gateway is not configured.' }, { status: 500 });
    }

    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, code: 'unauthorized', message: 'Please log in.' }, { status: 401 });

    const { data: profile } = await client.from('profiles').select('role').eq('id', user.id).maybeSingle();
    const isAdmin = profile?.role === 'admin';

    const admin = createAdminClient();
    const { data: order, error: orderError } = await admin
      .from('orders')
      .select('id,customer_id,reference,amount,payment_status,status')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError || !order) {
      return NextResponse.json({ ok: false, code: 'not_found', message: 'Order not found.' }, { status: 404 });
    }
    if (!isAdmin && order.customer_id !== user.id) {
      return NextResponse.json({ ok: false, code: 'not_found', message: 'Order not found.' }, { status: 404 });
    }

    const { data: payment, error: paymentError } = await admin
      .from('payments')
      .select('id,order_id,reference,amount,currency,status,gateway_response,metadata')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (paymentError || !payment) {
      return NextResponse.json({
        ok: false,
        code: 'payment_not_found',
        message: 'No Paystack payment record exists for this order.'
      }, { status: 404 });
    }

    if (payment.status === 'paid') {
      return NextResponse.json({
        ok: true,
        code: 'already_paid',
        message: 'Payment is already recorded as paid.',
        gatewayStatus: 'success'
      });
    }

    const { result } = await verifyPaystackTransaction(payment.reference, secret);
    const diagnosis = diagnosePaystackVerification(
      result,
      Number(payment.amount),
      String(payment.currency || 'NGN')
    );

    await admin.from('payments').update({
      gateway_response: result.data?.gateway_response || result.message || diagnosis.cause,
      metadata: {
        ...(payment.metadata || {}),
        last_requery: result.data || { message: result.message || null, status: result.status }
      }
    }).eq('id', payment.id);

    if (diagnosis.code === 'verified') {
      const { data: claimedPayment, error: claimError } = await admin
        .from('payments')
        .update({
          status: 'paid',
          paid_at: result.data?.paid_at || new Date().toISOString(),
          gateway_response: result.data?.gateway_response || 'Successful',
          metadata: result.data || {}
        })
        .eq('id', payment.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();

      if (claimError) {
        return NextResponse.json({
          ok: false,
          code: 'database_error',
          message: 'Paystack confirmed the payment, but PCR could not record it.',
          cause: claimError.message
        }, { status: 500 });
      }

      if (!claimedPayment) {
        return NextResponse.json({ ok: true, code: 'already_paid', message: 'Payment was confirmed by another payment process.' });
      }

      const { error: orderUpdateError } = await admin.from('orders').update({
        payment_status: 'paid',
        status: 'processing'
      }).eq('id', order.id);

      if (orderUpdateError) {
        console.error('Paystack requery order update failed', { orderId: order.id, error: orderUpdateError.message });
        return NextResponse.json({
          ok: true,
          code: 'payment_recorded_order_update_failed',
          message: 'Payment verified and recorded, but the order status could not be updated.',
          diagnosis
        });
      }

      try {
        await fulfillOrder(order.id);
      } catch (error) {
        console.error('Paystack requery fulfillment failed:', error);
      }

      await admin.from('notifications').insert({
        user_id: order.customer_id,
        title: 'Payment confirmed',
        message: 'Payment for order ' + order.reference + ' has been confirmed. Your order is now being processed.'
      });

      return NextResponse.json({
        ok: true,
        code: 'verified',
        message: 'Payment verified and order processing started.',
        diagnosis
      });
    }

    const publicMessage = diagnosis.code === 'payment_pending'
      ? 'Paystack still shows this payment as pending. Try re-querying again shortly.'
      : diagnosis.code === 'amount_mismatch' || diagnosis.code === 'currency_mismatch'
        ? diagnosis.cause
        : diagnosis.cause;

    console.error('Paystack requery diagnosis', {
      orderId: order.id,
      paymentId: payment.id,
      reference: payment.reference,
      diagnosis,
      gatewayResponse: result.data?.gateway_response || null,
      paystackReference: result.data?.reference || null
    });

    return NextResponse.json({
      ok: false,
      code: diagnosis.code,
      message: publicMessage,
      diagnosis: isAdmin ? diagnosis : {
        code: diagnosis.code,
        cause: diagnosis.cause,
        gatewayStatus: diagnosis.gatewayStatus,
        returnedAmount: diagnosis.returnedAmount,
        returnedCurrency: diagnosis.returnedCurrency
      }
    });
  } catch (error) {
    console.error('Paystack requery unexpected error:', error);
    return NextResponse.json({
      ok: false,
      code: 'unexpected_error',
      message: 'Could not re-query the payment right now.',
      cause: error instanceof Error ? error.message : 'Unknown server error'
    }, { status: 500 });
  }
}
