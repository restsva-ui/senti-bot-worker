// src/calendar.js — Calendar & Holidays for Senti v4.0
// today/yesterday/tomorrow + weekday
// Official UA (fixed only) + optional unofficial when user asks "А не офіційного?"

const OFFICIAL_FIXED = {
  "01-01": { uk: "Новий рік", ru: "Новый год", en: "New Year’s Day", de: "Neujahr", fr: "Nouvel An" },
  "03-08": { uk: "Міжнародний жіночий день", ru: "Международный женский день", en: "International Women’s Day", de: "Internationaler Frauentag", fr: "Journée internationale des femmes" },
  "06-28": { uk: "День Конституції України", ru: "День Конституции Украины", en: "Constitution Day of Ukraine", de: "Tag der Verfassung der Ukraine", fr: "Jour de la Constitution de l’Ukraine" },
  "08-24": { uk: "День Незалежності України", ru: "День Независимости Украины", en: "Independence Day of Ukraine", de: "Unabhängigkeitstag der Ukraine", fr: "Fête de l’Indépendance de l’Ukraine" },
  "10-14": { uk: "День захисників і захисниць України", ru: "День защитников и защитниц Украины", en: "Defenders Day of Ukraine", de: "Tag der Verteidiger der Ukraine", fr: "Jour des Défenseurs de l’Ukraine" },
  "12-25": { uk: "Різдво Христове (григоріан.)", ru: "Рождество Христово (грег.)", en: "Christmas Day (Gregorian)", de: "Weihnachtstag (greg.)", fr: "Noël (grégorien)" },
};

const UNOFFICIAL_FIXED = {
  "02-14": { uk: "День святого Валентина", ru: "День святого Валентина", en: "Valentine’s Day", de: "Valentinstag", fr: "Saint-Valentin" },
  "01-24": { uk: "День компліментів", ru: "День комплиментов", en: "Compliment Day", de: "Tag des Kompliments", fr: "Journée du compliment" },
  "04-01": { uk: "День сміху (April’s Fool)", ru: "День смеха (День дурака)", en: "April Fools’ Day", de: "Aprilscherz-Tag", fr: "Poisson d’avril" },
  "10-31": { uk: "Геловін", ru: "Хэллоуин", en: "Halloween", de: "Halloween", fr: "Halloween" },
  "12-31": { uk: "Новий рік (зустріч)", ru: "Новый год (канун)", en: "New Year’s Eve", de: "Silvester", fr: "Réveillon du Nouvel An" },
  // Programmer’s Day = 256th day of year (Sep 12 or 13 in leap years)
};

function programmersDay(year) {
  const start = new Date(Date.UTC(year, 0, 1));
  const d = new Date(start.getTime() + (256 - 1) * 24 * 3600 * 1000);
  return { m: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function pad(n) { return n < 10 ? "0" + n : String(n); }

const WEEKDAYS = {
  uk: ["неділя","понеділок","вівторок","середа","четвер","п’ятниця","субота"],
  ru: ["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"],
  en: ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],
  de: ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"],
  fr: ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"],
};

function L(replyLang) {
  const T = {
    uk: {
      today: "Сьогодні",
      yesterday: "Вчора",
      tomorrow: "Завтра",
      noHoliday: "Схоже, офіційного свята немає.",
      unofficialIntro: "Неофіційні/міжнародні:",
      fmtDate: (d, wd) => `${pad(d.getUTCDate())}.${pad(d.getUTCMonth()+1)}.${d.getUTCFullYear()} (${wd})`,
    },
    ru: {
      today: "Сегодня",
      yesterday: "Вчера",
      tomorrow: "Завтра",
      noHoliday: "Похоже, официального праздника нет.",
      unofficialIntro: "Неофициальные/международные:",
      fmtDate: (d, wd) => `${pad(d.getUTCDate())}.${pad(d.getUTCMonth()+1)}.${d.getUTCFullYear()} (${wd})`,
    },
    en: {
      today: "Today",
      yesterday: "Yesterday",
      tomorrow: "Tomorrow",
      noHoliday: "Looks like there’s no official holiday.",
      unofficialIntro: "Unofficial/international:",
      fmtDate: (d, wd) => `${pad(d.getUTCDate())}.${pad(d.getUTCMonth()+1)}.${d.getUTCFullYear()} (${wd})`,
    },
    de: {
      today: "Heute",
      yesterday: "Gestern",
      tomorrow: "Morgen",
      noHoliday: "Anscheinend kein offizieller Feiertag.",
      unofficialIntro: "Inoffiziell/international:",
      fmtDate: (d, wd) => `${pad(d.getUTCDate())}.${pad(d.getUTCMonth()+1)}.${d.getUTCFullYear()} (${wd})`,
    },
    fr: {
      today: "Aujourd’hui",
      yesterday: "Hier",
      tomorrow: "Demain",
      noHoliday: "Il semble qu’il n’y ait pas de fête officielle.",
      unofficialIntro: "Non officiel/international :",
      fmtDate: (d, wd) => `${pad(d.getUTCDate())}.${pad(d.getUTCMonth()+1)}.${d.getUTCFullYear()} (${wd})`,
    },
  };
  return T[replyLang] || T.en;
}

function pickTargetDate(text) {
  const now = new Date(); // UTC now; acceptable for simple display
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let d = new Date(today);
  if (/\b(вчора|вчера|yesterday)\b/i.test(text || "")) {
    d = new Date(today.getTime() - 24*3600*1000);
  } else if (/\b(завтра|завтра|tomorrow)\b/i.test(text || "")) {
    d = new Date(today.getTime() + 24*3600*1000);
  }
  return d;
}

function holidayFor(date, replyLang, includeUnofficial) {
  const key = `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const off = OFFICIAL_FIXED[key];
  const list = [];
  if (off) list.push(off[replyLang] || off.en);

  // Programmer’s Day dynamic
  const pd = programmersDay(date.getUTCFullYear());
  if (pd.m === (date.getUTCMonth()+1) && pd.day === date.getUTCDate()) {
    list.push(
      replyLang === "uk" ? "День програміста" :
      replyLang === "ru" ? "День программиста" :
      replyLang === "de" ? "Tag des Programmierers" :
      replyLang === "fr" ? "Journée du programmeur" : "Programmer’s Day"
    );
  }

  if (includeUnofficial) {
    const u = UNOFFICIAL_FIXED[key];
    if (u) list.push(u[replyLang] || u.en);
  }
  return list;
}

export async function handleCalendar(env, { text, replyLang }) {
  const t = L(replyLang);
  const d = pickTargetDate(text);
  const wd = WEEKDAYS[replyLang] ? WEEKDAYS[replyLang][d.getUTCDay()] : WEEKDAYS.en[d.getUTCDay()];
  const dateLine =
    /\b(вчора|вчера|yesterday)\b/i.test(text || "") ? `${t.yesterday}: ${t.fmtDate(d, wd)}` :
    /\b(завтра|tomorrow)\b/i.test(text || "") ? `${t.tomorrow}: ${t.fmtDate(d, wd)}` :
    `${t.today}: ${t.fmtDate(d, wd)}`;

  // Include unofficial if the user asked
  const wantsUnofficial = /(а\s+не\s+офіційного|неофициального|unofficial|international)/i.test(text || "");

  const holidays = holidayFor(d, replyLang, wantsUnofficial);

  let lines = [dateLine];
  if (holidays.length === 0) {
    lines.push(t.noHoliday);
    if (wantsUnofficial) {
      lines.push(t.unofficialIntro + " — немає.");
    }
  } else {
    // Split by official / unofficial if both present
    if (wantsUnofficial) {
      // We do not track which item is which here, but list all found.
      lines.push(holidays.map(h => `• ${h}`).join("\n"));
    } else {
      lines.push(holidays[0] ? `• ${holidays[0]}` : "");
    }
  }

  return { text: lines.filter(Boolean).join("\n") };
}
