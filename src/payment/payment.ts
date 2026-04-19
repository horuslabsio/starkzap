/**
 * Payment module — cross-chain, multi-token payment acceptance via Chainrails.
 *
 * Provides quote discovery, intent lifecycle management, bridge routing,
 * chain/balance queries, session-based payment flows, and merchant info.
 *
 * @example
 * ```ts
 * import { StarkZap } from "starkzap";
 *
 * const sdk = new StarkZap({
 *   network: "mainnet",
 *   payment: { apiKey: "cr_live_..." },
 * });
 *
 * const payment = sdk.payment();
 *
 * // Get quotes from all source chains
 * const quotes = await payment.getQuotes({
 *   destinationChain: "STARKNET",
 *   tokenOut: "0x053c91...",
 *   amount: "10",
 *   recipient: "0xabc...",
 * });
 *
 * // Create a payment intent
 * const intent = await payment.createIntent({
 *   sender: "0xsender...",
 *   amount: "10",
 *   tokenIn: "0xtokenIn...",
 *   amountSymbol: "USDC",
 *   source_chain: "BASE",
 *   destination_chain: "STARKNET",
 *   recipient: "0xrecipient...",
 *   refund_address: "0xsender...",
 *   metadata: { description: "Order #42", reference: "order-42" },
 * });
 * ```
 */

import { Chainrails, crapi } from "@chainrails/sdk";
import type { AsyncResult } from "@/payment/types";
import type {
  PaymentConfig,
  // Quotes
  GetQuoteFromBridgeInput,
  GetQuoteFromBridgeOutput,
  GetQuotesFromAllBridgesInput,
  GetQuotesFromAllBridgesOutput,
  GetBestQuoteInput,
  GetBestQuoteOutput,
  GetQuotesInput,
  GetQuotesOutput,
  GetSessionQuotesInput,
  GetSessionQuotesOutput,
  // Intents
  PaymentIntent,
  CreatePaymentIntentInput,
  CreateSessionIntentInput,
  ListPaymentIntentsInput,
  ListPaymentIntentsOutput,
  PaymentIntentStatus,
  TriggerProcessingOutput,
  // Router
  GetOptimalRouteInput,
  GetOptimalRouteOutput,
  GetSupportedBridgesInput,
  GetSupportedBridgesOutput,
  GetAllSupportedBridgesOutput,
  PaymentBridge,
  // Chains
  GetSupportedChainsInput,
  GetChainBalanceInput,
  PaymentModalHandle,
  PaymentModalInput,
  // Client
  PaymentClientInfo,
  // Ramp
  GetRampQuotesInput,
  GetRampQuotesOutput,
  GetRampSessionQuotesInput,
  GetRampSessionQuotesOutput,
  GetRampCountriesInput,
  GetRampCountriesOutput,
  GetRampCurrenciesInput,
  GetRampCurrenciesOutput,
  CreateRampOrderInput,
  CreateRampOrderOutput,
  CreateRampSessionOrderInput,
  CreateRampSessionOrderOutput,
  PaymentRampOrder,
  ListRampOrdersInput,
  ListRampOrdersOutput,
} from "@/payment/types";
import { Session } from "./session";

/**
 * Cross-chain payment module powered by Chainrails.
 *
 * Accept payments from any chain, any token (EVM + Starknet), with automatic
 * bridge routing, fee quoting, and intent-based settlement.
 */
export class Payment {
  private modalManagerPromise: Promise<{
    checkout: (input: PaymentModalInput) => PaymentModalHandle;
  }> | null = null;

  /** Stored session token from the most recent `createSession` call. */
  private currentSessionToken: string | null = null;
  session: Session;

  constructor(config: PaymentConfig) {
    // Only configure/reconfigure Chainrails if we have a valid API key.
    if (config.apiKey) {
      void Chainrails.config({
        api_key: config.apiKey,
        env: config.environment ?? "production",
      });
    }

    this.session = new Session(this);
  }

  getSessionToken(): string | null {
    return this.currentSessionToken;
  }

  setSessionToken(sessionToken: string): void {
    this.currentSessionToken = sessionToken;
  }

  private getModalManager(): Promise<{
    checkout: (input: PaymentModalInput) => PaymentModalHandle;
  }> {
    if (!this.modalManagerPromise) {
      this.modalManagerPromise = import("@/payment/checkout").then(
        ({ PaymentModalManager }) => new PaymentModalManager()
      );
    }

    return this.modalManagerPromise;
  }

  // ══════════════════════════════════════════════
  // Helper methods
  // ══════════════════════════════════════════════

  /**
   * Normalize Chainrails snake_case intent to camelCase PaymentIntent.
   */
  private normalizeIntent(result: {
    id: string;
    intent_address: string;
    intent_status: string;
    sender: string;
    recipient: string;
    token_in: string;
    amount_symbol: string;
    amount: string;
    source_chain: string;
    destination_chain: string;
    refund_address: string;
    metadata?: { description: string; reference: string };
    created_at?: string;
    expires_at?: string;
  }): PaymentIntent {
    return {
      id: result.id,
      intentAddress: result.intent_address,
      intentStatus: result.intent_status as PaymentIntent["intentStatus"],
      sender: result.sender,
      recipient: result.recipient,
      tokenIn: result.token_in,
      amountSymbol: result.amount_symbol,
      amount: result.amount,
      sourceChain: result.source_chain,
      destinationChain: result.destination_chain,
      refundAddress: result.refund_address,
      metadata: result.metadata,
      createdAt: result.created_at,
      expiresAt: result.expires_at,
    };
  }

  // ══════════════════════════════════════════════
  // Sessions / Auth
  // ══════════════════════════════════════════════

  /**
   * Create a payment session for a recipient.
   *
   * Sessions bind a recipient + token + amount so that payers
   * only need to choose a source chain & token.
   *
   * @returns Session token + amount (to be used in subsequent session calls).
   *
   * @example
   * ```ts
   * const session = await payment.session.create({
   *   recipient: "0xRecipient...",
   *   token: "USDC",
   *   destinationChain: "STARKNET",
   *   amount: "25.00",
   * });
   * // Use session.sessionToken for session-scoped calls
   * ```
   */

  /**
   * Create a platform-aware payment modal handle.
   *
   * Call `.pay()` on the returned object to open the modal and resolve with:
   * - `true` on successful payment
   * - `false` on cancel/close
   */
  checkout(input: PaymentModalInput): PaymentModalHandle {
    const handle: PaymentModalHandle = {
      sessionToken: input.sessionToken,
      pay: async () => {
        const modalManager = await this.getModalManager();
        return modalManager.checkout({ ...input }).pay();
      },
    };

    if (input.amount !== undefined) {
      handle.amount = input.amount;
    }

    return handle;
  }

  // ══════════════════════════════════════════════
  // Quotes
  // ══════════════════════════════════════════════

  /**
   * Get a quote from a specific bridge.
   */
  async getQuoteFromBridge(
    input: GetQuoteFromBridgeInput
  ): Promise<GetQuoteFromBridgeOutput> {
    return crapi.quotes.getFromSpecificBridge(input);
  }

  /**
   * Get quotes from all available bridges for a route.
   */
  async getQuotesFromAllBridges(
    input: GetQuotesFromAllBridgesInput
  ): Promise<GetQuotesFromAllBridgesOutput> {
    return crapi.quotes.getFromAllBridges({
      ...input,
      excludeBridges: input.excludeBridges ?? "",
    } as Parameters<typeof crapi.quotes.getFromAllBridges>[0]);
  }

  /**
   * Get the single best quote across all bridges for a route.
   */
  async getBestQuote(input: GetBestQuoteInput): Promise<GetBestQuoteOutput> {
    return crapi.quotes.getBestAcrossBridges(input);
  }

  /**
   * Get quotes from all possible source chains for a destination.
   *
   * This is the easiest way to discover every path a payer can use.
   */
  async getQuotes(input: GetQuotesInput): Promise<GetQuotesOutput> {
    return crapi.quotes.getAll(input);
  }

  /**
   * Get quotes for the current session (requires prior `createSession` call).
   */
  async getSessionQuotes(
    input: GetSessionQuotesInput
  ): Promise<GetSessionQuotesOutput> {
    return crapi.quotes.getAllForSession(input);
  }

  // ══════════════════════════════════════════════
  // Intents
  // ══════════════════════════════════════════════

  /**
   * Create a payment intent.
   *
   * An intent represents a concrete payment: sender deposits on the source
   * chain, and Chainrails settles the destination amount automatically.
   */
  async createIntent(input: CreatePaymentIntentInput): Promise<PaymentIntent> {
    // Convert camelCase input to snake_case for Chainrails API
    const snakeCaseInput = {
      sender: input.sender,
      amount: input.amount,
      tokenIn: input.tokenIn,
      amountSymbol: input.amountSymbol as
        | "USDC"
        | "USDT"
        | "DAI"
        | "BUSD"
        | "EURC"
        | "ETH"
        | "WETH"
        | "STRK"
        | "BNB"
        | "LORDS",
      source_chain: input.sourceChain,
      destination_chain: input.destinationChain,
      recipient: input.recipient,
      refund_address: input.refundAddress,
      metadata: input.metadata,
    };

    // Call Chainrails API with snake_case
    const result = await crapi.intents.create(snakeCaseInput);

    // Convert snake_case response to camelCase
    return {
      id: result.id,
      intentAddress: result.intent_address,
      intentStatus: result.intent_status,
      sender: result.sender,
      recipient: result.recipient,
      tokenIn: result.token_in,
      amountSymbol: result.amount_symbol,
      amount: result.amount,
      sourceChain: result.source_chain,
      destinationChain: result.destination_chain,
      refundAddress: result.refund_address,
      metadata: result.metadata,
      createdAt: result.created_at,
      expiresAt: result.expires_at,
    };
  }

  /**
   * Create a session-based payment intent.
   */
  async createSessionIntent(
    input: CreateSessionIntentInput
  ): Promise<PaymentIntent> {
    const result = await crapi.intents.createForSession(input);
    return this.normalizeIntent(result);
  }

  /**
   * Get a payment intent by its ID.
   */
  async getIntent(id: string): Promise<PaymentIntent> {
    const result = await crapi.intents.getById(id);
    return this.normalizeIntent(result);
  }

  /**
   * Get a payment intent by its on-chain address.
   */
  async getIntentByAddress(address: `0x${string}`): Promise<PaymentIntent> {
    const result = await crapi.intents.getForAddress(address);
    return this.normalizeIntent(result);
  }

  /**
   * Get all intents for a sender address.
   */
  async getIntentsForSender(sender: `0x${string}`): Promise<PaymentIntent[]> {
    const results = await crapi.intents.getForSender(sender);
    return results.map(this.normalizeIntent);
  }

  /**
   * List all intents with pagination and optional status filter.
   */
  async listIntents(
    input?: ListPaymentIntentsInput
  ): Promise<ListPaymentIntentsOutput> {
    const result = await crapi.intents.getAll(input ?? {});
    // Normalize intents in the response
    if (result.intents) {
      result.intents = result.intents.map(this.normalizeIntent);
    }
    return result;
  }

  /**
   * Get all intents for the current session.
   */
  async getSessionIntents(address: `0x${string}`): Promise<PaymentIntent[]> {
    const results = await crapi.intents.getForSession(address);
    return results.map(this.normalizeIntent);
  }

  /**
   * Update the status of a payment intent.
   */
  async updateIntentStatus(
    id: string,
    status: PaymentIntentStatus
  ): Promise<PaymentIntent> {
    const result = await crapi.intents.update(id, { status });
    return this.normalizeIntent(result);
  }

  /**
   * Trigger processing (relay / settlement) of a funded intent.
   */
  async triggerProcessing(
    intentAddress: `0x${string}`
  ): Promise<TriggerProcessingOutput> {
    return crapi.intents.triggerProcessing(intentAddress);
  }

  /**
   * Trigger processing for a session-based intent.
   */
  async triggerSessionProcessing(
    intentAddress: `0x${string}`
  ): Promise<TriggerProcessingOutput> {
    return crapi.intents.triggerProcessingForSession(intentAddress);
  }

  // ══════════════════════════════════════════════
  // Router
  // ══════════════════════════════════════════════

  /**
   * Find the optimal cross-chain route (bridge + fees).
   */
  async getOptimalRoute(
    input: GetOptimalRouteInput
  ): Promise<GetOptimalRouteOutput> {
    return crapi.router.getOptimalRoutes(input);
  }

  /**
   * Get all bridge protocols supported by Chainrails.
   */
  async getAllSupportedBridges(): Promise<GetAllSupportedBridgesOutput> {
    return crapi.router.getAllSupportedBridges();
  }

  /**
   * Get bridges available for a specific source → destination route.
   */
  async getSupportedBridges(
    input: GetSupportedBridgesInput
  ): Promise<GetSupportedBridgesOutput> {
    return crapi.router.getSupportedBridges(input);
  }

  /**
   * Get all routes supported by a specific bridge.
   */
  async getSupportedRoutes(
    bridge: PaymentBridge
  ): Promise<GetOptimalRouteInput[]> {
    return crapi.router.getSupportedRoutes(bridge);
  }

  // ══════════════════════════════════════════════
  // Chains
  // ══════════════════════════════════════════════

  /**
   * Get chains supported for payments.
   */
  async getSupportedChains(input?: GetSupportedChainsInput): Promise<string[]> {
    return crapi.chains.getSupported(input);
  }

  /**
   * Get token balances for an address across chains.
   */
  async getBalance(input: GetChainBalanceInput): Promise<string> {
    return crapi.chains.getBalance(input);
  }

  // ══════════════════════════════════════════════
  // Client / Merchant Info
  // ══════════════════════════════════════════════

  /**
   * Get merchant/client account information.
   */
  async getClientInfo(): Promise<PaymentClientInfo> {
    return crapi.client.getClientInfo();
  }

  /**
   * Get client info for the current session.
   */
  async getSessionClientInfo(): Promise<PaymentClientInfo> {
    return crapi.client.getClientInfoForSession();
  }

  // ══════════════════════════════════════════════
  // Ramp / Fiat Onramp
  // ══════════════════════════════════════════════

  /**
   * Get aggregated fiat-to-crypto quotes from all eligible providers.
   *
   * @example
   * ```ts
   * const quotes = await payment.ramp.getQuotes({
   *   fiatCurrency: "USD",
   *   cryptoAmount: 100,
   *   destinationChain: "STARKNET",
   * });
   * ```
   */
  async getRampQuotes(input: GetRampQuotesInput): Promise<GetRampQuotesOutput> {
    return crapi.ramp.getQuotes(input);
  }

  /**
   * Get ramp quotes for a session.
   */
  async getRampSessionQuotes(
    input: GetRampSessionQuotesInput
  ): Promise<GetRampSessionQuotesOutput> {
    return crapi.ramp.getQuotesForSession(input);
  }

  /**
   * Get all supported countries with currency details.
   */
  async getRampCountries(
    input?: GetRampCountriesInput
  ): Promise<GetRampCountriesOutput> {
    return crapi.ramp.getCountries(input);
  }

  /**
   * Get ramp countries for a session.
   */
  async getRampSessionCountries(
    input?: GetRampCountriesInput
  ): Promise<GetRampCountriesOutput> {
    return crapi.ramp.getCountriesForSession(input);
  }

  /**
   * Get a deduplicated list of supported fiat currencies.
   */
  async getRampCurrencies(
    input?: GetRampCurrenciesInput
  ): Promise<GetRampCurrenciesOutput> {
    return crapi.ramp.getCurrencies(input);
  }

  /**
   * Get ramp currencies for a session.
   */
  async getRampSessionCurrencies(
    input?: GetRampCurrenciesInput
  ): Promise<GetRampCurrenciesOutput> {
    return crapi.ramp.getCurrenciesForSession(input);
  }

  /**
   * Create a fiat-to-crypto order.
   * Returns a provider widget URL for the user to complete payment.
   */
  async createRampOrder(
    input: CreateRampOrderInput
  ): Promise<CreateRampOrderOutput> {
    return crapi.ramp.createOrder(input);
  }

  /**
   * Create a ramp order for a session.
   */
  async createRampSessionOrder(
    input: CreateRampSessionOrderInput
  ): Promise<CreateRampSessionOrderOutput> {
    return crapi.ramp.createOrderForSession(input);
  }

  /**
   * Get a ramp order by ID.
   */
  async getRampOrder(id: string): Promise<PaymentRampOrder> {
    return crapi.ramp.getOrder(id);
  }

  /**
   * Get a ramp order by ID for a session.
   */
  async getRampSessionOrder(id: string): Promise<PaymentRampOrder> {
    return crapi.ramp.getOrderForSession(id);
  }

  /**
   * Get a ramp order by intent address.
   */
  async getRampOrderByIntent(
    intentAddress: string
  ): Promise<AsyncResult<typeof crapi.ramp.getOrderByIntent>> {
    return crapi.ramp.getOrderByIntent(intentAddress);
  }

  /**
   * List all ramp orders (newest first).
   */
  async listRampOrders(
    input?: ListRampOrdersInput
  ): Promise<ListRampOrdersOutput> {
    return crapi.ramp.listOrders(input);
  }

  /**
   * Confirm a ramp order after the user completes the deposit action.
   */
  async confirmRampOrder(
    id: string
  ): Promise<AsyncResult<typeof crapi.ramp.confirmOrder>> {
    return crapi.ramp.confirmOrder(id);
  }

  /**
   * Confirm a ramp order for a session.
   */
  async confirmRampSessionOrder(
    id: string
  ): Promise<AsyncResult<typeof crapi.ramp.confirmOrderForSession>> {
    return crapi.ramp.confirmOrderForSession(id);
  }

  /**
   * Cancel a ramp order if it's still in a cancellable state.
   */
  async cancelRampOrder(
    id: string
  ): Promise<AsyncResult<typeof crapi.ramp.cancelOrder>> {
    return crapi.ramp.cancelOrder(id);
  }
}
