import PaymentCallbackClient from './PaymentCallbackClient';

export default async function PaymentCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  const params = await searchParams;
  return <PaymentCallbackClient reference={params.reference ?? ''} />;
}
