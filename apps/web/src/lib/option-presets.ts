/**
 * Platform-wide product option presets. Sellers pick from these instead of typing option names and values by hand, so
 * "Colour", "Size" and "Fit" mean the same thing on every product (and shoppers filter and compare them consistently).
 * Presets are suggestions: a seller can still add their own values or a fully custom option.
 * Shared by the seller form, the product page (swatches) and GET /api/v1/option-presets (mobile apps).
 */
export interface PresetValue { value: string; /** CSS colour, only for colour presets. */ hex?: string }
export interface OptionPreset {
  key: string;
  /** Option name stored on the product (shown to shoppers). */
  name: string;
  kind: "color" | "text";
  hint: string;
  values: PresetValue[];
}

const text = (...values: string[]): PresetValue[] => values.map((value) => ({ value }));

export const OPTION_PRESETS: OptionPreset[] = [
  {
    key: "colour", name: "Colour", kind: "color", hint: "Shoppers see these as colour swatches.",
    values: [
      { value: "Black", hex: "#111111" }, { value: "White", hex: "#FFFFFF" }, { value: "Grey", hex: "#9CA3AF" }, { value: "Charcoal", hex: "#374151" },
      { value: "Navy", hex: "#1E3A5F" }, { value: "Blue", hex: "#2563EB" }, { value: "Sky Blue", hex: "#7DD3FC" }, { value: "Teal", hex: "#0D9488" },
      { value: "Green", hex: "#16A34A" }, { value: "Olive", hex: "#6B7A2F" }, { value: "Yellow", hex: "#FACC15" }, { value: "Orange", hex: "#F97316" },
      { value: "Red", hex: "#DC2626" }, { value: "Maroon", hex: "#7F1D1D" }, { value: "Pink", hex: "#EC4899" }, { value: "Purple", hex: "#7C3AED" },
      { value: "Beige", hex: "#E8DCC4" }, { value: "Brown", hex: "#78350F" }, { value: "Cream", hex: "#FFF7E0" }, { value: "Gold", hex: "#CA8A04" }, { value: "Silver", hex: "#C0C0C0" },
    ],
  },
  { key: "size", name: "Size", kind: "text", hint: "Clothing sizes.", values: text("XS", "S", "M", "L", "XL", "XXL", "3XL", "Free size") },
  { key: "kids-size", name: "Age", kind: "text", hint: "Children's clothing by age.", values: text("0-3 months", "3-6 months", "6-12 months", "1-2 years", "2-3 years", "3-4 years", "4-5 years", "5-6 years", "6-7 years", "7-8 years", "9-10 years", "11-12 years") },
  { key: "shoe-size", name: "Shoe size", kind: "text", hint: "EU shoe sizes.", values: text("36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46") },
  { key: "waist", name: "Waist", kind: "text", hint: "Trousers and jeans, in inches.", values: text("28", "30", "32", "34", "36", "38", "40", "42") },
  { key: "length", name: "Length", kind: "text", hint: "Trousers and dresses.", values: text("Short", "Regular", "Long") },
  { key: "fit", name: "Fit", kind: "text", hint: "How the garment is cut.", values: text("Slim", "Regular", "Relaxed", "Oversized", "Tapered", "Straight") },
  { key: "sleeve", name: "Sleeve", kind: "text", hint: "Shirts and tops.", values: text("Short sleeve", "Long sleeve", "Sleeveless", "3/4 sleeve") },
  { key: "material", name: "Material", kind: "text", hint: "Main fabric or material.", values: text("Cotton", "Linen", "Polyester", "Denim", "Wool", "Silk", "Leather", "Canvas", "Stainless steel", "Ceramic", "Wood", "Plastic") },
  { key: "pattern", name: "Pattern", kind: "text", hint: "Print or pattern.", values: text("Solid", "Striped", "Checked", "Printed", "Floral", "Embroidered") },
  { key: "storage", name: "Storage", kind: "text", hint: "Phones, drives and cards.", values: text("32GB", "64GB", "128GB", "256GB", "512GB", "1TB", "2TB") },
  { key: "ram", name: "RAM", kind: "text", hint: "Memory size.", values: text("4GB", "8GB", "16GB", "32GB", "64GB") },
  { key: "pack", name: "Pack size", kind: "text", hint: "How many in one order.", values: text("1 pack", "2 pack", "3 pack", "4 pack", "6 pack", "12 pack") },
  { key: "weight", name: "Weight", kind: "text", hint: "Groceries and food.", values: text("250 g", "500 g", "1 kg", "2 kg", "5 kg", "10 kg") },
  { key: "volume", name: "Volume", kind: "text", hint: "Liquids and beauty.", values: text("50 ml", "100 ml", "250 ml", "500 ml", "1 L", "2 L", "5 L") },
  { key: "style", name: "Style", kind: "text", hint: "Model or style name.", values: [] },
];

const byName = new Map(OPTION_PRESETS.map((p) => [p.name.toLowerCase(), p]));
const COLOUR_HEX = new Map(OPTION_PRESETS.find((p) => p.key === "colour")!.values.map((v) => [v.value.toLowerCase(), v.hex!]));

export const presetByName = (name: string): OptionPreset | undefined => byName.get(name.trim().toLowerCase());

/** An option is a colour option if its name says so ("Colour", "Color", "Frame colour"...). */
export const isColourOption = (name: string): boolean => /colou?r/i.test(name);

/** Swatch colour for a colour value, if we know it (custom colour names fall back to a neutral chip in the UI). */
export const swatchFor = (optionName: string, value: string): string | undefined => (isColourOption(optionName) ? COLOUR_HEX.get(value.trim().toLowerCase()) : undefined);

/** Order a selection the way the preset lists it (custom values keep their order at the end). */
export function sortLikePreset(name: string, values: string[]): string[] {
  const order = presetByName(name)?.values.map((v) => v.value) ?? [];
  const rank = (v: string) => { const i = order.indexOf(v); return i === -1 ? order.length : i; };
  return [...values].sort((a, b) => rank(a) - rank(b));
}
