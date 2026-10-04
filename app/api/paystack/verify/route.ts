import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fulfillOrder } from '@/lib/vtpass';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const reference = String(body?.reference || '').trim();
    if (!reference || reference.length > 200) {
      return NextResponse.json({ paid: false, message: 'Invalid payment reference.' }, { status: 400 });
    }

    const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
    if (!secret) {
      return NextResponse.json({ paid: false, message: 'Payment gateway is not configured.' }, { status: 500 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ paid: false, message: 'Please log in to view this payment.' }, { status: 401 });
    }

    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('id,order_id,amount,reference,status,orders!inner(customer_id)')
      .eq('reference', reference)
      .maybeSingle();

    if (paymentError || !payment || (payment as any).orders?.customer_id !== user.id) {
      return NextResponse.json({ paid: false, message: 'Payment not found.' }, { status: 404 });
    }

    // Webhook and callback verification can legitimately arrive at the same time.
    // Once our database has recorded this payment as paid, do not fulfill it again.
    if (payment.status === 'paid') {
      return NextResponse.json({
        paid: true,
        message: 'Payment verified successfully.'
      });
    }

    const response = await fetch(
      'https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference),
      {
        headers: { Authorization: `Bearer ${secret}` },
        cache: 'no-store'
      }
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

    if (!paid) {
      // Keep the customer-facing message generic, but expose the exact
      // verification mismatch in server logs so payment issues can be
      // diagnosed without leaking gateway data to the browser.
      console.error('Paystack verification mismatch', {
        reference,
        paymentId: payment.id,
        orderId: payment.order_id,
        expectedAmount: Number(payment.amount),
        returnedAmount: result.data?.amount ?? null,
        returnedAmountNaira: result.data?.amount != null
          ? Number(result.data.amount) / 100
          : null,
        returnedCurrency: result.data?.currency ?? null,
        returnedStatus: result.data?.status ?? null,
        gatewayResponse: result.data?.gateway_response ?? null,
        paystackReference: result.data?.reference ?? null
      });

      return NextResponse.json({
        paid: false,
        message: 'Payment was not successful or the amount did not match.'
      });
    }

    const admin = createAdminClient();

    // Claim the payment atomically: only a payment that is still pending may
    // transition to paid. This prevents callback/webhook races from fulfilling twice.
    const { data: claimedPayment, error: claimError } = await admin
      .from('payments')
      .update({
        status: 'paid',
        paid_at: result.data.paid_at || new Date().toISOString(),
        gateway_response: result.data.gateway_response || 'Successful',
        metadata: result.data
      })
      .eq('id', payment.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (claimError) {
      return NextResponse.json({ paid: false, message: 'Could not record the payment.' }, { status: 500 });
    }

    // Another trusted Paystack path may have won the race.
    if (!claimedPayment) {
      return NextResponse.json({
        paid: true,
        message: 'Payment verified successfully.'
      });
    }

    const { error: orderUpdateError } = await admin.from('orders').update({
      payment_status: 'paid',
      status: 'processing'
    }).eq('id', payment.order_id);

    if (orderUpdateError) {
      console.error('Paystack payment recorded but order update failed', {
        paymentId: payment.id,
        orderId: payment.order_id,
        error: orderUpdateError.message
      });
      return NextResponse.json({
        paid: true,
        message: 'Payment verified, but the order status could not be updated automatically.'
      });
    }

    try {
      await fulfillOrder(payment.order_id);
    } catch (error) {
      console.error('VTpass fulfillment failed:', error);
    }

    await admin.from('notifications').insert({
      user_id: user.id,
      title: 'Payment confirmed',
      message: 'Payment for your order has been confirmed. Your order is now being processed.'
    });

    return NextResponse.json({
      paid: true,
      message: 'Payment verified successfully.'
    });
  } catch {
    return NextResponse.json({
      paid: false,
      message: 'Unexpected verification error.'
    }, { status: 500 });
  }
}
