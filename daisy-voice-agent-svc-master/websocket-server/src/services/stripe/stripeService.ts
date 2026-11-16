import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import Stripe from 'stripe';
import config from '../../config';
import { SOURCE } from '../../constants/source';
import { SessionType } from '../../dtos/enum/SessionType';
import {
  CreateInvoiceItemParams,
  CreateInvoiceParams,
  UpdateInvoiceParams,
} from '../../dtos/Payment';
import { StripeRefundParams } from '../../dtos/refund/RefundDto';
import { StripeError } from '../../errors/StripeError';
import { PaymentMetadata } from '../../types/payment';
import { PlatformFeeType } from '../../types/platformFee';
import { roundCurrency } from '../../utils/helper';
import logger from '../../utils/logger';
import {
  IPaymentProviderService,
  PaymentLinkParams,
  PaymentLinkResponse,
} from '../payment/IPaymentProviderService';
dayjs.extend(utc);
dayjs.extend(timezone);

export interface StripeServiceConfig {
  STRIPE_SECRET_KEY: string;
}

export class StripeService implements IPaymentProviderService {
  private stripe: Stripe;

  constructor(config: StripeServiceConfig) {
    if (!config.STRIPE_SECRET_KEY) {
      throw new Error(
        'STRIPE_SECRET_KEY is not defined in environment variables',
      );
    }
    this.stripe = new Stripe(config.STRIPE_SECRET_KEY);
  }

  /**
   * Creates a payment link for a reservation
   * @param params Payment link parameters
   * @returns Payment link URL
   */
  /**
   * Creates a payment intent for direct charging
   * @param params Payment intent parameters
   * @returns Payment intent
   */
  async createPaymentIntent(params: {
    amount: number;
    currency: string;
    description: string;
    customer_id: string;
    metadata?: PaymentMetadata;
    connectedAccountId?: string;
  }): Promise<Stripe.Response<Stripe.PaymentIntent>> {
    try {
      let {
        amount,
        currency,
        description,
        customer_id,
        metadata,
        connectedAccountId,
      } = params;
      amount = roundCurrency(amount);

      const requestOptions: Stripe.RequestOptions | undefined =
        connectedAccountId ? { stripeAccount: connectedAccountId } : undefined;
      const customer = await this.stripe.customers.retrieve(
        customer_id,
        requestOptions,
      );
      if (customer.deleted) {
        throw new StripeError(
          `Customer with ID ${customer_id} does not exist.`,
        );
      }
      const defaultPaymentMethod =
        customer.invoice_settings.default_payment_method;
      if (!defaultPaymentMethod) {
        throw new StripeError(
          `Customer with ID ${customer_id} does not have a default payment method.`,
        );
      }
      const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
        amount: Math.round(Number(amount) * 100), // Convert to cents
        currency,
        description,
        customer: customer_id,
        metadata: (metadata as unknown as Stripe.MetadataParam) || {},
        confirm: true,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never',
        },
        off_session: true,
        payment_method: defaultPaymentMethod as string,
      };

      return await this.stripe.paymentIntents.create(
        paymentIntentParams,
        requestOptions,
      );
    } catch (error) {
      logger.error('Error creating payment intent:', error);
      throw new StripeError(
        `Failed to create payment intent: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async createPaymentLink(
    params: PaymentLinkParams,
  ): Promise<PaymentLinkResponse> {
    try {
      let { amount, currency, description, metadata, connectedAccountId } =
        params;
      amount = roundCurrency(amount);
      const {
        check_in,
        check_out,
        num_adults,
        num_children,
        email,
        reservation_type,
      } = metadata;
      metadata.source = SOURCE;
      const numNights = dayjs(check_out).diff(dayjs(check_in), 'day');
      // Zero-deposit card collection: tell the success page no deposit was charged.
      const successUrl = `${config.SECURE_URL}/booking/success${amount === 0 ? '?initial-deposit=false' : ''}`;
      let redirectUrl = '';
      if ([SessionType.WEB].includes(reservation_type)) {
        if (metadata?.hotel_url) {
          const baseUrl = metadata.hotel_url.replace(/\/+$/, '');
          const queryParams = new URLSearchParams({
            check_in: String(check_in ?? ''),
            check_out: String(check_out ?? ''),
            num_adults: String(num_adults ?? ''),
            num_children: String(num_children ?? ''),
            num_nights: String(numNights ?? ''),
            email: String(email ?? ''),
          });
          redirectUrl = `${baseUrl}/booking-confirm/?${queryParams.toString()}`;
        } else {
          redirectUrl = successUrl;
          logger.error(
            `createPaymentLink: Hotel URL is not set for hotel ${metadata?.hotel_id || ''}. Redirecting to success page.`,
          );
        }
      } else {
        redirectUrl = successUrl;
      }

      let paymentLink: Stripe.Response<Stripe.PaymentLink>;
      const connectedAccountID = connectedAccountId;

      // If a connected account exists, create a payment link with the connected account.
      // The product and price will be created in the connected account.
      // The connected account will be the merchant of record.
      // An application fee, if enabled, will be applied to each payout from us to the connected account.
      if (connectedAccountID) {
        paymentLink = await this.createConnectedAccountPaymentLink({
          amount,
          currency,
          description,
          metadata,
          redirectUrl,
          platformFeeActive: metadata.platform_fee_active,
          platformFeeType: metadata.platform_fee_type,
          platformFeeValue: metadata.platform_fee_value,
          connectedAccountID,
        });
      } else {
        // If no connected account exists, we are the merchant of record.
        // We will create a product and price in our account.
        // Payouts should be handled manually
        paymentLink = await this.createPlatformAccountPaymentLink({
          amount,
          currency,
          description,
          metadata,
          redirectUrl,
        });
      }
      const response: PaymentLinkResponse = {
        url: paymentLink.url,
        id: paymentLink.id,
      };
      return response;
    } catch (error) {
      logger.error('Error creating payment link:', error);
      throw new StripeError(
        `Failed to create payment link: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Lists line items associated with a payment link
   * @param paymentLinkId The Payment Link ID
   */
  async listPaymentLinkLineItems(
    paymentLinkId: string,
    connectedAccountID?: string,
  ): Promise<Stripe.ApiList<Stripe.LineItem>> {
    try {
      if (connectedAccountID) {
        return await this.stripe.paymentLinks.listLineItems(paymentLinkId, {
          stripeAccount: connectedAccountID,
        });
      }
      return await this.stripe.paymentLinks.listLineItems(paymentLinkId);
    } catch (error) {
      logger.error('Error listing payment link line items:', error);
      throw new Error(
        `Failed to list payment link line items: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Deactivates a Stripe Price (sets active: false)
   */
  async deactivatePrice(
    priceId: string,
    connectedAccountID?: string,
  ): Promise<Stripe.Response<Stripe.Price>> {
    try {
      logger.info(`Deactivating price ${priceId}`);
      if (connectedAccountID) {
        return await this.stripe.prices.update(
          priceId,
          { active: false },
          { stripeAccount: connectedAccountID },
        );
      }
      return await this.stripe.prices.update(priceId, { active: false });
    } catch (error) {
      logger.error('Error deactivating price:', error);
      throw new Error(
        `Failed to deactivate price: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Deactivates a Stripe Product (sets active: false)
   */
  async deactivateProduct(
    productId: string,
    connectedAccountID?: string,
  ): Promise<Stripe.Response<Stripe.Product>> {
    try {
      logger.info(`Deactivating product ${productId}`);
      if (connectedAccountID) {
        return await this.stripe.products.update(
          productId,
          { active: false },
          { stripeAccount: connectedAccountID },
        );
      }
      return await this.stripe.products.update(productId, { active: false });
    } catch (error) {
      logger.error('Error deactivating product:', error);
      throw new Error(
        `Failed to deactivate product: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Deactivates a payment link and its associated price/product(s)
   * Safe to call multiple times.
   */
  async deactivatePaymentResources(
    paymentLinkId: string,
    connectedAccountID?: string,
  ): Promise<{
    paymentLinkId: string;
    priceIds: string[];
    productIds: string[];
    linkDisabled: boolean;
    errors: string[];
  }> {
    const priceIds: string[] = [];
    const productIds: string[] = [];
    const errors: string[] = [];
    let linkDisabled = false;

    // Disable the payment link first
    try {
      await this.disablePaymentLink(paymentLinkId, connectedAccountID);
      linkDisabled = true;
    } catch (error) {
      const msg = `Failed to disable payment link ${paymentLinkId}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      // Log and continue to attempt price/product deactivation
      logger.error(msg, error);
      errors.push(msg);
    }

    try {
      const lineItems = await this.listPaymentLinkLineItems(
        paymentLinkId,
        connectedAccountID,
      );
      for (const item of lineItems.data) {
        // Extract price id
        const priceRef: any = (item as any).price;
        const priceId: string | undefined =
          typeof priceRef === 'string' ? priceRef : priceRef?.id;
        if (!priceId) continue;

        // Retrieve price to find product id
        try {
          let price: Stripe.Response<Stripe.Price>;
          if (connectedAccountID) {
            price = await this.stripe.prices.retrieve(priceId, {
              stripeAccount: connectedAccountID,
            });
          } else {
            price = await this.stripe.prices.retrieve(priceId);
          }
          const productRef: any = price.product;
          const productId: string | undefined =
            typeof productRef === 'string' ? productRef : productRef?.id;

          // Deactivate price
          try {
            await this.deactivatePrice(priceId, connectedAccountID);
            priceIds.push(priceId);
          } catch (e) {
            const msg = `Failed to deactivate price ${priceId}: ${e instanceof Error ? e.message : 'Unknown error'}`;
            logger.error(msg, e);
            errors.push(msg);
          }

          // Deactivate product
          if (productId) {
            try {
              await this.deactivateProduct(productId, connectedAccountID);
              productIds.push(productId);
            } catch (e) {
              const msg = `Failed to deactivate product ${productId}: ${e instanceof Error ? e.message : 'Unknown error'}`;
              logger.error(msg, e);
              errors.push(msg);
            }
          }
        } catch (e) {
          const msg = `Failed to retrieve price ${priceId}: ${e instanceof Error ? e.message : 'Unknown error'}`;
          logger.error(msg, e);
          errors.push(msg);
        }
      }
    } catch (error) {
      const msg = `Error while deactivating resources for payment link ${paymentLinkId}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      logger.error(msg, error);
      errors.push(msg);
    }

    return { paymentLinkId, priceIds, productIds, linkDisabled, errors };
  }

  /**
   * Disables a payment link to prevent further usage
   * @param paymentLinkId The ID of the payment link to disable
   * @returns The updated payment link object
   */
  async disablePaymentLink(paymentLinkId: string, connectedAccountID?: string) {
    try {
      if (!paymentLinkId) {
        logger.error(
          'disablePaymentLink: Payment link ID is required to disable the payment link',
        );
        return;
      }
      logger.info(
        `disablePaymentLink: Disabling payment link ${paymentLinkId}`,
      );
      let paymentLink: Stripe.Response<Stripe.PaymentLink>;
      if (connectedAccountID) {
        paymentLink = await this.stripe.paymentLinks.update(
          paymentLinkId,
          {
            active: false,
          },
          {
            stripeAccount: connectedAccountID,
          },
        );
        logger.info(
          `disablePaymentLink: Payment link ${paymentLinkId} has been disabled for the connected account ${connectedAccountID}`,
        );
      } else {
        paymentLink = await this.stripe.paymentLinks.update(paymentLinkId, {
          active: false,
        });
        logger.info(
          `disablePaymentLink: Payment link ${paymentLinkId} has been disabled for the platform account`,
        );
      }

      return paymentLink;
    } catch (error) {
      logger.error(
        `disablePaymentLink: Error disabling payment link: ${JSON.stringify(error)}`,
      );
    }
  }

  /**
   * Verifies the webhook signature and constructs the event
   */
  constructWebhookEvent(
    payload: string | Buffer,
    signature: string,
    secret: string,
  ): Stripe.Event {
    return this.stripe.webhooks.constructEvent(payload, signature, secret);
  }

  /**
   * Creates a refund for a payment
   * @param params Refund parameters
   * @returns The created refund object
   */
  async createRefund(params: StripeRefundParams): Promise<Stripe.Refund> {
    try {
      const refundParams: Stripe.RefundCreateParams = {};

      if (params.chargeId) {
        refundParams.charge = params.chargeId;
      } else if (params.paymentIntentId) {
        refundParams.payment_intent = params.paymentIntentId;
      } else {
        throw new Error('Either chargeId or paymentIntentId must be provided');
      }

      if (params.amount !== undefined) {
        refundParams.amount = params.amount;
      }

      if (params.metadata) {
        params.metadata.source = SOURCE;
        refundParams.metadata = params.metadata;
      }

      if (params.connectedAccountId) {
        return await this.stripe.refunds.create(refundParams, {
          stripeAccount: params.connectedAccountId,
        });
      }

      return await this.stripe.refunds.create(refundParams);
    } catch (error) {
      logger.error('Error creating refund:', error);
      throw new StripeError(
        `Failed to create refund: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private async createConnectedAccountPaymentLink({
    amount,
    currency,
    description,
    metadata,
    redirectUrl,
    platformFeeActive,
    platformFeeType,
    platformFeeValue,
    connectedAccountID,
  }: {
    amount: number;
    currency: string;
    description: string;
    metadata: PaymentMetadata;
    redirectUrl: string;
    platformFeeActive: boolean | undefined;
    platformFeeType: PlatformFeeType | undefined;
    platformFeeValue: number | undefined;
    connectedAccountID: string;
  }): Promise<Stripe.Response<Stripe.PaymentLink>> {
    const product = await this.stripe.products.create(
      {
        name: 'Room Reservation',
        description: description,
      },
      {
        stripeAccount: connectedAccountID,
      },
    );
    const price = await this.stripe.prices.create(
      {
        product: product.id,
        unit_amount: Math.round(Number(amount) * 100),
        currency: currency,
      },
      {
        stripeAccount: connectedAccountID,
      },
    );
    const paymentLinkCreationParams: Stripe.PaymentLinkCreateParams = {
      line_items: [
        {
          price: price.id,
          quantity: 1,
        },
      ],
      payment_intent_data: {
        metadata: metadata as unknown as Stripe.MetadataParam,
        setup_future_usage: 'off_session',
      },
      metadata: metadata as unknown as Stripe.MetadataParam,
      after_completion: {
        type: 'redirect',
        redirect: {
          url: redirectUrl,
        },
      },
      customer_creation: 'always',
    };
    if (platformFeeActive && platformFeeType && platformFeeValue) {
      if (platformFeeType === PlatformFeeType.FLAT) {
        paymentLinkCreationParams.application_fee_amount = Math.round(
          Number(platformFeeValue) * 100,
        );
      } else if (platformFeeType === PlatformFeeType.PERCENTAGE) {
        paymentLinkCreationParams.application_fee_amount =
          Math.round(Number(amount) * 100) * (platformFeeValue / 100);
      }
    }
    return this.stripe.paymentLinks.create(paymentLinkCreationParams, {
      stripeAccount: connectedAccountID,
    });
  }

  private async createPlatformAccountPaymentLink({
    amount,
    currency,
    description,
    metadata,
    redirectUrl,
  }: {
    amount: number;
    currency: string;
    description: string;
    metadata: PaymentMetadata;
    redirectUrl: string;
  }): Promise<Stripe.Response<Stripe.PaymentLink>> {
    const product = await this.stripe.products.create({
      name: 'Room Reservation',
      description: description,
    });
    const price = await this.stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(Number(amount) * 100),
      currency: currency,
    });
    const paymentLinkCreationParams: Stripe.PaymentLinkCreateParams = {
      line_items: [
        {
          price: price.id,
          quantity: 1,
        },
      ],
      payment_intent_data: {
        metadata: metadata as unknown as Stripe.MetadataParam,
        setup_future_usage: 'off_session',
      },
      metadata: metadata as unknown as Stripe.MetadataParam,
      after_completion: {
        type: 'redirect',
        redirect: {
          url: redirectUrl,
        },
      },
      customer_creation: 'always',
    };
    return this.stripe.paymentLinks.create(paymentLinkCreationParams);
  }

  /**
   * Creates an invoice with auto-finalization
   * @param params Invoice creation parameters
   * @returns Created invoice
   */
  async createInvoice(
    params: CreateInvoiceParams,
  ): Promise<Stripe.Response<Stripe.Invoice>> {
    try {
      const {
        customer_id,
        auto_finalize_at,
        description,
        currency,
        metadata,
        connectedAccountId: connectedAccountID,
      } = params;

      const invoiceParams: Stripe.InvoiceCreateParams = {
        customer: customer_id,
        collection_method: 'charge_automatically',
        auto_advance: true,
        description: description,
        currency: currency,
        metadata: metadata as unknown as Stripe.MetadataParam,
      };

      // Only set auto_finalize_at if it's in the future
      if (auto_finalize_at > Math.floor(Date.now() / 1000)) {
        invoiceParams.automatically_finalizes_at = auto_finalize_at;
      }

      if (connectedAccountID) {
        return await this.stripe.invoices.create(invoiceParams, {
          stripeAccount: connectedAccountID,
        });
      } else {
        return await this.stripe.invoices.create(invoiceParams);
      }
    } catch (error) {
      logger.error(
        'createInvoice: Error creating auto-finalize invoice:',
        error,
      );
      throw new StripeError(
        `Failed to create invoice: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Updates an existing invoice
   * @param invoiceId The ID of the invoice to update
   * @param params Invoice update parameters
   * @returns Updated invoice
   */
  async updateInvoice(
    invoiceId: string,
    params: UpdateInvoiceParams,
  ): Promise<Stripe.Response<Stripe.Invoice>> {
    try {
      logger.info(
        `Updating invoice ${invoiceId} with params: ${JSON.stringify(params)}`,
      );

      const invoiceParams: Stripe.InvoiceUpdateParams = {
        automatically_finalizes_at: params.auto_finalize_at,
        metadata: params.metadata as unknown as Stripe.MetadataParam,
        description: params.description,
        auto_advance: params.auto_advance,
      };
      if (params.connectedAccountId) {
        logger.info(
          `Updating invoice ${invoiceId} for connected account ${params.connectedAccountId}`,
        );
        const result = await this.stripe.invoices.update(
          invoiceId,
          invoiceParams,
          {
            stripeAccount: params.connectedAccountId,
          },
        );
        return result;
      } else {
        return await this.stripe.invoices.update(invoiceId, invoiceParams);
      }
    } catch (error) {
      logger.error('updateInvoice: Error updating invoice:', error);
      throw new StripeError(
        `Failed to update invoice: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Creates an invoice item
   * @param params Invoice item parameters
   * @returns Created invoice item
   */
  async createInvoiceItem(
    params: CreateInvoiceItemParams,
  ): Promise<Stripe.Response<Stripe.InvoiceItem>> {
    try {
      let {
        customer,
        invoice,
        amount,
        currency,
        description,
        connectedAccountId,
      } = params;
      amount = roundCurrency(amount);

      const invoiceItemParams: Stripe.InvoiceItemCreateParams = {
        customer,
        invoice,
        amount: Math.round(Number(amount) * 100), // Convert to cents
        currency,
        description,
      };

      if (connectedAccountId) {
        return await this.stripe.invoiceItems.create(invoiceItemParams, {
          stripeAccount: connectedAccountId,
        });
      } else {
        return await this.stripe.invoiceItems.create(invoiceItemParams);
      }
    } catch (error) {
      logger.error('createInvoiceItem: Error creating invoice item:', error);
      throw new StripeError(
        `Failed to create invoice item: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async getInvoiceByInvoiceId(
    invoiceId: string,
    connectedAccountID?: string,
  ): Promise<Stripe.Response<Stripe.Invoice>> {
    try {
      logger.info(`Retrieving invoice ${invoiceId}`);

      if (connectedAccountID) {
        return await this.stripe.invoices.retrieve(invoiceId, {
          stripeAccount: connectedAccountID,
        });
      } else {
        return await this.stripe.invoices.retrieve(invoiceId);
      }
    } catch (error) {
      logger.error('getInvoiceByInvoiceId: Error retrieving invoice:', error);
      throw new StripeError(
        `Failed to retrieve invoice: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async voidInvoice(
    invoiceId: string,
    connectedAccountId?: string,
  ): Promise<Stripe.Response<Stripe.Invoice>> {
    try {
      logger.info(`Voiding invoice ${invoiceId}`);
      return await this.stripe.invoices.voidInvoice(
        invoiceId,
        connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
      );
    } catch (error) {
      logger.error('voidInvoice: Error voiding invoice:', error);
      throw new StripeError(
        `Failed to void invoice: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async getPaymentIntentById(
    paymentIntentId: string,
    connectedAccountID?: string,
  ): Promise<Stripe.Response<Stripe.PaymentIntent>> {
    try {
      logger.info(`Retrieving payment intent ${paymentIntentId}`);

      if (connectedAccountID) {
        return await this.stripe.paymentIntents.retrieve(paymentIntentId, {
          stripeAccount: connectedAccountID,
        });
      } else {
        return await this.stripe.paymentIntents.retrieve(paymentIntentId);
      }
    } catch (error) {
      logger.error(
        'getPaymentIntentById: Error retrieving payment intent:',
        error,
      );
      throw new StripeError(
        `Failed to retrieve payment intent: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Updates the amount of an invoice item for a given invoice
   * Assumes the invoice has only one invoice item
   * @param invoiceId The invoice ID
   * @param amount The new amount in dollars (will be converted to cents)
   * @param currency The currency code (e.g., 'usd')
   * @param description Optional new description for the invoice item
   * @param connectedAccountID Optional connected account ID
   * @returns Updated invoice item
   */
  async updateInvoiceItemAmountByInvoiceId(
    invoiceId: string,
    amount: number,
    description?: string,
    connectedAccountID?: string,
  ): Promise<Stripe.Response<Stripe.InvoiceItem>> {
    try {
      logger.info(
        `Updating invoice item amount for invoice ${invoiceId} to ${roundCurrency(amount)}`,
      );

      // Retrieve the invoice to get its items
      const invoice = await this.getInvoiceByInvoiceId(
        invoiceId,
        connectedAccountID,
      );

      if (!invoice.lines || invoice.lines.data.length === 0) {
        throw new StripeError('Invoice has no line items');
      }

      // Get the first (and assumed only) invoice item
      const invoiceItemId = invoice.lines.data[0].id;

      const invoiceItemParams: Stripe.InvoiceItemUpdateParams = {
        amount: Math.round(Number(amount) * 100), // Convert to cents
      };

      if (description) {
        invoiceItemParams.description = description;
      }

      if (connectedAccountID) {
        return await this.stripe.invoiceItems.update(
          invoiceItemId,
          invoiceItemParams,
          {
            stripeAccount: connectedAccountID,
          },
        );
      } else {
        return await this.stripe.invoiceItems.update(
          invoiceItemId,
          invoiceItemParams,
        );
      }
    } catch (error) {
      logger.error(
        'updateInvoiceItemAmountByInvoiceId: Error updating invoice item amount:',
        error,
      );
      throw new StripeError(
        `Failed to update invoice item amount: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Retrieves a Stripe PaymentMethod by ID.
   * Used to obtain card brand and last-4 digits for mapping to a PMS card type.
   */
  async getPaymentMethodById(
    paymentMethodId: string,
    connectedAccountID?: string,
  ): Promise<Stripe.Response<Stripe.PaymentMethod>> {
    try {
      if (connectedAccountID) {
        return await this.stripe.paymentMethods.retrieve(paymentMethodId, {
          stripeAccount: connectedAccountID,
        });
      }
      return await this.stripe.paymentMethods.retrieve(paymentMethodId);
    } catch (error) {
      logger.error(
        'getPaymentMethodById: Error retrieving payment method:',
        error,
      );
      throw new StripeError(
        `Failed to retrieve payment method: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Creates a Checkout Session in setup mode for card-only capture (no charge).
   * Used by zero-deposit flow: guest enters card on Stripe-hosted page,
   * card is saved for future autocharge via Stripe invoices.
   *
   * Fires checkout.session.completed webhook on success; the underlying
   * SetupIntent is available via session.setup_intent to retrieve the
   * saved payment_method.
   */
  async createSetupCheckoutSession(params: {
    currency: string;
    metadata: PaymentMetadata;
    successUrl?: string;
    cancelUrl?: string;
    connectedAccountId?: string;
  }): Promise<PaymentLinkResponse> {
    try {
      const {
        currency,
        metadata,
        connectedAccountId: connectedAccountID,
      } = params;
      metadata.source = SOURCE;
      const successUrl =
        params.successUrl ||
        `${config.SECURE_URL}/booking/success?initial-deposit=false`;

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: 'setup',
        currency,
        success_url: successUrl,
        customer_creation: 'always',
        setup_intent_data: {
          metadata: metadata as unknown as Stripe.MetadataParam,
        },
        metadata: metadata as unknown as Stripe.MetadataParam,
      };

      let session: Stripe.Response<Stripe.Checkout.Session>;
      if (connectedAccountID) {
        session = await this.stripe.checkout.sessions.create(sessionParams, {
          stripeAccount: connectedAccountID,
        });
      } else {
        session = await this.stripe.checkout.sessions.create(sessionParams);
      }

      if (!session.url) {
        throw new StripeError(
          'Checkout session created but no URL was returned',
        );
      }

      return { url: session.url, id: session.id };
    } catch (error) {
      logger.error('Error creating setup checkout session:', error);
      throw new StripeError(
        `Failed to create setup checkout session: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Retrieves a SetupIntent by ID.
   * Used after checkout.session.completed to get the payment_method
   * saved during setup-mode checkout.
   */
  async getSetupIntent(
    setupIntentId: string,
    connectedAccountID?: string,
  ): Promise<Stripe.Response<Stripe.SetupIntent>> {
    try {
      if (connectedAccountID) {
        return await this.stripe.setupIntents.retrieve(setupIntentId, {
          stripeAccount: connectedAccountID,
        });
      }
      return await this.stripe.setupIntents.retrieve(setupIntentId);
    } catch (error) {
      logger.error('getSetupIntent: Error retrieving setup intent:', error);
      throw new StripeError(
        `Failed to retrieve setup intent: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async updateCustomerDefaultPaymentMethod(
    customerId: string,
    paymentMethodId: string,
    connectedAccountID?: string,
  ): Promise<Stripe.Response<Stripe.Customer>> {
    try {
      if (connectedAccountID) {
        return await this.stripe.customers.update(
          customerId,
          {
            invoice_settings: {
              default_payment_method: paymentMethodId,
            },
          },
          {
            stripeAccount: connectedAccountID,
          },
        );
      }

      return await this.stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });
    } catch (error) {
      logger.error(
        'updateCustomerDefaultPaymentMethod: Error updating customer default payment method:',
        error,
      );
      throw new StripeError(
        `Failed to update customer default payment method: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}

const stripeService = new StripeService(config);
export default stripeService;
