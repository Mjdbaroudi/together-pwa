/** Curated Arabic source texts, verified against the linked Qur'an/hadith references.
 * Tafsir summaries are editorial paraphrases of al-Sa'di, not attributed quotations.
 */
export const DAILY_VERSES = [
  { key: "13:28", surah: "الرعد", text: "الَّذِينَ آمَنُوا وَتَطْمَئِنُّ قُلُوبُهُمْ بِذِكْرِ اللَّهِ ۗ أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ", meaning: "ذكر الله وتدبّر كتابه يبعثان السكينة في قلوب المؤمنين ويزيلان قلقها.", theme: "سكينة القلب" },
  { key: "94:5", surah: "الشرح", text: "فَإِنَّ مَعَ الْعُسْرِ يُسْرًا", meaning: "بشارة بأن اليسر يصاحب المشقة، مهما اشتدّ العسر؛ وفيها تقوية للأمل وحسن الظن بالله.", theme: "باب للأمل" },
  { key: "2:152", surah: "البقرة", text: "فَاذْكُرُونِي أَذْكُرْكُمْ وَاشْكُرُوا لِي وَلَا تَكْفُرُونِ", meaning: "أمرٌ بذكر الله وشكره بالقلب واللسان والعمل، ووعدٌ منه بأن يذكر من يذكره.", theme: "ذكر وشكر" },
  { key: "11:115", surah: "هود", text: "وَاصْبِرْ فَإِنَّ اللَّهَ لَا يُضِيعُ أَجْرَ الْمُحْسِنِينَ", meaning: "اثبت على الطاعة وترك المعصية ولا تضجر؛ فالله يحفظ للمحسنين ثواب عملهم وصبرهم.", theme: "الصبر والإحسان" },
  { key: "93:5", surah: "الضحى", text: "وَلَسَوْفَ يُعْطِيكَ رَبُّكَ فَتَرْضَىٰ", meaning: "وعدٌ للنبي ﷺ بما يكرمه الله به من العطاء والإنعام، ومنه ما أعدّه له في الآخرة.", theme: "عطاء ورحمة" },
  { key: "94:6", surah: "الشرح", text: "إِنَّ مَعَ الْعُسْرِ يُسْرًا", meaning: "تأكيد للبشارة باليسر مع العسر، ودعوةٌ إلى الثبات والرجاء حين تشتدّ الصعوبات.", theme: "رجاء يتجدّد" },
] as const;
export function verseForDay(day: string) {
  const milliseconds = Date.parse(`${day}T00:00:00Z`);
  const index = Number.isFinite(milliseconds) ? Math.floor(milliseconds / 86400000) : 0;
  return DAILY_VERSES[((index % DAILY_VERSES.length) + DAILY_VERSES.length) % DAILY_VERSES.length];
}
export const ADHKAR = [
  { id: "ikhlas", title: "سورة الإخلاص", text: "قُلْ هُوَ اللَّهُ أَحَدٌ ﴿١﴾ اللَّهُ الصَّمَدُ ﴿٢﴾ لَمْ يَلِدْ وَلَمْ يُولَدْ ﴿٣﴾ وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ ﴿٤﴾", count: 3, source: "أبو داود 5082 · حسن، الألباني", url: "https://sunnah.com/abudawud:5082", quran: "https://quran.com/112" },
  { id: "falaq", title: "سورة الفلق", text: "قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ ﴿١﴾ مِن شَرِّ مَا خَلَقَ ﴿٢﴾ وَمِن شَرِّ غَاسِقٍ إِذَا وَقَبَ ﴿٣﴾ وَمِن شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ ﴿٤﴾ وَمِن شَرِّ حَاسِدٍ إِذَا حَسَدَ ﴿٥﴾", count: 3, source: "أبو داود 5082 · حسن، الألباني", url: "https://sunnah.com/abudawud:5082", quran: "https://quran.com/113" },
  { id: "nas", title: "سورة الناس", text: "قُلْ أَعُوذُ بِرَبِّ النَّاسِ ﴿١﴾ مَلِكِ النَّاسِ ﴿٢﴾ إِلَٰهِ النَّاسِ ﴿٣﴾ مِن شَرِّ الْوَسْوَاسِ الْخَنَّاسِ ﴿٤﴾ الَّذِي يُوَسْوِسُ فِي صُدُورِ النَّاسِ ﴿٥﴾ مِنَ الْجِنَّةِ وَالنَّاسِ ﴿٦﴾", count: 3, source: "أبو داود 5082 · حسن، الألباني", url: "https://sunnah.com/abudawud:5082", quran: "https://quran.com/114" },
  { id: "istighfar", title: "سيد الاستغفار", text: "اللَّهُمَّ أَنْتَ رَبِّي، لَا إِلَهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ، وَأَبُوءُ لَكَ بِذَنْبِي، فَاغْفِرْ لِي، فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ", count: 1, source: "صحيح البخاري 6306", url: "https://sunnah.com/bukhari:6306", quran: null },
  { id: "bismillah", title: "بسم الله الذي لا يضر", text: "بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ", count: 3, source: "أبو داود 5088 · صحيح، الألباني", url: "https://sunnah.com/abudawud:5088", quran: null },
  { id: "tasbih", title: "تسبيح وتحميد", text: "سُبْحَانَ اللَّهِ وَبِحَمْدِهِ", count: 100, source: "صحيح مسلم 2692", url: "https://sunnah.com/muslim:2692", quran: null },
] as const;
export type DhikrPeriod = "morning" | "evening";
export const periodLabel = (period: DhikrPeriod) => period === "morning" ? "أذكار الصباح" : "أذكار المساء";
