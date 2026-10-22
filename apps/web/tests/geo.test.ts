import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { makeCustomer } from "./helpers/factory";
import { createAddressHandler, updateAddressHandler } from "@/server/api/handlers/shopping";
import { canonicalDistrict, DISTRICTS, DIVISIONS } from "@/lib/bd-geo";

beforeAll(async () => { await setupTestDb(); });
afterAll(teardownTestDb);

const address = (district: string) => ({ label: "Home", recipient: "Rahim Uddin", phone: "+8801712345678", line1: "House 5, Road 3", city: "Agrabad", district, postalCode: "4100" });

describe("Bangladesh districts", () => {
  it("lists 8 divisions and 64 distinct districts", () => {
    expect(Object.keys(DIVISIONS)).toHaveLength(8);
    expect(DISTRICTS).toHaveLength(64);
    expect(new Set(DISTRICTS).size).toBe(64);
  });
  it("recognises official names, older spellings and sloppy typing", () => {
    expect(canonicalDistrict("Chattogram")).toBe("Chattogram");
    expect(canonicalDistrict("chittagong")).toBe("Chattogram");
    expect(canonicalDistrict("  COMILLA ")).toBe("Cumilla");
    expect(canonicalDistrict("Cox's Bazar")).toBe("Cox's Bazar");
    expect(canonicalDistrict("coxs bazar")).toBe("Cox's Bazar");
    expect(canonicalDistrict("Jessore")).toBe("Jashore");
    expect(canonicalDistrict("Atlantis")).toBeUndefined();
    expect(canonicalDistrict("")).toBeUndefined();
  });
  it("stores the official name and refuses anything that is not a district", async () => {
    const me = await makeCustomer();
    const ok = await call(createAddressHandler, { method: "POST", token: me.token, body: address("chittagong") });
    expect(ok.status).toBe(201);
    expect(ok.data.district).toBe("Chattogram");
    const bad = await call(createAddressHandler, { method: "POST", token: me.token, body: address("Atlantis") });
    expect(bad.status).toBe(400);
    expect(bad.error?.details.some((d) => d.field === "district")).toBe(true);
    const upd = await call(updateAddressHandler, { method: "PATCH", token: me.token, params: { id: ok.data.id }, body: { district: "Sylhet" } });
    expect(upd.data.district).toBe("Sylhet");
    expect((await call(updateAddressHandler, { method: "PATCH", token: me.token, params: { id: ok.data.id }, body: { district: "Narnia" } })).status).toBe(400);
  });
});
