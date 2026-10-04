import PaymentCallbackClient from './PaymentCallbackClient';

export default async function PaymentCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string; trxref?: string }>;
}) {
  const params = await searchParams;
  const reference = params.reference ?? params.trxref ?? '';
  return <PaymentCallbackClient reference={reference} />;
}