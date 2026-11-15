import type { Lang } from "@/i18n";
import type { Mood } from "@/features/character/rig/moods";

/** The status pill («NIMI رايق») and the mood row of the status card. */
const AR: Record<Mood, string> = {
  idle: "رايق",
  sleeping: "نايم",
  happy: "مبسوط",
  curious: "فضولي",
  surprised: "متفاجئ",
  excited: "متحمس",
  working: "يشتغل",
  error: "عنده مشكلة",
  music: "يسمع",
  attention: "عنده خبر",
  bored: "ملّان",
  grabbed: "مسحوب",
  dizzy: "دايخ",
  shy: "مستحي",
  hungry: "جوعان",
  chomp: "ياكل",
  chew: "يمضغ",
  love: "يحبّك",
  laugh: "يضحك",
  sad: "زعلان",
  angry: "معصّب",
  scared: "خايف",
  celebrate: "يحتفل",
  cold: "بردان",
};

const EN: Record<Mood, string> = {
  idle: "chill",
  sleeping: "asleep",
  happy: "happy",
  curious: "curious",
  surprised: "surprised",
  excited: "excited",
  working: "working",
  error: "in trouble",
  music: "listening",
  attention: "has news",
  bored: "bored",
  grabbed: "grabbed",
  dizzy: "dizzy",
  shy: "shy",
  hungry: "hungry",
  chomp: "eating",
  chew: "chewing",
  love: "in love",
  laugh: "laughing",
  sad: "sad",
  angry: "angry",
  scared: "scared",
  celebrate: "celebrating",
  cold: "cold",
};

export function moodLabel(mood: Mood, lang: Lang): string {
  return (lang === "ar" ? AR : EN)[mood];
}

/** How the mood reads as a bar (0..1) in the status card. */
export function moodLevel(mood: Mood): number {
  switch (mood) {
    case "excited":
    case "happy":
    case "chomp":
    case "chew":
    case "love":
    case "laugh":
    case "celebrate":
      return 1;
    case "music":
    case "curious":
    case "attention":
    case "hungry":
      return 0.85;
    case "idle":
    case "working":
    case "surprised":
    case "shy":
    case "grabbed":
      return 0.7;
    case "sleeping":
      return 0.55;
    case "dizzy":
    case "bored":
    case "cold":
      return 0.4;
    case "sad":
    case "scared":
      return 0.3;
    case "error":
    case "angry":
      return 0.25;
  }
}
