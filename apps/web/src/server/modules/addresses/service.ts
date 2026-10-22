import { ObjectId } from "mongodb";
import { getCollections } from "@/server/db/collections";
import type { AddressDoc } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { newId } from "@/server/shared/ids";

const MAX_ADDRESSES = 10;

export interface AddressInput {
  label: string;
  recipient: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  district: string;
  postalCode: string;
  isDefault?: boolean;
}

export const toAddressDto = (a: AddressDoc) => ({
  id: a._id.toHexString(), label: a.label, recipient: a.recipient, phone: a.phone, line1: a.line1, line2: a.line2,
  city: a.city, district: a.district, postalCode: a.postalCode, country: a.country, isDefault: a.isDefault,
});

export async function listAddresses(userId: ObjectId) {
  const c = await getCollections();
  const rows = await c.addresses.find({ userId }).sort({ isDefault: -1, createdAt: -1 }).limit(MAX_ADDRESSES).toArray();
  return rows.map(toAddressDto);
}

export async function createAddress(userId: ObjectId, input: AddressInput) {
  const c = await getCollections();
  if ((await c.addresses.countDocuments({ userId })) >= MAX_ADDRESSES) {
    throw new AppError("BUSINESS_RULE_VIOLATION", { message: `You can save up to ${MAX_ADDRESSES} addresses.` });
  }
  const now = new Date();
  const first = (await c.addresses.countDocuments({ userId })) === 0;
  const isDefault = first || !!input.isDefault;
  if (isDefault) await c.addresses.updateMany({ userId, isDefault: true }, { $set: { isDefault: false } });
  const doc: AddressDoc = { _id: newId(), userId, ...input, country: "BD", isDefault, createdAt: now, updatedAt: now };
  await c.addresses.insertOne(doc);
  return toAddressDto(doc);
}

export async function updateAddress(userId: ObjectId, id: ObjectId, patch: Partial<AddressInput>) {
  const c = await getCollections();
  if (patch.isDefault) await c.addresses.updateMany({ userId, isDefault: true, _id: { $ne: id } }, { $set: { isDefault: false } });
  // Ownership lives in the filter, so a foreign id is "not found".
  const res = await c.addresses.findOneAndUpdate({ _id: id, userId }, { $set: { ...patch, updatedAt: new Date() } }, { returnDocument: "after" });
  if (!res) throw new AppError("NOT_FOUND");
  return toAddressDto(res);
}

export async function deleteAddress(userId: ObjectId, id: ObjectId) {
  const c = await getCollections();
  const res = await c.addresses.findOneAndDelete({ _id: id, userId });
  if (!res) throw new AppError("NOT_FOUND");
  if (res.isDefault) {
    const next = await c.addresses.find({ userId }).sort({ createdAt: -1 }).limit(1).next();
    if (next) await c.addresses.updateOne({ _id: next._id }, { $set: { isDefault: true } });
  }
}

export async function getOwnedAddress(userId: ObjectId, id: ObjectId): Promise<AddressDoc> {
  const c = await getCollections();
  const a = await c.addresses.findOne({ _id: id, userId });
  if (!a) throw new AppError("NOT_FOUND", { message: "Address not found.", details: [{ field: "addressId", code: "NOT_FOUND" }] });
  return a;
}
