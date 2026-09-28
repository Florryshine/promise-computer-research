import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const PAYSTACK_URL = 'https://api.paystack.co';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orderId = String(body.orderId || '');
    if (!orderId) return NextResponse.json({ error: 'Order ID is required.' }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'You must be logged in.' }, { status: 401 });
    if (!user.email) return NextResponse.json({ error: 'Your account does not have an email address.' }, { status: 400 });

    const { data: order, error } = await supabase
      .from('orders')
      .select('id,reference,amount,payment_status,status,customer_id')
      .eq('id', orderId)
      .eq('customer_id', user.id)
      .maybeSingle();

    if (error || !order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

    const amount = Number(order.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'This service does not have a fixed price yet. Please wait for a quote.' }, { status: 400 });
    }
    if (order.payment_status === 'paid') {
      return NextResponse.json({ error: 'This order is already paid.' }, { status: 409 });
    }

    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return NextResponse.json({ error: 'Payment gateway is not configured.' }, { status: 500 });

    const admin = createAdminClient();
    const { data: existing } = await admin
      .from('payments')
      .select('reference,status')
      .eq('order_id', order.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing?.reference) {
      const verify = await fetch(
        PAYSTACK_URL + '/transaction/verify/' + encodeURIComponent(existing.reference),
        { headers: { Authorization: `Bearer ${secret}` } }
      );

      if (verify.ok) {
        const result = await verify.json();
        if (
          result?.data?.status === 'success' &&
          Number(result?.data?.amount) / 100 === amount &&
          String(result?.data?.currency || 'NGN').toUpperCase() === 'NGN'
        ) {
          await admin.from('payments').update({
            status: 'paid',
            paid_at: result.data.paid_at || new Date().toISOString(),
            gateway_response: result.data.gateway_response || 'Successful',
            metadata: result.data
          }).eq('reference', existing.reference);

          await admin.from('orders').update({
            payment_status: 'paid',
            status: 'processing'
          }).eq('id', order.id);

          return NextResponse.json({
            authorization_url: null,
            reference: existing.reference,
            alreadyPaid: true
          });
        }
      }

      return NextResponse.json({
        error: 'A payment is already in progress. Please continue with the existing payment.'
      }, { status: 409 });
    }

    const reference = `${order.reference}-${Date.now()}`;

    const { error: paymentInsertError } = await admin.from('payments').insert({
      order_id: order.id,
      reference,
      provider: 'paystack',
      amount,
      currency: 'NGN',
      status: 'pending'
    });

    if (paymentInsertError) {
      const { data: pending } = await admin
        .from('payments')
        .select('reference')
        .eq('order_id', order.id)
        .eq('status', 'pending')
        .maybeSingle();

      if (pending?.reference) {
        return NextResponse.json({
          error: 'A payment is already being prepared. Please try again in a moment.'
        }, { status: 409 });
      }

      return NextResponse.json({ error: paymentInsertError.message || 'Could not prepare the payment.' }, { status: 500 });
    }

    const origin = new URL(request.url).origin;
    const init = await fetch(PAYSTACK_URL + '/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: user.email,
        amount: Math.round(amount * 100),
        reference,
        callback_url: `${origin}/payment/callback`,
        metadata: { order_id: order.id, customer_id: user.id }
      })
    });

    const result = await init.json();

    if (!init.ok || !result.status || !result.data?.authorization_url) {
      await admin.from('payments').update({
        status: 'failed',
        gateway_response: result.message || 'Could not initialize payment.',
        metadata: result.data || {}
      }).eq('reference', reference);

      return NextResponse.json({
        error: result.message || 'Could not initialize payment.'
      }, { status: 502 });
    }

    await admin.from('payments').update({
      metadata: result.data
    }).eq('reference', reference);

    await admin.from('orders').update({
      payment_status: 'pending'
    }).eq('id', order.id);

    return NextResponse.json({
      authorization_url: result.data.authorization_url,
      reference
    });
  } catch {
    return NextResponse.json({ error: 'Unexpected payment error.' }, { status: 500 });
  }
}
