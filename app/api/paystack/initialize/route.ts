import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const PAYSTACK_URL = 'https://api.paystack.co';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orderId = String(body.orderId || '');
    if (!orderId) return NextResponse.json({ error: 'Order ID is required.' }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'You must be logged in.' }, { status: 401 });

    const { data: order, error } = await supabase
      .from('orders')
      .select('id,reference,amount,payment_status,status,customer_id,services(title)')
      .eq('id', orderId).eq('customer_id', user.id).maybeSingle();

    if (error || !order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    const amount = Number(order.amount);
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'This service does not have a fixed price yet. Please wait for a quote.' }, { status: 400 });
    if (order.payment_status === 'paid') return NextResponse.json({ error: 'This order is already paid.' }, { status: 409 });

    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return NextResponse.json({ error: 'Payment gateway is not configured.' }, { status: 500 });

    const { data: existing } = await supabase.from('payments').select('reference,status').eq('order_id', order.id).eq('status','pending').maybeSingle();
    if (existing?.reference) {
      const verify = await fetch(PAYSTACK_URL + '/transaction/verify/' + encodeURIComponent(existing.reference), { headers: { Authorization: `Bearer ${secret}` } });
      if (verify.ok) {
        const result = await verify.json();
        if (result?.data?.status === 'success') {
          await supabase.from('payments').update({ status:'paid', paid_at: result.data.paid_at || new Date().toISOString(), gateway_response: result.data.gateway_response || 'Successful' }).eq('reference', existing.reference);
          await supabase.from('orders').update({ payment_status:'paid', status:'processing' }).eq('id', order.id);
          return NextResponse.json({ authorization_url: null, reference: existing.reference, alreadyPaid: true });
        }
      }
      return NextResponse.json({ error: 'A payment is already in progress. Please continue with the existing payment.' }, { status: 409 });
    }

    const reference = `${order.reference}-${Date.now()}`;
    const origin = new URL(request.url).origin;
    const init = await fetch(PAYSTACK_URL + '/transaction/initialize', {
      method:'POST',
      headers:{ Authorization:`Bearer ${secret}`, 'Content-Type':'application/json' },
      body:JSON.stringify({
        email: user.email,
        amount: Math.round(amount * 100),
        reference,
        callback_url: `${origin}/payment/callback`,
        metadata:{ order_id: order.id, customer_id: user.id, service: Array.isArray(order.services) ? order.services[0]?.title : order.services?.title }
      })
    });
    const result = await init.json();
    if (!init.ok || !result.status) return NextResponse.json({ error: result.message || 'Could not initialize payment.' }, { status: 502 });

    const { error: paymentError } = await supabase.from('payments').insert({
      order_id: order.id, reference, provider:'paystack', amount, currency:'NGN', status:'pending',
      metadata: result.data || {}
    });
    if (paymentError) return NextResponse.json({ error: 'Payment was initialized but could not be recorded. Contact support before paying again.' }, { status: 500 });

    await supabase.from('orders').update({ payment_status:'pending' }).eq('id', order.id);
    return NextResponse.json({ authorization_url: result.data.authorization_url, reference });
  } catch {
    return NextResponse.json({ error: 'Unexpected payment error.' }, { status: 500 });
  }
}