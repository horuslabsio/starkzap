import { crapi } from "@chainrails/sdk";
import type { CreatePaymentSessionInput } from "./types";
import type { Payment } from "./payment";

export class Session {
  parent: Payment;
  constructor(paymentModule: Payment) {
    this.parent = paymentModule;
  }

  async create(input: CreatePaymentSessionInput): Promise<Payment> {
    const result = await crapi.auth.getSessionToken(input);
    this.parent.setSessionToken(result.sessionToken);
    return this.parent;
  }
}
