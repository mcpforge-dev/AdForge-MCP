export type CheckoutRequest = {
  workspaceId: string;
  orderId: string;
  amount: string;
  currency: string;
  returnUrl: string;
};

export type CheckoutResponse = {
  provider: string;
  checkoutUrl: string;
  providerOrderRef: string;
};

export interface PaymentProvider {
  readonly id: string;
  createCheckout(input: CheckoutRequest): Promise<CheckoutResponse>;
  verifyWebhook(
    rawBody: string,
    signature: string | undefined,
  ): Promise<unknown>;
}
