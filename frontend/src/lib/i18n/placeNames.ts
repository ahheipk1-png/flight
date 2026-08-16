// Frontend-only overlay for destination-region and city display names --
// no backend change. Keyed by the SAME stable identifiers the backend
// already returns (travel_regions.code, airports.iata), so this is purely
// a rendering-layer swap: look up the raw value, fall back to it
// unchanged if a code/city isn't in the table (e.g. any future airport
// added to the backend without a matching translation here yet).

import type { Locale } from "./locale";

type Localized = Record<Locale, string>;

const REGION_NAMES: Record<string, Localized> = {
  japan: { en: "Japan", "zh-Hant": "日本", "zh-Hans": "日本" },
  south_korea: { en: "South Korea", "zh-Hant": "韓國", "zh-Hans": "韩国" },
  taiwan: { en: "Taiwan", "zh-Hant": "台灣", "zh-Hans": "台湾" },
  hong_kong: { en: "Hong Kong", "zh-Hant": "香港", "zh-Hans": "香港" },
  singapore: { en: "Singapore", "zh-Hant": "新加坡", "zh-Hans": "新加坡" },
  thailand: { en: "Thailand", "zh-Hant": "泰國", "zh-Hans": "泰国" },
  turkey: { en: "Turkey", "zh-Hant": "土耳其", "zh-Hans": "土耳其" },
  qatar: { en: "Qatar", "zh-Hant": "卡達", "zh-Hans": "卡塔尔" },
  uae: { en: "United Arab Emirates", "zh-Hant": "阿拉伯聯合大公國", "zh-Hans": "阿拉伯联合酋长国" },
  united_kingdom: { en: "United Kingdom", "zh-Hant": "英國", "zh-Hans": "英国" },
  france: { en: "France", "zh-Hant": "法國", "zh-Hans": "法国" },
  netherlands: { en: "Netherlands", "zh-Hant": "荷蘭", "zh-Hans": "荷兰" },
  germany: { en: "Germany", "zh-Hant": "德國", "zh-Hans": "德国" },
  portugal: { en: "Portugal", "zh-Hant": "葡萄牙", "zh-Hans": "葡萄牙" },
  southern_europe: {
    en: "Southern Europe (Spain, Italy, Greece)",
    "zh-Hant": "南歐（西班牙、義大利、希臘）",
    "zh-Hans": "南欧（西班牙、意大利、希腊）",
  },
};

// Keyed by IATA (the city an airport serves), covering §38's MVP geography.
const CITY_NAMES: Record<string, Localized> = {
  YYZ: { en: "Toronto", "zh-Hant": "多倫多", "zh-Hans": "多伦多" },
  YTZ: { en: "Toronto", "zh-Hant": "多倫多", "zh-Hans": "多伦多" },
  YHM: { en: "Hamilton", "zh-Hant": "漢密爾頓", "zh-Hans": "汉密尔顿" },
  YKF: { en: "Waterloo", "zh-Hant": "滑鐵盧", "zh-Hans": "滑铁卢" },
  BUF: { en: "Buffalo", "zh-Hant": "水牛城", "zh-Hans": "水牛城" },
  HND: { en: "Tokyo", "zh-Hant": "東京", "zh-Hans": "东京" },
  NRT: { en: "Tokyo", "zh-Hant": "東京", "zh-Hans": "东京" },
  KIX: { en: "Osaka", "zh-Hant": "大阪", "zh-Hans": "大阪" },
  ITM: { en: "Osaka", "zh-Hant": "大阪", "zh-Hans": "大阪" },
  UKB: { en: "Kobe", "zh-Hant": "神戶", "zh-Hans": "神户" },
  ICN: { en: "Seoul", "zh-Hant": "首爾", "zh-Hans": "首尔" },
  TPE: { en: "Taipei", "zh-Hant": "台北", "zh-Hans": "台北" },
  HKG: { en: "Hong Kong", "zh-Hant": "香港", "zh-Hans": "香港" },
  SIN: { en: "Singapore", "zh-Hant": "新加坡", "zh-Hans": "新加坡" },
  BKK: { en: "Bangkok", "zh-Hant": "曼谷", "zh-Hans": "曼谷" },
  IST: { en: "Istanbul", "zh-Hant": "伊斯坦堡", "zh-Hans": "伊斯坦布尔" },
  DOH: { en: "Doha", "zh-Hant": "杜哈", "zh-Hans": "多哈" },
  DXB: { en: "Dubai", "zh-Hant": "杜拜", "zh-Hans": "迪拜" },
  LHR: { en: "London", "zh-Hant": "倫敦", "zh-Hans": "伦敦" },
  CDG: { en: "Paris", "zh-Hant": "巴黎", "zh-Hans": "巴黎" },
  AMS: { en: "Amsterdam", "zh-Hant": "阿姆斯特丹", "zh-Hans": "阿姆斯特丹" },
  FRA: { en: "Frankfurt", "zh-Hant": "法蘭克福", "zh-Hans": "法兰克福" },
  LIS: { en: "Lisbon", "zh-Hant": "里斯本", "zh-Hans": "里斯本" },
  OPO: { en: "Porto", "zh-Hant": "波爾圖", "zh-Hans": "波尔图" },
  MAD: { en: "Madrid", "zh-Hant": "馬德里", "zh-Hans": "马德里" },
  BCN: { en: "Barcelona", "zh-Hant": "巴塞隆納", "zh-Hans": "巴塞罗那" },
  FCO: { en: "Rome", "zh-Hant": "羅馬", "zh-Hans": "罗马" },
  MXP: { en: "Milan", "zh-Hant": "米蘭", "zh-Hans": "米兰" },
  ATH: { en: "Athens", "zh-Hant": "雅典", "zh-Hans": "雅典" },
};

export function localizedRegionName(code: string, fallbackName: string, locale: Locale): string {
  return REGION_NAMES[code]?.[locale] ?? fallbackName;
}

export function localizedCityName(iata: string, fallbackCity: string, locale: Locale): string {
  return CITY_NAMES[iata]?.[locale] ?? fallbackCity;
}
