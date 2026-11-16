/**
 * Calculator and unit conversion for the command bar (board 10: «= 128 * 3.5», «10 km to mi»).
 * A small recursive-descent parser — never `eval`. Works with Arabic digits and words.
 */

/** Arabic-Indic / Persian digits → ASCII; Arabic decimal and thousands separators too. */
export function asciiDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

/** Lowercase; أ/إ/آ → ا, ة → ه, ى → ي; no diacritics or tatweel; ASCII digits. */
export function fold(s: string): string {
  return asciiDigits(s)
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase();
}

// --- expressions -------------------------------------------------------------------------------

const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  جذر: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  ln: Math.log,
  log: Math.log10,
  sin: (x) => Math.sin((x * Math.PI) / 180),
  cos: (x) => Math.cos((x * Math.PI) / 180),
  tan: (x) => Math.tan((x * Math.PI) / 180),
};
const CONSTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E };

/** Evaluates `+ - * / ^ %`, parentheses, ×, ÷, functions (degrees) and constants. */
export function calc(input: string): number | null {
  const src = asciiDigits(input)
    .replace(/[×xX](?=\s*[\d(.])/g, "*")
    .replace(/÷/g, "/")
    .replace(/,(?=\d{3}\b)/g, "")
    .replace(/\s+/g, "");
  if (!src) return null;
  let i = 0;
  const peek = () => src[i];
  const eat = (c: string) => (src[i] === c ? (i++, true) : false);

  function primary(): number {
    if (eat("(")) {
      const v = expr();
      if (!eat(")")) throw new Error("paren");
      return v;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      return parseFloat(num[0]);
    }
    const word = /^[a-zπ؀-ۿ]+/i.exec(src.slice(i));
    if (word) {
      const w = word[0].toLowerCase();
      if (w in CONSTS) {
        i += w.length;
        return CONSTS[w];
      }
      if (w in FUNCS) {
        i += w.length;
        return FUNCS[w](unary());
      }
    }
    throw new Error("token");
  }
  function postfix(): number {
    let v = primary();
    while (peek() === "%" || peek() === "!") {
      if (eat("%")) v = v / 100;
      else if (eat("!")) {
        if (v < 0 || v > 170 || !Number.isInteger(v)) throw new Error("fact");
        let f = 1;
        for (let k = 2; k <= v; k++) f *= k;
        v = f;
      }
    }
    return v;
  }
  function unary(): number {
    if (eat("-")) return -unary();
    if (eat("+")) return unary();
    return power();
  }
  function power(): number {
    const base = postfix();
    return eat("^") ? Math.pow(base, unary()) : base;
  }
  function term(): number {
    let v = unary();
    for (;;) {
      if (eat("*")) v *= unary();
      else if (eat("/")) v /= unary();
      else if (peek() === "(") v *= unary(); // 2(3+4)
      else return v;
    }
  }
  function expr(): number {
    let v = term();
    for (;;) {
      if (eat("+")) v += term();
      else if (eat("-")) v -= term();
      else return v;
    }
  }
  try {
    const v = expr();
    return i === src.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Looks like arithmetic (so «12*4» works without «=»): digits plus at least one operator. */
export function looksLikeMath(s: string): boolean {
  const a = asciiDigits(s).trim();
  return /\d/.test(a) && /[-+*/^×÷%()]/.test(a.replace(/^-/, "")) && /^[\d\s.,+\-*/^×÷%()xX!]+$/.test(a);
}

/** Up to 10 significant digits, no exponent for everyday sizes, Latin digits (board). */
export function fmtResult(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  const r = Number(v.toPrecision(10));
  return Math.abs(r) >= 1e-6 && Math.abs(r) < 1e15 ? String(r) : r.toExponential(6);
}

// --- units ---------------------------------------------------------------------------------------

type Unit = { cat: string; f: number; offset?: number; ar: string; en: string; names: string[] };

/** Factors to the category's base unit (m, kg, l, m², m/s, byte, s; °C via offset). */
const UNITS: Unit[] = [
  // length
  { cat: "len", f: 0.001, ar: "ملم", en: "mm", names: ["mm", "millimeter", "millimeters", "ملم", "مليمتر", "ملليمتر"] },
  { cat: "len", f: 0.01, ar: "سم", en: "cm", names: ["cm", "centimeter", "centimeters", "سم", "سنتي", "سنتيمتر", "سانتي"] },
  { cat: "len", f: 1, ar: "متر", en: "m", names: ["m", "meter", "meters", "metre", "metres", "م", "متر", "امتار"] },
  { cat: "len", f: 1000, ar: "كم", en: "km", names: ["km", "kilometer", "kilometers", "كم", "كيلومتر", "كيلو متر"] },
  { cat: "len", f: 0.0254, ar: "إنش", en: "in", names: ["in", "inch", "inches", "\"", "انش", "بوصه"] },
  { cat: "len", f: 0.3048, ar: "قدم", en: "ft", names: ["ft", "foot", "feet", "'", "قدم", "اقدام"] },
  { cat: "len", f: 0.9144, ar: "ياردة", en: "yd", names: ["yd", "yard", "yards", "يارده", "يارد"] },
  { cat: "len", f: 1609.344, ar: "ميل", en: "mi", names: ["mi", "mile", "miles", "ميل", "اميال"] },
  { cat: "len", f: 1852, ar: "ميل بحري", en: "nmi", names: ["nmi", "nautical mile", "ميل بحري"] },
  // mass
  { cat: "mass", f: 0.000001, ar: "ملغ", en: "mg", names: ["mg", "ملغ", "مليغرام", "ملليجرام"] },
  { cat: "mass", f: 0.001, ar: "غرام", en: "g", names: ["g", "gram", "grams", "غ", "غرام", "جرام", "جم"] },
  { cat: "mass", f: 1, ar: "كغ", en: "kg", names: ["kg", "kilo", "kilos", "kilogram", "kilograms", "كغ", "كجم", "كيلو", "كيلوغرام", "كيلوجرام"] },
  { cat: "mass", f: 1000, ar: "طن", en: "t", names: ["t", "ton", "tons", "tonne", "tonnes", "طن"] },
  { cat: "mass", f: 0.028349523125, ar: "أونصة", en: "oz", names: ["oz", "ounce", "ounces", "اونصه", "اونص"] },
  { cat: "mass", f: 0.45359237, ar: "رطل", en: "lb", names: ["lb", "lbs", "pound", "pounds", "رطل", "باوند"] },
  // temperature (to °C: (x + offset) * f… handled specially)
  { cat: "temp", f: 1, ar: "°م", en: "°C", names: ["c", "°c", "celsius", "مئوي", "مئويه", "سيليزي", "سلزيوس", "درجه مئويه"] },
  { cat: "temp", f: 1, ar: "°ف", en: "°F", names: ["f", "°f", "fahrenheit", "فهرنهايت", "فهرنهيت"] },
  { cat: "temp", f: 1, ar: "كلفن", en: "K", names: ["k", "kelvin", "كلفن"] },
  // volume
  { cat: "vol", f: 0.001, ar: "مل", en: "ml", names: ["ml", "milliliter", "milliliters", "مل", "مليلتر"] },
  { cat: "vol", f: 1, ar: "لتر", en: "l", names: ["l", "liter", "liters", "litre", "litres", "لتر", "ليتر"] },
  { cat: "vol", f: 3.785411784, ar: "غالون", en: "gal", names: ["gal", "gallon", "gallons", "غالون", "جالون"] },
  { cat: "vol", f: 0.2365882365, ar: "كوب", en: "cup", names: ["cup", "cups", "كوب", "اكواب"] },
  { cat: "vol", f: 0.0295735295625, ar: "أونصة سائلة", en: "fl oz", names: ["floz", "fl oz", "fluid ounce"] },
  // area
  { cat: "area", f: 1, ar: "م²", en: "m²", names: ["m2", "m²", "sqm", "متر مربع", "م2", "م²"] },
  { cat: "area", f: 1e6, ar: "كم²", en: "km²", names: ["km2", "km²", "كيلومتر مربع", "كم2", "كم²"] },
  { cat: "area", f: 0.09290304, ar: "قدم²", en: "ft²", names: ["ft2", "ft²", "sqft", "قدم مربع"] },
  { cat: "area", f: 10000, ar: "هكتار", en: "ha", names: ["ha", "hectare", "hectares", "هكتار"] },
  { cat: "area", f: 4046.8564224, ar: "فدان", en: "acre", names: ["acre", "acres", "ايكر"] },
  // speed
  { cat: "speed", f: 1 / 3.6, ar: "كم/س", en: "km/h", names: ["kmh", "km/h", "kph", "كم/س", "كم بالساعه"] },
  { cat: "speed", f: 0.44704, ar: "ميل/س", en: "mph", names: ["mph", "mi/h", "ميل/س", "ميل بالساعه"] },
  { cat: "speed", f: 1, ar: "م/ث", en: "m/s", names: ["m/s", "mps", "م/ث"] },
  { cat: "speed", f: 0.514444, ar: "عقدة", en: "kn", names: ["kn", "knot", "knots", "عقده"] },
  // data (decimal, as Windows Explorer shows sizes in base 1024 — use 1024)
  { cat: "data", f: 1, ar: "بايت", en: "B", names: ["b", "byte", "bytes", "بايت"] },
  { cat: "data", f: 1024, ar: "KB", en: "KB", names: ["kb", "kib", "kilobyte", "kilobytes", "كيلوبايت", "كيلو بايت"] },
  { cat: "data", f: 1024 ** 2, ar: "MB", en: "MB", names: ["mb", "mib", "megabyte", "megabytes", "ميجا", "ميغا", "ميجابايت", "ميغابايت", "ميقا"] },
  { cat: "data", f: 1024 ** 3, ar: "GB", en: "GB", names: ["gb", "gib", "gigabyte", "gigabytes", "جيجا", "غيغا", "جيجابايت", "غيغابايت", "قيقا"] },
  { cat: "data", f: 1024 ** 4, ar: "TB", en: "TB", names: ["tb", "tib", "terabyte", "terabytes", "تيرا", "تيرابايت"] },
  // time
  { cat: "time", f: 1, ar: "ثانية", en: "s", names: ["s", "sec", "secs", "second", "seconds", "ث", "ثانيه", "ثواني"] },
  { cat: "time", f: 60, ar: "دقيقة", en: "min", names: ["min", "mins", "minute", "minutes", "د", "دقيقه", "دقايق", "دقائق"] },
  { cat: "time", f: 3600, ar: "ساعة", en: "h", names: ["h", "hr", "hrs", "hour", "hours", "س", "ساعه", "ساعات"] },
  { cat: "time", f: 86400, ar: "يوم", en: "day", names: ["d", "day", "days", "يوم", "ايام"] },
  { cat: "time", f: 604800, ar: "أسبوع", en: "week", names: ["wk", "week", "weeks", "اسبوع", "اسابيع"] },
];

const BY_NAME = new Map<string, Unit>();
for (const u of UNITS) for (const n of u.names) BY_NAME.set(fold(n), u);

function unit(word: string): Unit | undefined {
  const w = fold(word.trim()).replace(/^(ال)(?=\S{2,})/, "");
  return BY_NAME.get(w) ?? BY_NAME.get(fold(word.trim()));
}

function toCelsius(v: number, u: Unit): number {
  return u.en === "°F" ? ((v - 32) * 5) / 9 : u.en === "K" ? v - 273.15 : v;
}
function fromCelsius(c: number, u: Unit): number {
  return u.en === "°F" ? (c * 9) / 5 + 32 : u.en === "K" ? c + 273.15 : c;
}

export type Conversion = { value: number; text: string; unitAr: string; unitEn: string };

/** «10 km to mi», «10 كم الى ميل», «5 ft in cm», «100 f = c». */
export function convert(input: string): Conversion | null {
  const s = asciiDigits(input).trim().replace(/^=\s*/, "");
  const m = /^(-?[\d.,]+)\s*(.+?)\s+(?:to|in|into|as|=|->|→|الى|إلى|ل|لـ|بال|كم يساوي)\s+(.+)$/i.exec(s);
  if (!m) return null;
  const value = parseFloat(m[1].replace(/,/g, ""));
  const from = unit(m[2]);
  const to = unit(m[3]);
  if (!Number.isFinite(value) || !from || !to || from.cat !== to.cat) return null;
  const out = from.cat === "temp" ? fromCelsius(toCelsius(value, from), to) : (value * from.f) / to.f;
  // «6.21 ميل» (board 10): two decimals for everyday sizes, three significant digits below 1.
  const text = fmtResult(Math.abs(out) >= 1 ? Math.round(out * 100) / 100 : Number(out.toPrecision(3)));
  return { value: out, text, unitAr: to.ar, unitEn: to.en };
}

// --- durations -----------------------------------------------------------------------------------

const WORD_MINUTES: Record<string, number> = {
  "نص ساعه": 30,
  "نصف ساعه": 30,
  "ربع ساعه": 15,
  ساعه: 60,
  ساعتين: 120,
  دقيقه: 1,
  دقيقتين: 2,
  "half hour": 30,
  "an hour": 60,
  hour: 60,
};

/**
 * Reads a duration at the start of `text` («25», «25m», «10 د», «1h30m», «نص ساعة», «90s»).
 * Returns minutes and the rest of the text, or null.
 */
export function readDuration(text: string): { minutes: number; rest: string } | null {
  let s = fold(text).trim();
  for (const [w, min] of Object.entries(WORD_MINUTES).sort((a, b) => b[0].length - a[0].length)) {
    if (s === w || s.startsWith(w + " ")) return { minutes: min, rest: text.trim().slice(w.length).trim() };
  }
  let minutes = 0;
  let consumed = 0;
  let any = false;
  const re = /^\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|ساعه|ساعات|س|m|min|mins|minute|minutes|دقيقه|دقايق|دقائق|د|s|sec|secs|second|seconds|ثانيه|ثواني|ث)?(?=\s|$|\d)/i;
  for (;;) {
    const m = re.exec(s);
    if (!m) break;
    any = true;
    const n = parseFloat(m[1]);
    const u = (m[2] ?? "m").toLowerCase();
    if (/^(h|hr|hrs|hour|hours|ساعه|ساعات|س)$/.test(u)) minutes += n * 60;
    else if (/^(s|sec|secs|second|seconds|ثانيه|ثواني|ث)$/.test(u)) minutes += n / 60;
    else minutes += n;
    consumed += m[0].length;
    s = s.slice(m[0].length);
    if (!m[2]) break; // a bare number is minutes and ends the duration
  }
  if (!any || minutes <= 0) return null;
  // `consumed` counts folded chars; folding never changes length except removed marks, so map
  // back by skipping the same number of non-mark chars in the original.
  let k = 0;
  let seen = 0;
  const orig = asciiDigits(text).trimStart();
  while (k < orig.length && seen < consumed) {
    if (!/[ً-ٰٟـ]/.test(orig[k])) seen++;
    k++;
  }
  return { minutes, rest: orig.slice(k).trim() };
}
