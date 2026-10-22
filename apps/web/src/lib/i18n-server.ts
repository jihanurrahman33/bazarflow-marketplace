import "server-only";
import { cookies } from "next/headers";
import { isLocale, LANG_COOKIE, makeT, type Locale, type T } from "./i18n";

/** The language this request should render in: the shopper's choice (cookie), English by default. */
export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLocale(v) ? v : "en";
}

export async function getT(): Promise<T> {
  return makeT(await getLocale());
}
