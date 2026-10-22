/** Bangladesh's 8 divisions and 64 districts, in the spelling used by the government. Shared by the address form and the API. */
export const DIVISIONS: Record<string, string[]> = {
  Barishal: ["Barguna", "Barishal", "Bhola", "Jhalokati", "Patuakhali", "Pirojpur"],
  Chattogram: ["Bandarban", "Brahmanbaria", "Chandpur", "Chattogram", "Cox's Bazar", "Cumilla", "Feni", "Khagrachhari", "Lakshmipur", "Noakhali", "Rangamati"],
  Dhaka: ["Dhaka", "Faridpur", "Gazipur", "Gopalganj", "Kishoreganj", "Madaripur", "Manikganj", "Munshiganj", "Narayanganj", "Narsingdi", "Rajbari", "Shariatpur", "Tangail"],
  Khulna: ["Bagerhat", "Chuadanga", "Jashore", "Jhenaidah", "Khulna", "Kushtia", "Magura", "Meherpur", "Narail", "Satkhira"],
  Mymensingh: ["Jamalpur", "Mymensingh", "Netrokona", "Sherpur"],
  Rajshahi: ["Bogura", "Chapai Nawabganj", "Joypurhat", "Naogaon", "Natore", "Pabna", "Rajshahi", "Sirajganj"],
  Rangpur: ["Dinajpur", "Gaibandha", "Kurigram", "Lalmonirhat", "Nilphamari", "Panchagarh", "Rangpur", "Thakurgaon"],
  Sylhet: ["Habiganj", "Moulvibazar", "Sunamganj", "Sylhet"],
};

export const DISTRICTS: string[] = Object.values(DIVISIONS).flat();

/** Older or alternative spellings people actually type. */
const ALIASES: Record<string, string> = {
  chittagong: "Chattogram", comilla: "Cumilla", barisal: "Barishal", jessore: "Jashore", bogra: "Bogura", coxsbazar: "Cox's Bazar", coxbazar: "Cox's Bazar",
  nawabganj: "Chapai Nawabganj", chapainawabganj: "Chapai Nawabganj", khagrachari: "Khagrachhari", jhalakathi: "Jhalokati", jhalakati: "Jhalokati", maulvibazar: "Moulvibazar",
  netrakona: "Netrokona", narshingdi: "Narsingdi", laxmipur: "Lakshmipur", jaipurhat: "Joypurhat", brahmanbaria: "Brahmanbaria", habiganj: "Habiganj", sirajgonj: "Sirajganj",
};

const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const BY_KEY = new Map<string, string>([...DISTRICTS.map((d) => [key(d), d] as const), ...Object.entries(ALIASES)]);

/** The official name for whatever the shopper typed, or undefined when it is not a Bangladesh district. */
export const canonicalDistrict = (input: string): string | undefined => BY_KEY.get(key(input));
