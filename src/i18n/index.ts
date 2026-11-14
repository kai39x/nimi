import { useCallback } from "react";
import { useSettings } from "@/lib/settings";
import { ar, type TKey } from "./ar";
import { en } from "./en";

export type { TKey };

const tables = { ar, en } as const;

export type Lang = keyof typeof tables;

export function t(lang: Lang, key: TKey): string {
  return tables[lang][key];
}

/** Returns a translator bound to the current language setting (Arabic until settings load). */
export function useT() {
  const lang: Lang = useSettings()?.language ?? "ar";
  return useCallback((key: TKey) => t(lang, key), [lang]);
}
