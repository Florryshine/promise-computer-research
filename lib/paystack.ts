type PaystackTransactionResult = {
  status?: boolean;
  message?: string;
  data?: Record<string, any>;
};

export function diagnosePaystackVerification(
  result: PaystackTransactionResult,
  expectedAmount: number,
  expectedCurrency = 'NGN'
) {
  const gatewayStatus = String(result.data?.status || '').toLowerCase();
  const returnedAmount = result.data?.amount == null ? null : Number(result.data.amount) / 100;
  const returnedCurrency = String(result.data?.currency || expectedCurrency).toUpperCase();

  if (!result.status) {
    return {
      code: 'gateway_error',
      cause: result.message || 'Paystack rejected the verification request.',
      gatewayStatus,
      returnedAmount,
      returnedCurrency
    };
  }

  if (gatewayStatus !== 'success') {
    return {
      code: gatewayStatus === 'pending' || gatewayStatus === 'ongoing'
        ? 'payment_pending'
        : gatewayStatus === 'abandoned'
          ? 'payment_abandoned'
          : 'payment_not_successful',
      cause: gatewayStatus
        ? `Paystack reports the transaction status as "${gatewayStatus}".`
        : 'Paystack did not return a successful transaction status.',
      gatewayStatus,
      returnedAmount,
      returnedCurrency
    };
  }

  if (returnedAmount !== expectedAmount) {
    return {
      code: 'amount_mismatch',
      cause: `Paystack returned ₦${returnedAmount ?? 'unknown'}, but PCR expected ₦${expectedAmount}.`,
      gatewayStatus,
      returnedAmount,
      returnedCurrency
    };
  }

  if (returnedCurrency !== expectedCurrency.toUpperCase()) {
    return {
      code: 'currency_mismatch',
      cause: `Paystack returned currency ${returnedCurrency}, but PCR expected ${expectedCurrency.toUpperCase()}.`,
      gatewayStatus,
      returnedAmount,
      returnedCurrency
    };
  }

  return {
    code: 'verified',
    cause: 'Paystack reports a successful transaction with the expected amount and currency.',
    gatewayStatus,
    returnedAmount,
    returnedCurrency
  };
}

export async function verifyPaystackTransaction(reference: string, secret: string) {
  const response = await fetch(
    'https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference),
    {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store'
    }
  );

  let result: PaystackTransactionResult;
  try {
    result = await response.json();
  } catch {
    result = { status: false, message: 'Paystack returned an invalid response.' };
  }

  return { response, result };
}


/**
 * Amount check for Paystack data when the customer bears the Paystack fee.
 * requested_amount is the amount PCR requested; amount is the gross amount charged.
 * The requested amount must match the order and the customer must not underpay.
 */
export function checkPaystackAmount(data: Record<string, any> | undefined, expectedAmount: number) {
  const charged = data?.amount == null ? null : Number(data.amount) / 100;
  const requested = data?.requested_amount == null ? null : Number(data.requested_amount) / 100;
  if (charged === null) return { ok: false, cause: 'Paystack did not return a charged amount.' };
  const reference = requested ?? charged;
  if (reference !== expectedAmount) {
    return { ok: false, cause: `Amount mismatch: expected ₦${expectedAmount}, Paystack ${requested !== null ? 'requested' : 'returned'} ₦${reference}.` };
  }
  if (charged < expectedAmount) {
    return { ok: false, cause: `Underpayment: expected at least ₦${expectedAmount}, Paystack charged ₦${charged}.` };
  }
  return { ok: true, cause: '' };
}
