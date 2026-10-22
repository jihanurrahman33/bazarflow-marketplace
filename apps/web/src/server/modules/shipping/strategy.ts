import type { VendorDoc } from "@/server/db/schema";

export interface ShippingInput {
  vendor: Pick<VendorDoc, "shipping">;
  subtotalMinor: number;
  district: string;
}

/** Strategy boundary: swap in zone/weight/carrier-based pricing without touching checkout. */
export interface ShippingStrategy {
  quote(input: ShippingInput): number;
}

/** Vendor-configured flat fee, waived above an optional free-shipping threshold. */
export const flatRateStrategy: ShippingStrategy = {
  quote({ vendor, subtotalMinor }) {
    const { flatFeeMinor, freeOverMinor } = vendor.shipping;
    return freeOverMinor != null && subtotalMinor >= freeOverMinor ? 0 : flatFeeMinor;
  },
};

let strategy: ShippingStrategy = flatRateStrategy;
export const getShippingStrategy = (): ShippingStrategy => strategy;
export const setShippingStrategy = (s: ShippingStrategy): void => {
  strategy = s;
};
