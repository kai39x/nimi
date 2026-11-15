import type { Lang } from "@/i18n";

const AR_NUM = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 1 });
const EN_NUM = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** Numbers in the user's language: Arabic-Indic digits in Arabic copy (boards), Latin in English. */
export function fmtNumber(value: number, lang: Lang): string {
  return (lang === "ar" ? AR_NUM : EN_NUM).format(value);
}

export function fmtPercent(value01: number, lang: Lang): string {
  const n = fmtNumber(Math.round(value01 * 100), lang);
  return lang === "ar" ? `٪${n}` : `${n}%`;
}

/** Whole days between two timestamps (ms), never negative. */
export function daysBetween(fromMs: number, toMs = Date.now()): number {
  return Math.max(0, Math.floor((toMs - fromMs) / 86_400_000));
}
