import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fulfillOrder } from '@/lib/vtpass';
import { checkPaystackAmount } from '@/lib/paystack';

export async function POST(request: Request) {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
    if (!secret) return new NextResponse('Gateway not configured', { status: 500 });

    const raw = await request.text();
    const signature = request.headers.get('x-paystack-signature') || '';
    const expected = crypto.createHmac('sha512', secret).update(raw).digest('hex');

    if (
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return new NextResponse('Invalid signature', { status: 401 });
    }

    const event = JSON.parse(raw);
    if (event.event !== 'charge.success') return NextResponse.json({ received: true });

    const data = event.data;
    const reference = String(data?.reference || '').trim();
    if (!reference || reference.length > 200) return NextResponse.json({ received: true });

    const supabase = createAdminClient();
    const { data: payment } = await supabase
      .from('payments')
      .select('id,order_id,amount,status')
      .eq('reference', reference)
      .maybeSingle();

    if (!payment) return NextResponse.json({ received: true });

    // A duplicate webhook must not re-send an already fulfilled VTU purchase.
    // If payment was marked paid by the browser callback, the callback handles fulfillment.
    if (payment.status === 'paid') return NextResponse.json({ received: true });

    const currency = String(data.currency || 'NGN').toUpperCase();
    const amountCheck = checkPaystackAmount(data, Number(payment.amount));

    if (!amountCheck.ok || currency !== 'NGN') {
      console.error('Paystack webhook rejected:', amountCheck.cause || `currency ${currency}`);
      return new NextResponse('Amount or currency mismatch', { status: 400 });
    }

    const { data: claimedPayment, error: claimError } = await supabase
      .from('payments')
      .update({
        status: 'paid',
        paid_at: data.paid_at || new Date().toISOString(),
        gateway_response: data.gateway_response || 'Successful',
        metadata: data
      })
      .eq('id', payment.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (claimError) return new NextResponse('Could not record payment', { status: 500 });
    if (!claimedPayment) return NextResponse.json({ received: true });

    const { error: orderUpdateError } = await supabase.from('orders').update({
      payment_status: 'paid',
      status: 'processing'
    }).eq('id', payment.order_id);
    if (orderUpdateError) console.error('Webhook order update failed:', orderUpdateError.message);

    try {
      await fulfillOrder(payment.order_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown fulfillment error';
      console.error('Nifex fulfillment failed:', message);
      // Keep the payment recorded as paid, but never leave the order silently stuck in processing.
      const { error: fulfillmentUpdateError } = await supabase.from('orders').update({
        status: 'needs_information',
        admin_note: 'Payment received, but automatic Nifex fulfillment encountered an unexpected error: ' + message.slice(0, 500)
      }).eq('id', payment.order_id);
      if (fulfillmentUpdateError) {
        console.error('Could not record Nifex fulfillment error on order:', fulfillmentUpdateError.message);
      }
    }

    const { data: orderOwner } = await supabase
      .from('orders')
      .select('customer_id,reference')
      .eq('id', payment.order_id)
      .maybeSingle();

    if (orderOwner?.customer_id) {
      await supabase.from('notifications').insert({
        user_id: orderOwner.customer_id,
        title: 'Payment confirmed',
        message: 'Payment for order ' + orderOwner.reference + ' has been confirmed. Your order is now being processed.'
      });
    }

    return NextResponse.json({ received: true });
  } catch {
    return new NextResponse('Invalid webhook payload', { status: 400 });
  }
}
