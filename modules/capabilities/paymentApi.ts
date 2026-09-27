import { Capability } from "../../src/capabilities/capability.types";

/** Provider-neutral declaration; no payment provider is connected here. */
export const paymentApi: Capability = {
  id: "capability.payment-api",
  kind: "capability",
  name: "Payment Processing",
  inputs: [
    {
      name: "amount",
      type: "number",
      required: true,
    },
  ],
  outputs: [
    {
      name: "transaction",
      type: "payment_result",
    },
  ],
  operations: ["create_payment", "refund", "verify_payment"],
  verificationMethod: "provider confirms the transaction state",
  access: {
    requirement: "account",
  },
};
