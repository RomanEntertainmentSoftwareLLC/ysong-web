export function billingDestination(raw: string, host: 'checkout.stripe.com' | 'billing.stripe.com'): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password || url.port) {
    throw new Error('Invalid Stripe destination.');
  }
  return url.href;
}
