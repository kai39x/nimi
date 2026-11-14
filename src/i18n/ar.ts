/** Approved Arabic copy (design boards). Keys are stable identifiers, never translated. */
export const ar = {
  "app.name": "نيمي",

  "settings.title": "الإعدادات",
  "settings.close": "إغلاق",
  "settings.soon": "قريباً",
  "settings.section.general": "عام",
  "settings.section.character": "NIMI ونوري",
  "settings.section.capsule": "الكبسولة",
  "settings.section.notifications": "التنبيهات",
  "settings.section.feed": "الأكل والجيب",
  "settings.section.sounds": "الأصوات",
  "settings.section.shortcuts": "الاختصارات",
  "settings.section.privacy": "الخصوصية",
  "settings.section.about": "حول",

  "settings.language": "اللغة",
  "settings.language.ar": "عربي",
  "settings.language.en": "English",
  "settings.autostart": "يشتغل مع ويندوز",
  "settings.autostart.sub": "يبدأ مع تسجيل الدخول، بدون نافذة",
  "settings.display": "الشاشة",
  "settings.display.sub": "إذا عندك أكثر من شاشة",
  "settings.display.primary": "الرئيسية",

  "overlay.recenter": "رجّع نيمي لمكانه",
} as const;

export type TKey = keyof typeof ar;
