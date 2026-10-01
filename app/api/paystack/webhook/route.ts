import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fulfillOrder } from '@/lib/vtpass';

export async function POST(request: Request) {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
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
    const reference = String(data?.reference || '');
    if (!reference) return NextResponse.json({ received: true });

    const supabase = createAdminClient();
    const { data: payment } = await supabase
      .from('payments')
      .select('id,order_id,amount,status')
      .eq('reference', reference)
      .maybeSingle();

    if (!payment) return NextResponse.json({ received: true });

    const paidAmount = Number(data.amount || 0) / 100;
    const currency = String(data.currency || 'NGN').toUpperCase();

    if (paidAmount !== Number(payment.amount) || currency !== 'NGN') {
      return new NextResponse('Amount or currency mismatch', { status: 400 });
    }

    await supabase.from('payments').update({
      status: 'paid',
      paid_at: data.paid_at || new Date().toISOString(),
      gateway_response: data.gateway_response || 'Successful',
      metadata: data
    }).eq('id', payment.id);

    await supabase.from('orders').update({
      payment_status: 'paid',
      status: 'processing'
    }).eq('id', payment.order_id);

    // Fulfill supported VTpass orders automatically after confirmed payment.
    // Failure here does not roll back the verified payment; the provider transaction is recorded for review.
    try { await fulfillOrder(payment.order_id); } catch (error) { console.error('VTpass fulfillment failed:', error); }
    const {data:orderOwner}=await supabase.from('orders').select('customer_id,reference').eq('id',payment.order_id).maybeSingle();
    if(orderOwner?.customer_id){
      await supabase.from('notifications').insert({
        user_id: orderOwner.customer_id,
        title: 'Payment confirmed',
        message: 'Payment for order '+orderOwner.reference+' has been confirmed. Your order is now being processed.'
      });
    }

    return NextResponse.json({ received: true });
  } catch {
    return new NextResponse('Invalid webhook payload', { status: 400 });
  }
}
