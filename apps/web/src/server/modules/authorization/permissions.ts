/** Central permission catalogue. Admin staff are granted a subset (least privilege). */
export const PERMISSIONS = [
  "vendor.review",
  "vendor.suspend",
  "catalog.moderate",
  "category.manage",
  "order.read_all",
  "payment.reconcile",
  "refund.approve",
  "payout.approve",
  "user.suspend",
  "user.read",
  "settings.manage",
  "audit.read",
  "report.read",
  "knowledge.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export const isPermission = (p: string): p is Permission => (PERMISSIONS as readonly string[]).includes(p);
