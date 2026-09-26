import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  try {
    const { reference } = await request.json();
    if (!reference) return NextResponse.json({ paid: false, message: 'Missing payment reference.' }, { status: 400 });

    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return NextResponse.json({ paid: false, message: 'Payment gateway is not configured.' }, { status: 500 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ paid: false, message: 'Please log in.' }, { status: 401 });

    const { data: payment } = await supabase
      .from('payments')
      .select('id,order_id,amount,reference,status,orders!inner(customer_id)')
      .eq('reference', String(reference))
      .maybeSingle();

    if (!payment || (payment as any).orders?.customer_id !== user.id) {
      return NextResponse.json({ paid: false, message: 'Payment not found.' }, { status: 404 });
    }

    const response = await fetch(
      'https://api.paystack.co/transaction/verify/' + encodeURIComponent(String(reference)),
      { headers: { Authorization: `Bearer ${secret}` } }
    );
    const result = await response.json();

    if (!response.ok || !result.status) {
      return NextResponse.json({
        paid: false,
        message: result.message || 'Verification failed.'
      }, { status: 502 });
    }

    const paid =
      result.data?.status === 'success' &&
      Number(result.data?.amount) / 100 === Number(payment.amount) &&
      String(result.data?.currency || 'NGN').toUpperCase() === 'NGN';

    if (paid) {
      const admin = createAdminClient();
      await admin.from('payments').update({
        status: 'paid',
        paid_at: result.data.paid_at || new Date().toISOString(),
        gateway_response: result.data.gateway_response || 'Successful',
        metadata: result.data
      }).eq('id', payment.id);

      await admin.from('orders').update({
        payment_status: 'paid',
        status: 'processing'
      }).eq('id', payment.order_id);
    }

    return NextResponse.json({
      paid,
      message: paid
        ? 'Payment verified successfully.'
        : 'Payment was not successful or the amount did not match.'
    });
  } catch {
    return NextResponse.json({ paid: false, message: 'Unexpected verification error.' }, { status: 500 });
  }
}
