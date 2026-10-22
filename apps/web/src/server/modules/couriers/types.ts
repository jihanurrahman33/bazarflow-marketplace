export interface CourierAddress {
  recipient: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  district: string;
  postalCode?: string;
}

export interface CourierParcelInput {
  orderNumber: string;
  recipient: CourierAddress;
  items: { title: string; quantity: number }[];
  /** Non-zero for Cash on Delivery (BDT minor units). 0 for prepaid online orders. */
  amountToCollectMinor: number;
  declaredValueMinor: number;
  weightGrams?: number;
}

export interface CourierParcelResult {
  carrier: string;
  trackingId: string;
  trackingUrl?: string;
  status: string;
  raw?: Record<string, unknown>;
}

export interface CourierTrackingEvent {
  messageEn: string;
  messageBn?: string;
  time: string;
}

export interface CourierTrackingResult {
  carrier: string;
  trackingId: string;
  status: string;
  events: CourierTrackingEvent[];
}

export interface CourierAdapter {
  readonly id: string;
  readonly name: string;
  createParcel(input: CourierParcelInput): Promise<CourierParcelResult>;
  trackParcel(trackingId: string): Promise<CourierTrackingResult>;
}
