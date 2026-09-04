import { APP_URL, SITE_URL } from "@/lib/env";

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Exact browser origins allowed to call same-product API routes. */
export const APP_ALLOWED_ORIGINS = [
  ...new Set(
    [
      "https://decodedsat.com",
      "https://www.decodedsat.com",
      "http://localhost:3000",
      originOf(SITE_URL),
      originOf(APP_URL),
    ].filter((origin): origin is string => origin !== null),
  ),
] as const;

