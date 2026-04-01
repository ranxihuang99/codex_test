"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8788);
const MAX_FLIGHTS = Number(process.env.MAX_FLIGHTS || 40);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 15000);

const ONE_HOUR_MS = 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * ONE_HOUR_MS;
const TWELVE_HOURS_MS = 12 * ONE_HOUR_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const AIRPORT_INDEX_URL = process.env.AIRPORT_INDEX_URL || "https://raw.githubusercontent.com/mwgg/Airports/master/airports.json";
const SEARCHAPI_URL = process.env.SEARCHAPI_URL || "https://www.searchapi.io/api/v1/search";
const SEARCHAPI_KEY = String(process.env.SEARCHAPI_KEY || "").trim();

const LOW_COST_AIRLINE_IATA = new Set([
  "9C", "PN", "AQ", "UQ", "JR",
  "FR", "RK", "U2", "W6", "VY", "PC", "XQ", "VF", "TO", "HV", "J9",
  "NK", "F9", "G4", "SY",
  "AK", "D7", "QZ", "FD", "TR", "VJ", "JQ", "3K", "Z2", "5J", "OD"
]);

const LOW_COST_AIRLINE_ICAO = new Set([
  "CQH", "CHB", "JYH", "CBG",
  "RYR", "RUK", "EZY", "WZZ", "VLG", "PGT", "SXS", "VTI", "TVF",
  "NKS", "FFT", "AAY", "SCX",
  "AXM", "AIQ", "TGW", "KLO", "JST", "JSA", "PIC", "CEB", "SEJ"
]);

const ICAO_TO_IATA = {
  CSN: "CZ",
  CSZ: "ZH",
  CCA: "CA",
  CES: "MU",
  CHH: "HU",
  CSC: "3U",
  CQH: "9C",
  KNA: "KY",
  LKE: "8L",
  FZA: "FU",
  EPA: "DZ",
  BTV: "TV",
  GCR: "GS",
  RXA: "G5",
  DKH: "HO",
  GDC: "EU",
  CSH: "FM",
  CXA: "OQ",
  UEA: "KN",
  QDA: "HO",
  HXA: "NS",
  ELY: "BK",
  SKW: "SC",
  TBA: "TV",
  AXM: "AK",
  WZZ: "W6",
  RYR: "FR",
  VLG: "VY",
  EZY: "U2",
  THY: "TK"
};

const IATA_TO_ICAO = Object.entries(ICAO_TO_IATA).reduce((acc, [icao, iata]) => {
  if (iata && !acc[iata]) acc[iata] = icao;
  return acc;
}, {});

const CITY_ALIAS_TO_IATA = new Map([
  // China
  ["深圳", "SZX"], ["shenzhen", "SZX"], ["深圳宝安", "SZX"],
  ["广州", "CAN"], ["guangzhou", "CAN"], ["广州白云", "CAN"],
  ["北京", "PEK"], ["beijing", "PEK"], ["北京首都", "PEK"],
  ["北京大兴", "PKX"], ["daxing", "PKX"],
  ["上海", "SHA"], ["shanghai", "SHA"], ["上海虹桥", "SHA"], ["上海浦东", "PVG"], ["pudong", "PVG"],
  ["杭州", "HGH"], ["hangzhou", "HGH"], ["南京", "NKG"], ["nanjing", "NKG"],
  ["成都", "CTU"], ["chengdu", "CTU"], ["成都双流", "CTU"], ["成都天府", "TFU"],
  ["重庆", "CKG"], ["chongqing", "CKG"], ["西安", "XIY"], ["xian", "XIY"], ["西安咸阳", "XIY"],
  ["昆明", "KMG"], ["kunming", "KMG"], ["丽江", "LJG"], ["lijiang", "LJG"],
  ["武汉", "WUH"], ["wuhan", "WUH"], ["厦门", "XMN"], ["xiamen", "XMN"],
  ["青岛", "TAO"], ["qingdao", "TAO"], ["天津", "TSN"], ["tianjin", "TSN"],
  ["郑州", "CGO"], ["zhengzhou", "CGO"], ["长沙", "CSX"], ["changsha", "CSX"],
  ["苏州", "WUX"], ["suzhou", "WUX"], ["无锡", "WUX"], ["wuxi", "WUX"],
  ["三亚", "SYX"], ["sanya", "SYX"], ["海口", "HAK"], ["haikou", "HAK"],
  ["福州", "FOC"], ["fuzhou", "FOC"], ["宁波", "NGB"], ["ningbo", "NGB"],
  ["济南", "TNA"], ["jinan", "TNA"], ["南宁", "NNG"], ["nanning", "NNG"],
  ["合肥", "HFE"], ["hefei", "HFE"], ["沈阳", "SHE"], ["shenyang", "SHE"],
  ["大连", "DLC"], ["dalian", "DLC"], ["哈尔滨", "HRB"], ["harbin", "HRB"],
  ["长春", "CGQ"], ["changchun", "CGQ"], ["贵阳", "KWE"], ["guiyang", "KWE"],
  ["桂林", "KWL"], ["guilin", "KWL"], ["兰州", "LHW"], ["lanzhou", "LHW"],
  ["乌鲁木齐", "URC"], ["urumqi", "URC"], ["拉萨", "LXA"], ["lhasa", "LXA"],
  ["石家庄", "SJW"], ["shijiazhuang", "SJW"], ["太原", "TYN"], ["taiyuan", "TYN"],
  ["呼和浩特", "HET"], ["hohhot", "HET"], ["珠海", "ZUH"], ["zhuhai", "ZUH"],
  ["温州", "WNZ"], ["wenzhou", "WNZ"], ["南昌", "KHN"], ["nanchang", "KHN"],
  ["银川", "INC"], ["yinchuan", "INC"], ["西宁", "XNN"], ["xining", "XNN"],
  ["延吉", "YNJ"], ["yanji", "YNJ"], ["台北", "TPE"], ["taipei", "TPE"],
  ["香港", "HKG"], ["hong kong", "HKG"], ["澳门", "MFM"], ["macau", "MFM"],
  // International commonly used
  ["tokyo", "HND"], ["osaka", "KIX"], ["seoul", "ICN"], ["singapore", "SIN"],
  ["bangkok", "BKK"], ["london", "LHR"], ["paris", "CDG"], ["new york", "JFK"],
  ["los angeles", "LAX"], ["san francisco", "SFO"], ["sydney", "SYD"], ["dubai", "DXB"],
  // International common Chinese/Japanese aliases
  ["东京", "HND"], ["東京", "HND"], ["日本东京", "HND"], ["日本東京", "HND"],
  ["大阪", "KIX"], ["日本大阪", "KIX"],
  ["首尔", "ICN"], ["首爾", "ICN"], ["韩国首尔", "ICN"], ["南韩首尔", "ICN"],
  ["新加坡", "SIN"], ["曼谷", "BKK"], ["泰国曼谷", "BKK"],
  ["伦敦", "LHR"], ["倫敦", "LHR"], ["英国伦敦", "LHR"], ["英國倫敦", "LHR"],
  ["巴黎", "CDG"], ["法国巴黎", "CDG"], ["法國巴黎", "CDG"],
  ["纽约", "JFK"], ["紐約", "JFK"], ["美国纽约", "JFK"], ["美國紐約", "JFK"],
  ["洛杉矶", "LAX"], ["洛杉磯", "LAX"], ["美国洛杉矶", "LAX"], ["美國洛杉磯", "LAX"],
  ["旧金山", "SFO"], ["舊金山", "SFO"], ["美国旧金山", "SFO"], ["美國舊金山", "SFO"],
  ["悉尼", "SYD"], ["雪梨", "SYD"], ["澳大利亚悉尼", "SYD"], ["澳洲悉尼", "SYD"],
  ["迪拜", "DXB"], ["杜拜", "DXB"], ["阿联酋迪拜", "DXB"], ["阿聯酋杜拜", "DXB"]
]);

const MAJOR_AIRPORT_IATA = new Set([
  "ATL", "PEK", "LHR", "ORD", "HND", "LAX", "CDG", "DFW", "FRA", "IST",
  "AMS", "MAD", "BCN", "SIN", "JFK", "CAN", "SZX", "PVG", "SHA", "PKX",
  "MUC", "SYD", "MEL", "DXB", "DOH", "AUH", "ICN", "NRT", "KIX", "NGO",
  "BKK", "HKG", "MFM", "TPE", "KUL", "CGK", "MNL", "DEL", "BOM", "BLR",
  "HYD", "LIS", "CPH", "ARN", "OSL", "HEL", "VIE", "ZRH", "GVA", "BRU",
  "DUB", "EDI", "MAN", "LGW", "LCY", "SEA", "SFO", "BOS", "IAD", "EWR",
  "MIA", "IAH", "PHX", "LAS", "YYZ", "YVR", "YUL", "GRU", "EZE", "SCL",
  "JNB", "CAI", "NBO", "ADD", "AKL", "PER", "BNE", "ADL", "WLG", "CHC",
  "WAW", "PRG", "BUD", "ATH", "FCO", "MXP", "NAP", "CTU", "TFU", "XIY",
  "KMG", "LJG", "XMN", "HAK", "SYX", "WUH", "HGH", "NKG", "CKG", "TSN"
]);

const AIRCRAFT_CODE_HINTS = {
  B738: { slug: "boeing-737-800", model: "Boeing 737-800" },
  "73H": { slug: "boeing-737-800", model: "Boeing 737-800" },
  "73G": { slug: "boeing-737-700", model: "Boeing 737-700" },
  B737: { slug: "boeing-737", model: "Boeing 737" },
  B77W: { slug: "boeing-777-300er", model: "Boeing 777-300ER" },
  B789: { slug: "boeing-787-9", model: "Boeing 787-9" },
  B788: { slug: "boeing-787-8", model: "Boeing 787-8" },
  B38M: { slug: "boeing-737-max-8", model: "Boeing 737 MAX 8" },
  B38N: { slug: "boeing-737-max-8", model: "Boeing 737 MAX 8" },
  A320: { slug: "airbus-a320", model: "Airbus A320" },
  "320": { slug: "airbus-a320", model: "Airbus A320" },
  A319: { slug: "airbus-a319", model: "Airbus A319" },
  "319": { slug: "airbus-a319", model: "Airbus A319" },
  A321: { slug: "airbus-a321", model: "Airbus A321" },
  "321": { slug: "airbus-a321", model: "Airbus A321" },
  A20N: { slug: "airbus-a320neo", model: "Airbus A320neo" },
  A21N: { slug: "airbus-a321neo", model: "Airbus A321neo" },
  A333: { slug: "airbus-a330-300", model: "Airbus A330-300" },
  A359: { slug: "airbus-a350-900", model: "Airbus A350-900" },
  E190: { slug: "embraer-190", model: "Embraer E190" },
  E195: { slug: "embraer-195", model: "Embraer E195" },
  CRJ9: { slug: "bombardier-crj-900", model: "Bombardier CRJ-900" },
  AT76: { slug: "atr-72-600", model: "ATR 72-600" }
};

const airlineMapCache = {
  data: null,
  expiresAt: 0
};

const airportIndexCache = {
  rows: [],
  byIata: new Map(),
  byIcao: new Map(),
  expiresAt: 0
};

const airlineFleetCache = new Map();
const seatmapMetricsCache = new Map();
const seatmapDetailCache = new Map();
const aerolopaAirlineFleetCache = new Map();
const aerolopaAircraftCache = new Map();
const geocodeFallbackCache = new Map();

const COUNTRY_PREFIXES = [
  "中华人民共和国", "中國", "中国", "中国香港", "中國香港", "中国澳门", "中國澳門",
  "日本国", "日本", "韩国", "韓國", "南韩", "南韓", "新加坡",
  "泰国", "泰國", "英国", "英國", "法国", "法國", "德国", "德國", "意大利", "義大利",
  "西班牙", "葡萄牙", "荷兰", "荷蘭", "瑞士", "美国", "美國", "加拿大",
  "澳大利亚", "澳大利亞", "澳洲", "阿联酋", "阿聯酋"
];

const MIME_BY_EXT = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function nowMs() {
  return Date.now();
}

function toUpperSafe(value) {
  return String(value || "").trim().toUpperCase();
}

function toLowerSafe(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLocationInput(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/机场$/g, "")
    .replace(/国际机场$/g, "")
    .replace(/市$/g, "");
}

function stripCountryPrefix(input) {
  let value = String(input || "").trim();
  if (!value) return value;

  for (const prefix of COUNTRY_PREFIXES) {
    if (value.startsWith(prefix) && value.length > prefix.length) {
      value = value.slice(prefix.length).trim();
      break;
    }
  }

  return value.replace(/^[\s,，\-_/|]+/, "").trim();
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .toLowerCase();
}

function stripTags(html) {
  return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function parseNumber(raw) {
  const match = String(raw || "").replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function parseCoordinate(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  if (Number.isFinite(value)) return value;
  return parseNumber(raw);
}

function parseInches(raw) {
  if (!raw) return null;
  const value = decodeHtmlEntities(raw);
  if (/no\s*recline|fixed|none/i.test(value)) return 0;
  if (/°/.test(value)) return null;
  return parseNumber(value);
}

function makeJsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function safeErrorMessage(error) {
  if (!error) return "Unknown error";
  return String(error.message || error).slice(0, 400);
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function lookupAliasIata(rawInput) {
  const cleaned = normalizeLocationInput(rawInput);
  if (!cleaned) return "";

  const direct = CITY_ALIAS_TO_IATA.get(toLowerSafe(cleaned));
  if (direct) return direct;

  const queryNorm = normalizeSearchText(cleaned);
  if (!queryNorm) return "";
  const compactQueryNorm = queryNorm.replace(/\s+/g, "");

  for (const [alias, iata] of CITY_ALIAS_TO_IATA.entries()) {
    const aliasNorm = normalizeSearchText(alias);
    if (!aliasNorm) continue;
    if (aliasNorm === queryNorm) return iata;
    if (aliasNorm.replace(/\s+/g, "") === compactQueryNorm) return iata;
  }

  return "";
}

function toTitleCase(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  return text
    .split(/\s+/)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase())
    .join(" ");
}

function normalizeAirportRows(payload) {
  const rows = [];
  const byIata = new Map();
  const byIcao = new Map();

  for (const [icaoKey, airport] of Object.entries(payload || {})) {
    const iata = toUpperSafe(airport?.iata);
    const icao = toUpperSafe(airport?.icao || icaoKey);
    if (!iata || iata.length !== 3) continue;

    const city = String(airport?.city || "").trim();
    const name = String(airport?.name || "").trim();
    const country = String(airport?.country || "").trim();
    const state = String(airport?.state || "").trim();
    const lat = parseCoordinate(airport?.lat);
    const lon = parseCoordinate(airport?.lon);

    const row = {
      iata,
      icao,
      city,
      name,
      country,
      state,
      lat,
      lon,
      cityNorm: normalizeSearchText(city),
      nameNorm: normalizeSearchText(name),
      countryNorm: normalizeSearchText(country),
      stateNorm: normalizeSearchText(state)
    };

    if (!byIata.has(iata) || MAJOR_AIRPORT_IATA.has(iata)) {
      byIata.set(iata, row);
    }

    if (icao && icao.length === 4 && !byIcao.has(icao)) {
      byIcao.set(icao, row);
    }
  }

  rows.push(...byIata.values());
  rows.sort((a, b) => a.iata.localeCompare(b.iata));

  return {
    rows,
    byIata,
    byIcao
  };
}

async function getAirportIndex() {
  if (airportIndexCache.rows.length > 0 && airportIndexCache.expiresAt > nowMs()) {
    return airportIndexCache;
  }

  const response = await fetchWithTimeout(AIRPORT_INDEX_URL, {
    headers: {
      accept: "application/json,text/plain,*/*"
    }
  });

  if (!response.ok) {
    throw new Error(`全球机场索引加载失败: HTTP ${response.status}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`全球机场索引解析失败: ${safeErrorMessage(error)}`);
  }

  const parsed = normalizeAirportRows(payload);
  if (!parsed.rows.length) {
    throw new Error("全球机场索引为空");
  }

  airportIndexCache.rows = parsed.rows;
  airportIndexCache.byIata = parsed.byIata;
  airportIndexCache.byIcao = parsed.byIcao;
  airportIndexCache.expiresAt = nowMs() + ONE_DAY_MS;

  return airportIndexCache;
}

function scoreAirportCandidate(queryNorm, queryUpper, airport, preferredIata) {
  let score = 0;

  if (airport.iata === queryUpper) score += 160;
  if (airport.icao === queryUpper) score += 140;
  if (preferredIata && airport.iata === preferredIata) score += 90;

  if (airport.cityNorm === queryNorm) score += 120;
  else if (airport.cityNorm.startsWith(queryNorm)) score += 90;
  else if (airport.cityNorm.includes(queryNorm)) score += 60;

  if (airport.nameNorm === queryNorm) score += 75;
  else if (airport.nameNorm.startsWith(queryNorm)) score += 40;
  else if (airport.nameNorm.includes(queryNorm)) score += 20;

  if (airport.countryNorm === queryNorm) score += 10;
  if (airport.stateNorm === queryNorm) score += 8;
  if (score <= 0) return 0;

  if (/international airport/i.test(airport.name)) score += 4;
  if (/city airport/i.test(airport.name)) score -= 4;
  if (MAJOR_AIRPORT_IATA.has(airport.iata)) score += 8;

  return score;
}

function airportDisplayLabel(airport) {
  const city = airport.city || airport.state || airport.country || "";
  const airportName = airport.name || "Unknown Airport";
  const country = airport.country ? `, ${airport.country}` : "";
  return `${city} - ${airportName} (${airport.iata})${country}`;
}

async function searchAirportCandidates(rawInput, limit = 12) {
  const query = normalizeLocationInput(rawInput);
  const stripped = stripCountryPrefix(query);
  const queryNorm = normalizeSearchText(query);
  const queryUpper = toUpperSafe(query);
  const preferredIata = lookupAliasIata(query);

  if (!queryNorm && !queryUpper) {
    return [];
  }

  const index = await getAirportIndex();

  if (/^[A-Z]{3}$/.test(queryUpper) && index.byIata.has(queryUpper)) {
    return [index.byIata.get(queryUpper)];
  }

  if (/^[A-Z]{4}$/.test(queryUpper) && index.byIcao.has(queryUpper)) {
    return [index.byIcao.get(queryUpper)];
  }

  if (preferredIata && index.byIata.has(preferredIata)) {
    return [index.byIata.get(preferredIata)];
  }

  const strippedAliasIata = stripped && stripped !== query
    ? lookupAliasIata(stripped)
    : "";
  if (strippedAliasIata && index.byIata.has(strippedAliasIata)) {
    return [index.byIata.get(strippedAliasIata)];
  }

  if (queryNorm.length < 2) {
    return [];
  }

  const scored = [];
  for (const airport of index.rows) {
    const score = scoreAirportCandidate(queryNorm, queryUpper, airport, preferredIata);
    if (score <= 0) continue;
    scored.push({ airport, score });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (preferredIata) {
      const aPreferred = a.airport.iata === preferredIata ? 1 : 0;
      const bPreferred = b.airport.iata === preferredIata ? 1 : 0;
      if (aPreferred !== bPreferred) return bPreferred - aPreferred;
    }
    if (a.airport.cityNorm !== b.airport.cityNorm) {
      return a.airport.cityNorm.localeCompare(b.airport.cityNorm);
    }
    return a.airport.iata.localeCompare(b.airport.iata);
  });

  if (scored.length > 0) {
    return scored.slice(0, Math.max(1, limit)).map((item) => item.airport);
  }

  if (stripped && stripped !== query) {
    return searchAirportCandidates(stripped, limit);
  }

  return [];
}

function normalizeFallbackTerms(rawTerms) {
  const out = [];
  const seen = new Set();

  for (const term of rawTerms || []) {
    const cleaned = normalizeLocationInput(term);
    const normalized = normalizeSearchText(cleaned);
    if (!cleaned || normalized.length < 2 || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(cleaned);
  }

  return out;
}

async function getGeocodeFallbackTerms(query) {
  const normalizedQuery = normalizeLocationInput(query);
  if (!normalizedQuery || normalizedQuery.length < 2) return [];

  const cacheKey = toLowerSafe(normalizedQuery);
  const cached = geocodeFallbackCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs()) {
    return cached.terms;
  }

  const endpoint = new URL("https://nominatim.openstreetmap.org/search");
  endpoint.searchParams.set("q", normalizedQuery);
  endpoint.searchParams.set("format", "jsonv2");
  endpoint.searchParams.set("limit", "5");
  endpoint.searchParams.set("addressdetails", "1");
  endpoint.searchParams.set("accept-language", "en");

  try {
    const response = await fetchWithTimeout(endpoint.toString(), {
      headers: {
        accept: "application/json,text/plain,*/*"
      }
    });

    if (!response.ok) {
      geocodeFallbackCache.set(cacheKey, { terms: [], expiresAt: nowMs() + ONE_HOUR_MS });
      return [];
    }

    const payload = await response.json();
    const rawTerms = [];

    for (const row of Array.isArray(payload) ? payload : []) {
      const address = row?.address || {};
      rawTerms.push(
        row?.name,
        address.city,
        address.town,
        address.village,
        address.municipality,
        address.county,
        address.state,
        address.country
      );

      const display = String(row?.display_name || "").split(",").map((item) => item.trim());
      rawTerms.push(display[0], display[1]);
    }

    const terms = normalizeFallbackTerms(rawTerms).slice(0, 8);
    geocodeFallbackCache.set(cacheKey, { terms, expiresAt: nowMs() + ONE_DAY_MS });
    return terms;
  } catch {
    geocodeFallbackCache.set(cacheKey, { terms: [], expiresAt: nowMs() + ONE_HOUR_MS });
    return [];
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "user-agent": "seat-advisor/1.0 (+local-app)",
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    return null;
  }

  return response.text();
}

function normalizeAircraftCode(rawCode) {
  return String(rawCode || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function getAircraftHintByCode(rawCode) {
  const code = normalizeAircraftCode(rawCode);
  if (!code) return null;

  if (AIRCRAFT_CODE_HINTS[code]) return AIRCRAFT_CODE_HINTS[code];

  if (/^73[0-9A-Z]/.test(code) || /^B73/.test(code)) {
    return { slug: "boeing-737-800", model: "Boeing 737 family" };
  }

  if (/^32[0-9A-Z]/.test(code) || /^A32/.test(code)) {
    return { slug: "airbus-a320", model: "Airbus A320 family" };
  }

  if (/^77[0-9A-Z]/.test(code) || /^B77/.test(code)) {
    return { slug: "boeing-777", model: "Boeing 777 family" };
  }

  if (/^78[0-9A-Z]/.test(code) || /^B78/.test(code)) {
    return { slug: "boeing-787", model: "Boeing 787 family" };
  }

  return null;
}

function extractAssignedJsonValue(html, assignmentName, openingChar = "[") {
  const marker = `${assignmentName} =`;
  const startMarker = html.indexOf(marker);
  if (startMarker < 0) return null;

  const startBracket = html.indexOf(openingChar, startMarker + marker.length);
  if (startBracket < 0) return null;

  const closingChar = openingChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = startBracket; i < html.length; i += 1) {
    const ch = html[i];

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === "\\") {
        escaping = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === openingChar) {
      depth += 1;
      continue;
    }

    if (ch === closingChar) {
      depth -= 1;
      if (depth === 0) {
        return html.slice(startBracket, i + 1);
      }
    }
  }

  return null;
}

function extractAssignedJsonArray(html, assignmentName) {
  return extractAssignedJsonValue(html, assignmentName, "[");
}

function extractAssignedJsonObject(html, assignmentName) {
  return extractAssignedJsonValue(html, assignmentName, "{");
}

function parseFlightIdentFromHtml(html) {
  const compact = toUpperSafe(decodeHtmlEntities(stripTags(html))).replace(/\s+/g, "");
  if (!compact) return "";

  const match = compact.match(/[A-Z0-9]{4,}/);
  return match ? match[0] : "";
}

function parseFlightIdentParts(flightIdentRaw, fallbackIcao) {
  const flightIdent = toUpperSafe(flightIdentRaw).replace(/[^A-Z0-9]/g, "");
  const fallback = toUpperSafe(fallbackIcao);

  let airlineCode = "";
  let flightNumber = "";

  let match = flightIdent.match(/^([A-Z]{3})(\d{1,5}[A-Z]?)$/);
  if (match) {
    airlineCode = match[1];
    flightNumber = match[2];
  } else {
    match = flightIdent.match(/^([A-Z]{2})(\d{1,5}[A-Z]?)$/);
    if (match) {
      airlineCode = match[1];
      flightNumber = match[2];
    }
  }

  if (!airlineCode && fallback) {
    airlineCode = fallback;
  }

  if (!flightNumber) {
    const fallbackMatch = flightIdent.match(/(\d{1,5}[A-Z]?)$/);
    if (fallbackMatch) {
      flightNumber = fallbackMatch[1];
    }
  }

  const airlineIata = airlineCode.length === 2 ? airlineCode : (ICAO_TO_IATA[airlineCode] || "");
  const airlineIcao = airlineCode.length === 3 ? airlineCode : "";

  return {
    airlineIata,
    airlineIcao,
    flightNumber
  };
}

function extractAircraftCodeFromFriendlyName(text) {
  const raw = toUpperSafe(text);
  if (!raw) return "";

  if (/A321\s*NEO|A21N/.test(raw)) return "A21N";
  if (/A320\s*NEO|A20N/.test(raw)) return "A20N";
  if (/A321/.test(raw)) return "A321";
  if (/A320/.test(raw)) return "A320";
  if (/A319/.test(raw)) return "A319";
  if (/737\s*MAX\s*8|B38M/.test(raw)) return "B38M";
  if (/737[-\s]*900/.test(raw)) return "B739";
  if (/737[-\s]*800/.test(raw)) return "B738";
  if (/737[-\s]*700/.test(raw)) return "B737";
  if (/777[-\s]*300\s*ER/.test(raw)) return "B77W";
  if (/777/.test(raw)) return "B777";
  if (/787[-\s]*9/.test(raw)) return "B789";
  if (/787[-\s]*8/.test(raw)) return "B788";
  if (/787/.test(raw)) return "B787";
  if (/A350[-\s]*900/.test(raw)) return "A359";
  if (/A330[-\s]*300/.test(raw)) return "A333";
  if (/E190/.test(raw)) return "E190";
  if (/E195/.test(raw)) return "E195";
  if (/CRJ[-\s]*900/.test(raw)) return "CRJ9";
  if (/ATR[-\s]*72/.test(raw)) return "AT76";

  return "";
}

function normalizeFlightAwareRow(rawRow, uiRow, origin, destination) {
  const row = rawRow || {};
  const card = uiRow || {};

  const flightIdent = parseFlightIdentFromHtml(card.flightIdent);
  const parts = parseFlightIdentParts(flightIdent, row.prefix);
  if (!parts.flightNumber) {
    return null;
  }

  const airlineIata = parts.airlineIata || "";
  const airlineIcao = parts.airlineIcao || toUpperSafe(row.prefix);
  const flightCode = toUpperSafe(
    airlineIata ? `${airlineIata}${parts.flightNumber}` : `${airlineIcao}${parts.flightNumber}`
  );
  const aircraftCode = normalizeAircraftCode(
    card.aircraftType || extractAircraftCodeFromFriendlyName(row.aircrafttype_friendly)
  );
  const aircraftHint = getAircraftHintByCode(aircraftCode);

  const departureTime =
    row.sch_block_out ||
    row.filed_departuretime ||
    row.estimateddeparturetime ||
    row.est_block_out ||
    null;

  const arrivalTime =
    row.sch_block_in ||
    row.filed_arrivaltime ||
    row.estimatedarrivaltime ||
    row.est_block_in ||
    null;

  return {
    airlineName: String(card.airlineName || row.operator || "").trim(),
    airlineIata,
    airlineIcao,
    flightNumber: parts.flightNumber,
    flightCode,
    departureIata: toUpperSafe(card.origin || origin),
    arrivalIata: toUpperSafe(card.destination || destination),
    departureTime,
    arrivalTime,
    flightStatus: stripTags(decodeHtmlEntities(card.flightStatus || row.status || "unknown")),
    aircraftCode,
    aircraftHint: aircraftHint?.model || String(row.aircrafttype_friendly || "").trim() || null,
    aircraftSlugHint: aircraftHint?.slug || null,
    raw: {
      source: "flightaware",
      registration: row.reg || null,
      routeDistanceNm: row.route_distance || null,
      prefix: row.prefix || null
    }
  };
}

function unixSecondsToIso(rawSeconds) {
  const seconds = Number(rawSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function normalizeTrackpollActivityRow(activityRow, flightNode, fallbackIdent) {
  const row = activityRow || {};
  const node = flightNode || {};
  const airline = node.airline || node.codeShare?.airline || {};

  const ident = toUpperSafe(row.displayIdent || row.ident || node.displayIdent || node.ident || fallbackIdent);
  const fallbackIcao = toUpperSafe(airline.icao);
  const parts = parseFlightIdentParts(ident, fallbackIcao);
  if (!parts.flightNumber) return null;

  const airlineIata = parts.airlineIata || toUpperSafe(airline.iata);
  const airlineIcao = parts.airlineIcao || fallbackIcao;
  const flightCode = toUpperSafe(
    airlineIata ? `${airlineIata}${parts.flightNumber}` : `${airlineIcao}${parts.flightNumber}`
  );

  const aircraftCode = normalizeAircraftCode(
    row.aircraftType ||
    node.aircraftType ||
    node.aircraft?.type ||
    extractAircraftCodeFromFriendlyName(row.aircraftTypeFriendly || node.aircraftTypeFriendly || node.aircraft?.friendlyType)
  );
  const aircraftHint = getAircraftHintByCode(aircraftCode);

  const departureTime = unixSecondsToIso(
    row.gateDepartureTimes?.scheduled ||
    row.takeoffTimes?.scheduled ||
    row.flightPlan?.departure ||
    row.gateDepartureTimes?.estimated ||
    row.takeoffTimes?.estimated ||
    row.gateDepartureTimes?.actual ||
    row.takeoffTimes?.actual
  );

  const arrivalTime = unixSecondsToIso(
    row.gateArrivalTimes?.scheduled ||
    row.landingTimes?.scheduled ||
    row.gateArrivalTimes?.estimated ||
    row.landingTimes?.estimated ||
    row.gateArrivalTimes?.actual ||
    row.landingTimes?.actual
  );

  if (!departureTime) return null;

  return {
    airlineName: String(airline.fullName || airline.shortName || node.friendlyIdent || "").trim(),
    airlineIata,
    airlineIcao,
    flightNumber: parts.flightNumber,
    flightCode,
    departureIata: toUpperSafe(row.origin?.iata || row.origin?.altIdent || node.origin?.iata || node.origin?.altIdent),
    arrivalIata: toUpperSafe(row.destination?.iata || row.destination?.altIdent || node.destination?.iata || node.destination?.altIdent),
    departureTime,
    arrivalTime,
    flightStatus: stripTags(decodeHtmlEntities(row.flightStatus || node.flightStatus || "unknown")),
    aircraftCode,
    aircraftHint: aircraftHint?.model || String(row.aircraftTypeFriendly || node.aircraftTypeFriendly || "").trim() || null,
    aircraftSlugHint: aircraftHint?.slug || null,
    raw: {
      source: "flightaware_trackpoll",
      registration: row.aircraft?.tail || node.aircraft?.tail || null,
      routeDistanceNm: row.flightPlan?.directDistance || node.flightPlan?.directDistance || null,
      prefix: airlineIcao || null,
      permaLink: row.permaLink || node.links?.permanent || null,
      flightId: row.flightId || node.flightId || null
    }
  };
}

function parseScheduleDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const matched = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (matched) {
    const [, y, m, d, hh, mm, ss = "00"] = matched;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)));
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatYmdUtc(date) {
  return date.toISOString().slice(0, 10);
}

function dedupeFlights(flights) {
  const seen = new Set();
  const unique = [];

  for (const flight of flights) {
    const depDateHour = (flight.departureTime || "").slice(0, 13);
    const key = `${flight.flightCode}|${depDateHour}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(flight);
  }

  return unique;
}

function isLowCostAirline(flight) {
  return LOW_COST_AIRLINE_IATA.has(flight.airlineIata) || LOW_COST_AIRLINE_ICAO.has(flight.airlineIcao);
}

function formatFlightAwareUrl(origin, destination) {
  const base = new URL("https://www.flightaware.com/live/findflight");
  base.searchParams.set("origin", origin);
  base.searchParams.set("destination", destination);
  return base.toString();
}

function formatFlightAwareFlightUrl(flightIdent) {
  const compact = toUpperSafe(flightIdent).replace(/[^A-Z0-9]/g, "");
  return `https://www.flightaware.com/live/flight/${compact}`;
}

function extractMetaTagContent(html, name, kind = "name") {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patternA = new RegExp(`<meta[^>]*\\b${kind}=["']${escaped}["'][^>]*\\bcontent=["']([^"']+)["'][^>]*>`, "i");
  const patternB = new RegExp(`<meta[^>]*\\bcontent=["']([^"']+)["'][^>]*\\b${kind}=["']${escaped}["'][^>]*>`, "i");
  const matched = html.match(patternA) || html.match(patternB);
  return matched ? decodeHtmlEntities(matched[1]).trim() : "";
}

function parseFlightQuery(rawFlight) {
  const compact = toUpperSafe(rawFlight).replace(/[^A-Z0-9]/g, "");
  if (!compact) {
    throw new Error("航班号为空，请输入如 CZ8581 / MU5101");
  }

  const parts = parseFlightIdentParts(compact, "");
  const flightNumber = parts.flightNumber || "";
  if (!flightNumber) {
    throw new Error(`无法识别航班号“${rawFlight}”，请使用“航司代码+数字”，例如 CZ8581。`);
  }

  return {
    input: String(rawFlight || "").trim(),
    normalized: compact,
    airlineIata: parts.airlineIata || "",
    airlineIcao: parts.airlineIcao || "",
    flightNumber
  };
}

function matchesFlightFilter(flight, filter) {
  if (!filter) return true;
  if (filter.flightNumber && String(flight.flightNumber || "") !== String(filter.flightNumber)) return false;
  if (filter.airlineIata && String(flight.airlineIata || "") !== String(filter.airlineIata)) return false;
  if (filter.airlineIcao && String(flight.airlineIcao || "") !== String(filter.airlineIcao)) return false;
  return true;
}

function resolveAirportTokenToIata(rawToken, airportIndex) {
  const compact = toUpperSafe(rawToken).replace(/[^A-Z0-9]/g, "");
  if (!compact) return null;

  if (/^[A-Z]{3}$/.test(compact)) {
    const airport = airportIndex.byIata.get(compact);
    return {
      iata: compact,
      icao: airport?.icao || "",
      matched: airport ? `${airport.city} - ${airport.name}`.trim() : compact
    };
  }

  if (/^[A-Z]{4}$/.test(compact)) {
    const airport = airportIndex.byIcao.get(compact);
    if (!airport) return null;
    return {
      iata: airport.iata,
      icao: compact,
      matched: `${airport.city} - ${airport.name}`.trim()
    };
  }

  return null;
}

function pickFirstResolvedAirport(refs, airportIndex) {
  for (const ref of refs) {
    const resolved = resolveAirportTokenToIata(ref, airportIndex);
    if (resolved) return resolved;
  }
  return null;
}

function resolveRouteFromTrackpollBootstrap(bootstrap, airportIndex) {
  const flightNodes = Object.values(bootstrap?.flights || {});
  for (const node of flightNodes) {
    const rows = Array.isArray(node?.activityLog?.flights) ? node.activityLog.flights : [];
    const candidates = [node, ...rows];

    for (const item of candidates) {
      const origin = pickFirstResolvedAirport([
        item?.origin?.iata,
        item?.origin?.altIdent,
        item?.origin?.icao,
        item?.origin,
        node?.origin?.iata,
        node?.origin?.altIdent,
        node?.origin?.icao,
        node?.origin
      ], airportIndex);

      const destination = pickFirstResolvedAirport([
        item?.destination?.iata,
        item?.destination?.altIdent,
        item?.destination?.icao,
        item?.destination,
        node?.destination?.iata,
        node?.destination?.altIdent,
        node?.destination?.icao,
        node?.destination
      ], airportIndex);

      if (!origin || !destination) continue;

      return {
        originIata: origin.iata,
        destinationIata: destination.iata,
        originIcao: origin.icao || "",
        destinationIcao: destination.icao || "",
        originMatched: origin.matched,
        destinationMatched: destination.matched
      };
    }
  }

  return null;
}

async function resolveRouteByFlightNumber(rawFlight) {
  const query = parseFlightQuery(rawFlight);
  const airportIndex = await getAirportIndex();
  const attempts = [query.normalized];
  if (query.airlineIata && !query.airlineIcao) {
    const fallbackIcao = IATA_TO_ICAO[query.airlineIata];
    if (fallbackIcao) {
      attempts.push(`${fallbackIcao}${query.flightNumber}`);
    }
  }

  let resolved = null;

  for (const ident of attempts) {
    const url = formatFlightAwareFlightUrl(ident);
    const html = await fetchText(url);
    if (!html) continue;

    const canonicalUrl = extractMetaTagContent(html, "og:url", "property") || url;
    const canonicalIdentMatch = canonicalUrl.match(/\/live\/flight\/([A-Z0-9]+)/i);
    const canonicalIdent = canonicalIdentMatch ? toUpperSafe(canonicalIdentMatch[1]) : ident;

    const metaOrigin = resolveAirportTokenToIata(extractMetaTagContent(html, "origin", "name"), airportIndex);
    const metaDestination = resolveAirportTokenToIata(extractMetaTagContent(html, "destination", "name"), airportIndex);

    let originIata = metaOrigin?.iata || "";
    let destinationIata = metaDestination?.iata || "";
    let originIcao = metaOrigin?.icao || "";
    let destinationIcao = metaDestination?.icao || "";
    let originMatched = metaOrigin?.matched || "";
    let destinationMatched = metaDestination?.matched || "";

    if (!originIata || !destinationIata) {
      const bootstrapText = extractAssignedJsonObject(html, "trackpollBootstrap");
      if (bootstrapText) {
        try {
          const bootstrap = JSON.parse(bootstrapText);
          const routeFromBootstrap = resolveRouteFromTrackpollBootstrap(bootstrap, airportIndex);
          if (routeFromBootstrap) {
            if (!originIata) {
              originIata = routeFromBootstrap.originIata;
              originIcao = routeFromBootstrap.originIcao;
              originMatched = routeFromBootstrap.originMatched;
            }
            if (!destinationIata) {
              destinationIata = routeFromBootstrap.destinationIata;
              destinationIcao = routeFromBootstrap.destinationIcao;
              destinationMatched = routeFromBootstrap.destinationMatched;
            }
          }
        } catch {
          // Ignore invalid bootstrap payload and continue with next attempt.
        }
      }
    }

    if (!originIata || !destinationIata) continue;

    resolved = {
      sourceUrl: canonicalUrl,
      canonicalFlightIdent: canonicalIdent,
      originIcao,
      destinationIcao,
      originIata,
      destinationIata,
      originMatched,
      destinationMatched
    };
    break;
  }

  if (!resolved) {
    throw new Error(`无法根据航班号“${query.normalized}”解析起降机场。`);
  }

  const parsedCanonical = parseFlightIdentParts(resolved.canonicalFlightIdent, "");
  if (!query.airlineIata && parsedCanonical.airlineIata) query.airlineIata = parsedCanonical.airlineIata;
  if (!query.airlineIcao && parsedCanonical.airlineIcao) query.airlineIcao = parsedCanonical.airlineIcao;
  if (!query.flightNumber && parsedCanonical.flightNumber) query.flightNumber = parsedCanonical.flightNumber;

  return {
    flightQuery: query,
    canonicalFlightIdent: resolved.canonicalFlightIdent,
    sourceUrl: resolved.sourceUrl,
    originIcao: resolved.originIcao,
    destinationIcao: resolved.destinationIcao,
    originIata: resolved.originIata,
    destinationIata: resolved.destinationIata,
    originMatched: resolved.originMatched || resolved.originIata,
    destinationMatched: resolved.destinationMatched || resolved.destinationIata
  };
}

function parseSearchApiLocalDateTime(dateRaw, timeRaw, fallbackDate) {
  const datePart = String(dateRaw || fallbackDate || "").trim();
  if (!datePart) return null;

  const rawTime = String(timeRaw || "").trim();
  const timeMatch = rawTime.match(/(\d{1,2}):(\d{2})/);
  if (!timeMatch) {
    return `${datePart}T00:00:00`;
  }

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return `${datePart}T00:00:00`;
  }

  if (/pm/i.test(rawTime) && hour < 12) hour += 12;
  if (/am/i.test(rawTime) && hour === 12) hour = 0;

  return `${datePart}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function normalizeSearchApiFlight(row, origin, destination, requestedDate) {
  const legs = Array.isArray(row?.flights) ? row.flights : [];
  const firstLeg = legs[0] || {};
  const lastLeg = legs[legs.length - 1] || firstLeg;

  const departureAirport = firstLeg?.departure_airport || {};
  const arrivalAirport = lastLeg?.arrival_airport || {};

  const departureIata = toUpperSafe(departureAirport?.id || origin);
  const arrivalIata = toUpperSafe(arrivalAirport?.id || destination);
  if (!departureIata || !arrivalIata) return null;

  const departureTime = parseSearchApiLocalDateTime(
    departureAirport?.date,
    departureAirport?.time,
    requestedDate
  );
  const arrivalTime = parseSearchApiLocalDateTime(
    arrivalAirport?.date || departureAirport?.date,
    arrivalAirport?.time,
    departureAirport?.date || requestedDate
  );
  if (!departureTime) return null;

  const rawIdent = toUpperSafe(String(firstLeg?.flight_number || "").replace(/\s+/g, ""));
  const identParts = parseFlightIdentParts(rawIdent, "");
  const airlineIata = identParts.airlineIata || "";
  const airlineIcao = identParts.airlineIcao || (airlineIata ? (IATA_TO_ICAO[airlineIata] || "") : "");
  const flightNumber = identParts.flightNumber || "";

  const fallbackCode = toUpperSafe((airlineIata || airlineIcao) + flightNumber);
  const fallbackHash = `${departureIata}${arrivalIata}${String(departureAirport?.time || "").replace(/[^0-9]/g, "")}`;
  const flightCode = rawIdent || fallbackCode || fallbackHash;

  const aircraftFriendly = String(firstLeg?.airplane || "").trim();
  const aircraftCode = normalizeAircraftCode(extractAircraftCodeFromFriendlyName(aircraftFriendly));
  const aircraftHint = getAircraftHintByCode(aircraftCode);

  return {
    airlineName: String(firstLeg?.airline || "").trim(),
    airlineIata,
    airlineIcao,
    flightNumber,
    flightCode,
    departureIata,
    arrivalIata,
    departureTime,
    arrivalTime,
    flightStatus: "scheduled",
    aircraftCode,
    aircraftHint: aircraftHint?.model || aircraftFriendly || null,
    aircraftSlugHint: aircraftHint?.slug || null,
    raw: {
      source: "searchapi_google_flights",
      price: row?.price ?? null,
      totalDurationMin: row?.total_duration ?? null,
      carbonKg: Number.isFinite(Number(row?.carbon_emissions?.this_flight))
        ? Number(row.carbon_emissions.this_flight) / 1000
        : null
    }
  };
}

async function fetchFlightsFromSearchApi(origin, destination, date) {
  if (!SEARCHAPI_KEY) {
    throw new Error("服务端缺少 SEARCHAPI_KEY，无法调用 SearchAPI 航班数据。");
  }

  const url = new URL(SEARCHAPI_URL);
  url.searchParams.set("engine", "google_flights");
  url.searchParams.set("flight_type", "one_way");
  url.searchParams.set("departure_id", origin);
  url.searchParams.set("arrival_id", destination);
  url.searchParams.set("outbound_date", date);
  url.searchParams.set("api_key", SEARCHAPI_KEY);

  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      accept: "application/json,text/plain,*/*"
    }
  });

  if (response.status === 401) {
    throw new Error("SearchAPI 鉴权失败（401），请检查 SEARCHAPI_KEY 是否有效。");
  }
  if (!response.ok) {
    throw new Error(`SearchAPI 请求失败: HTTP ${response.status}`);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`SearchAPI 响应解析失败: ${safeErrorMessage(error)}`);
  }

  if (payload?.error) {
    throw new Error(`SearchAPI 返回错误: ${String(payload.error)}`);
  }

  const rows = [
    ...(Array.isArray(payload?.best_flights) ? payload.best_flights : []),
    ...(Array.isArray(payload?.other_flights) ? payload.other_flights : [])
  ];

  const normalized = rows
    .map((row) => normalizeSearchApiFlight(row, origin, destination, date))
    .filter(Boolean);

  return dedupeFlights(normalized);
}

async function fetchFlightsFromFlightAwareRoute(origin, destination, date, options = {}) {
  const skipDateFilter = Boolean(options.skipDateFilter);
  const url = formatFlightAwareUrl(origin, destination);
  const html = await fetchText(url);
  if (!html) {
    throw new Error("FlightAware 航班页暂不可访问");
  }

  const flightsJsonText = extractAssignedJsonArray(html, "FA.findflight.flights");
  const cardsJsonText = extractAssignedJsonArray(html, "FA.findflight.resultsContent");
  if (!flightsJsonText || !cardsJsonText) {
    throw new Error("FlightAware 页面结构变更，未提取到航班数据");
  }

  let rawFlights;
  let rawCards;
  try {
    rawFlights = JSON.parse(flightsJsonText);
    rawCards = JSON.parse(cardsJsonText);
  } catch (error) {
    throw new Error(`FlightAware 数据解析失败: ${safeErrorMessage(error)}`);
  }

  const flatRows = [];
  for (const chunk of Array.isArray(rawFlights) ? rawFlights : []) {
    if (Array.isArray(chunk)) {
      for (const row of chunk) flatRows.push(row);
    } else if (chunk) {
      flatRows.push(chunk);
    }
  }

  const cards = Array.isArray(rawCards) ? rawCards : [];

  const normalized = flatRows
    .map((row, index) => normalizeFlightAwareRow(row, cards[index], origin, destination))
    .filter(Boolean);

  const deduped = dedupeFlights(normalized);
  if (skipDateFilter) return deduped;
  return deduped.filter((flight) => String(flight.departureTime || "").slice(0, 10) === date);
}

async function fetchFlights(origin, destination, date, options = {}) {
  const skipDateFilter = Boolean(options.skipDateFilter);

  try {
    const flights = await fetchFlightsFromSearchApi(origin, destination, date);
    if (skipDateFilter) return flights;
    return flights.filter((flight) => String(flight.departureTime || "").slice(0, 10) === date);
  } catch (error) {
    const fallback = await fetchFlightsFromFlightAwareRoute(origin, destination, date, options);
    return fallback.map((item) => ({
      ...item,
      raw: {
        ...(item.raw || {}),
        source: "flightaware"
      }
    }));
  }
}

function buildFlightIdentAttempts(flightLookup) {
  const attempts = [];
  const pushAttempt = (ident) => {
    const compact = toUpperSafe(ident).replace(/[^A-Z0-9]/g, "");
    if (!compact || attempts.includes(compact)) return;
    attempts.push(compact);
  };

  if (flightLookup?.canonicalFlightIdent) pushAttempt(flightLookup.canonicalFlightIdent);
  if (flightLookup?.flightQuery?.normalized) pushAttempt(flightLookup.flightQuery.normalized);
  if (flightLookup?.flightQuery?.airlineIcao && flightLookup?.flightQuery?.flightNumber) {
    pushAttempt(`${flightLookup.flightQuery.airlineIcao}${flightLookup.flightQuery.flightNumber}`);
  }
  if (flightLookup?.flightQuery?.airlineIata && flightLookup?.flightQuery?.flightNumber) {
    pushAttempt(`${flightLookup.flightQuery.airlineIata}${flightLookup.flightQuery.flightNumber}`);
  }

  return attempts;
}

async function fetchFlightsFromFlightPage(date, flightLookup) {
  const attempts = buildFlightIdentAttempts(flightLookup);
  if (!attempts.length) {
    return {
      flights: [],
      source: "flightaware_flight_page_trackpoll",
      sourceUrl: null,
      attemptedIdents: attempts
    };
  }

  for (const ident of attempts) {
    const url = formatFlightAwareFlightUrl(ident);
    const html = await fetchText(url);
    if (!html) continue;

    const bootstrapText = extractAssignedJsonObject(html, "trackpollBootstrap");
    if (!bootstrapText) continue;

    let bootstrap;
    try {
      bootstrap = JSON.parse(bootstrapText);
    } catch {
      continue;
    }

    const flightNodes = Object.values(bootstrap?.flights || {});
    if (!flightNodes.length) continue;

    const normalized = [];
    for (const node of flightNodes) {
      const logRows = Array.isArray(node?.activityLog?.flights) ? node.activityLog.flights : [];
      for (const row of logRows) {
        const normalizedRow = normalizeTrackpollActivityRow(row, node, ident);
        if (normalizedRow) normalized.push(normalizedRow);
      }

      const activeRow = normalizeTrackpollActivityRow(node, node, ident);
      if (activeRow) normalized.push(activeRow);
    }

    const filtered = dedupeFlights(normalized).filter((flight) => String(flight.departureTime || "").slice(0, 10) === date);
    if (filtered.length > 0) {
      return {
        flights: filtered,
        source: "flightaware_flight_page_trackpoll",
        sourceUrl: url,
        attemptedIdents: attempts
      };
    }
  }

  return {
    flights: [],
    source: "flightaware_flight_page_trackpoll",
    sourceUrl: formatFlightAwareFlightUrl(attempts[0]),
    attemptedIdents: attempts
  };
}

function buildRouteFallbackLookups(routeFlights, limit = 8) {
  const scored = new Map();

  for (const flight of routeFlights) {
    const iataIdent = toUpperSafe(flight.flightCode);
    const icaoIdent = toUpperSafe(
      flight.airlineIcao && flight.flightNumber
        ? `${flight.airlineIcao}${flight.flightNumber}`
        : (flight.raw?.prefix && flight.flightNumber ? `${flight.raw.prefix}${flight.flightNumber}` : "")
    );
    const number = String(flight.flightNumber || "");
    if (!number) continue;

    const key = `${iataIdent}|${icaoIdent}|${number}`;
    if (!scored.has(key)) {
      scored.set(key, {
        count: 0,
        latestDeparture: "",
        lookup: {
          canonicalFlightIdent: icaoIdent || iataIdent,
          flightQuery: {
            normalized: iataIdent || icaoIdent,
            airlineIata: toUpperSafe(flight.airlineIata),
            airlineIcao: toUpperSafe(flight.airlineIcao || flight.raw?.prefix),
            flightNumber: number
          }
        }
      });
    }

    const item = scored.get(key);
    item.count += 1;
    const dep = String(flight.departureTime || "");
    if (dep && dep > item.latestDeparture) item.latestDeparture = dep;
  }

  return Array.from(scored.values())
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return String(b.latestDeparture || "").localeCompare(String(a.latestDeparture || ""));
    })
    .slice(0, Math.max(1, limit))
    .map((item) => item.lookup);
}

async function fetchFlightsFromRouteCandidates({ origin, destination, date, routeFlights }) {
  const candidateLookups = buildRouteFallbackLookups(routeFlights, 8);
  if (!candidateLookups.length) {
    return {
      flights: [],
      source: "flightaware_route_candidates_trackpoll",
      sourceUrl: null,
      attemptedCandidates: 0
    };
  }

  const candidateResults = await mapWithConcurrency(candidateLookups, 3, async (lookup) => {
    try {
      return await fetchFlightsFromFlightPage(date, lookup);
    } catch {
      return null;
    }
  });

  const collected = [];
  let sourceUrl = null;

  for (const result of candidateResults) {
    if (!result || !Array.isArray(result.flights)) continue;
    if (!sourceUrl && result.sourceUrl) sourceUrl = result.sourceUrl;

    for (const flight of result.flights) {
      if (origin && toUpperSafe(flight.departureIata) !== toUpperSafe(origin)) continue;
      if (destination && toUpperSafe(flight.arrivalIata) !== toUpperSafe(destination)) continue;
      collected.push(flight);
    }
  }

  return {
    flights: dedupeFlights(collected),
    source: "flightaware_route_candidates_trackpoll",
    sourceUrl,
    attemptedCandidates: candidateLookups.length
  };
}

function inferFlightsFromRecentPattern({ routeFlights, existingFlights, targetDate }) {
  const target = parseScheduleDate(`${targetDate} 00:00:00`);
  if (!target) return [];

  const existingCodes = new Set((existingFlights || []).map((flight) => toUpperSafe(flight.flightCode)).filter(Boolean));

  const validRouteFlights = (routeFlights || []).filter((flight) => parseScheduleDate(flight.departureTime));
  if (!validRouteFlights.length) return [];

  const maxObservedDate = validRouteFlights
    .map((flight) => parseScheduleDate(flight.departureTime))
    .filter(Boolean)
    .reduce((acc, date) => (!acc || date > acc ? date : acc), null);
  if (!maxObservedDate) return [];

  const maxObservedDay = formatYmdUtc(maxObservedDate);
  const targetDay = formatYmdUtc(target);
  const globalDayDiff = Math.round((target.getTime() - Date.UTC(
    maxObservedDate.getUTCFullYear(),
    maxObservedDate.getUTCMonth(),
    maxObservedDate.getUTCDate()
  )) / ONE_DAY_MS);
  if (globalDayDiff <= 0 || globalDayDiff > 2) return [];

  const grouped = new Map();
  for (const flight of validRouteFlights) {
    const code = toUpperSafe(flight.flightCode);
    if (!code) continue;
    if (!grouped.has(code)) grouped.set(code, []);
    grouped.get(code).push(flight);
  }

  const inferred = [];

  for (const [code, flights] of grouped.entries()) {
    if (existingCodes.has(code)) continue;

    const depDates = flights
      .map((flight) => parseScheduleDate(flight.departureTime))
      .filter(Boolean)
      .sort((a, b) => b.getTime() - a.getTime());
    if (!depDates.length) continue;

    const latestForCode = depDates[0];
    const latestDay = formatYmdUtc(latestForCode);
    const codeDayDiff = Math.round((target.getTime() - Date.UTC(
      latestForCode.getUTCFullYear(),
      latestForCode.getUTCMonth(),
      latestForCode.getUTCDate()
    )) / ONE_DAY_MS);
    if (codeDayDiff <= 0 || codeDayDiff > 2) continue;

    const dateSet = new Set(depDates.map(formatYmdUtc));

    let streak = 0;
    const cursor = new Date(Date.UTC(
      latestForCode.getUTCFullYear(),
      latestForCode.getUTCMonth(),
      latestForCode.getUTCDate()
    ));

    while (dateSet.has(formatYmdUtc(cursor))) {
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    if (streak < 2) continue;

    const sourceFlight = flights
      .filter((flight) => formatYmdUtc(parseScheduleDate(flight.departureTime)) === latestDay)
      .sort((a, b) => String(b.departureTime || "").localeCompare(String(a.departureTime || "")))[0]
      || flights.sort((a, b) => String(b.departureTime || "").localeCompare(String(a.departureTime || "")))[0];

    const sourceDep = parseScheduleDate(sourceFlight.departureTime);
    if (!sourceDep) continue;
    const sourceArr = parseScheduleDate(sourceFlight.arrivalTime);
    const durationMs = sourceArr ? Math.max(0, sourceArr.getTime() - sourceDep.getTime()) : (2 * ONE_HOUR_MS + 30 * 60 * 1000);

    const inferredDep = new Date(sourceDep.getTime() + codeDayDiff * ONE_DAY_MS);
    const inferredArr = new Date(inferredDep.getTime() + durationMs);
    if (formatYmdUtc(inferredDep) !== targetDay) continue;

    inferred.push({
      ...sourceFlight,
      departureTime: inferredDep.toISOString(),
      arrivalTime: inferredArr.toISOString(),
      flightStatus: "scheduled (inferred)",
      raw: {
        ...(sourceFlight.raw || {}),
        source: "inferred_from_recent_pattern",
        inferred: true,
        inferredBy: `consecutive_${streak}_days`,
        inferredFromDate: latestDay
      }
    });
  }

  return dedupeFlights(inferred);
}

async function resolveToIata(rawInput) {
  const cleaned = normalizeLocationInput(rawInput);
  const stripped = stripCountryPrefix(cleaned);
  if (!cleaned) {
    throw new Error("城市/机场输入为空");
  }

  const upper = toUpperSafe(cleaned);
  if (/^[A-Z]{3}$/.test(upper)) {
    return {
      iata: upper,
      source: "iata_input",
      matched: cleaned
    };
  }

  if (/^[A-Z]{4}$/.test(upper)) {
    const candidatesByIcao = await searchAirportCandidates(cleaned, 1);
    if (candidatesByIcao.length > 0) {
      return {
        iata: candidatesByIcao[0].iata,
        source: "icao_input",
        matched: `${candidatesByIcao[0].city} ${candidatesByIcao[0].name}`.trim()
      };
    }
  }

  const bracketMatch = cleaned.match(/[（(]\s*([A-Za-z]{3})\s*[)）]/);
  if (bracketMatch) {
    return {
      iata: toUpperSafe(bracketMatch[1]),
      source: "bracket_iata",
      matched: cleaned
    };
  }

  const aliased = lookupAliasIata(cleaned);
  if (aliased) {
    return {
      iata: aliased,
      source: "alias_map",
      matched: cleaned
    };
  }

  if (stripped && stripped !== cleaned) {
    const strippedAlias = lookupAliasIata(stripped);
    if (strippedAlias) {
      return {
        iata: strippedAlias,
        source: "alias_map_country_stripped",
        matched: `${cleaned} -> ${stripped}`
      };
    }
  }

  const candidates = await searchAirportCandidates(cleaned, 3);
  if (candidates.length > 0) {
    const best = candidates[0];
    return {
      iata: best.iata,
      source: "global_airport_index",
      matched: `${best.city} - ${best.name}`.trim()
    };
  }

  const fallbackTerms = await getGeocodeFallbackTerms(cleaned);
  for (const term of fallbackTerms) {
    const fallbackCandidates = await searchAirportCandidates(term, 1);
    if (!fallbackCandidates.length) continue;
    const best = fallbackCandidates[0];
    return {
      iata: best.iata,
      source: "geocode_fallback",
      matched: `${term} -> ${best.city} - ${best.name}`.trim()
    };
  }

  throw new Error(`无法解析“${cleaned}”。请尝试“城市名(机场三字码)”格式，例如 London(LHR) 或 Tokyo(HND)。`);
}

async function getSeatmapsAirlineMap() {
  if (airlineMapCache.data && airlineMapCache.expiresAt > nowMs()) {
    return airlineMapCache.data;
  }

  const html = await fetchText("https://seatmaps.com/airlines/");
  if (!html) {
    throw new Error("SeatMaps airlines index is unavailable");
  }

  const map = new Map();
  const regex = /<a href="\/airlines\/([^"/]+)\/"[^>]*id="([^"]+)"[^>]*>([^<]+)<\/a>/gi;

  let match;
  while ((match = regex.exec(html))) {
    const slug = match[1];
    const code = toUpperSafe(match[2]);
    const displayName = decodeHtmlEntities(match[3]).trim();

    if (!code || code.length > 3) continue;

    if (!map.has(code)) {
      map.set(code, {
        slug,
        displayName
      });
    }
  }

  airlineMapCache.data = map;
  airlineMapCache.expiresAt = nowMs() + TWELVE_HOURS_MS;

  return map;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getAirlineFleet(airlineSlug) {
  const cached = airlineFleetCache.get(airlineSlug);
  if (cached && cached.expiresAt > nowMs()) {
    return cached.fleet;
  }

  const url = `https://seatmaps.com/airlines/${airlineSlug}/`;
  const html = await fetchText(url);
  if (!html) {
    airlineFleetCache.set(airlineSlug, {
      fleet: [],
      expiresAt: nowMs() + ONE_HOUR_MS
    });
    return [];
  }

  const fleet = [];
  const seen = new Set();

  const re = new RegExp(`<a href="/airlines/${escapeRegex(airlineSlug)}/([^"/]+)/"[^>]*title="([^"]+)"`, "gi");
  let m;
  while ((m = re.exec(html))) {
    const aircraftSlug = m[1];
    const title = decodeHtmlEntities(m[2]).trim();
    const key = `${aircraftSlug}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fleet.push({
      slug: aircraftSlug,
      title
    });
  }

  airlineFleetCache.set(airlineSlug, {
    fleet,
    expiresAt: nowMs() + SIX_HOURS_MS
  });

  return fleet;
}

function tokenSet(text) {
  const normalized = slugify(text).replace(/-/g, " ");
  return new Set(normalized.split(/\s+/).filter(Boolean));
}

function scoreFleetCandidate(flight, candidate) {
  let score = 0;
  const candidateSlug = candidate.slug;
  const candidateTokens = tokenSet(`${candidate.slug} ${candidate.title}`);

  if (flight.aircraftSlugHint && candidateSlug === flight.aircraftSlugHint) {
    score += 100;
  }

  const code = flight.aircraftCode;
  if (code && /737/.test(code) && candidateSlug.includes("737")) score += 20;
  if (code && /320|A32/.test(code) && candidateSlug.includes("a320")) score += 20;
  if (code && /321|A21/.test(code) && candidateSlug.includes("a321")) score += 20;
  if (code && /319/.test(code) && candidateSlug.includes("a319")) score += 20;
  if (code && /777/.test(code) && candidateSlug.includes("777")) score += 20;
  if (code && /787/.test(code) && candidateSlug.includes("787")) score += 20;

  if (flight.aircraftHint) {
    const hintTokens = tokenSet(flight.aircraftHint);
    for (const token of hintTokens) {
      if (candidateTokens.has(token)) score += 3;
    }
  }

  return score;
}

function chooseAircraftSlug(flight, fleet) {
  if (!Array.isArray(fleet) || fleet.length === 0) {
    return flight.aircraftSlugHint || null;
  }

  let best = null;
  let bestScore = -Infinity;

  for (const candidate of fleet) {
    const score = scoreFleetCandidate(flight, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (!best) return null;

  if (bestScore < 2 && flight.aircraftSlugHint) {
    return flight.aircraftSlugHint;
  }

  return best.slug;
}

function extractSeatmapIdsFromAircraftPage(html) {
  const ids = new Set();
  const patterns = [
    /data-seatmap-id="([a-z0-9_-]{8,})"/gi,
    /\/seatmaps\/([a-z0-9_-]{8,})\.html/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html))) {
      const id = String(match[1] || "").trim().toLowerCase();
      if (id) ids.add(id);
    }
  }

  return Array.from(ids);
}

function parseHtmlAttributes(tagText) {
  const attrs = {};
  const attrRegex = /([:@a-zA-Z0-9_-]+)="([^"]*)"/g;
  let match;

  while ((match = attrRegex.exec(tagText))) {
    attrs[match[1]] = decodeHtmlEntities(match[2]);
  }

  return attrs;
}

function extractSeatRowNumber(rowRaw, seatNumberRaw) {
  const rowByAttr = parseNumber(rowRaw);
  if (rowByAttr !== null && Number.isFinite(rowByAttr)) {
    return Math.max(0, Math.trunc(rowByAttr));
  }

  const seatMatch = String(seatNumberRaw || "").trim().toUpperCase().match(/^(\d{1,3})/);
  return seatMatch ? Number(seatMatch[1]) : null;
}

function parseSeatFeatures(rawFeatures) {
  const text = String(rawFeatures || "").trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        name: String(item?.name || "").trim(),
        value: String(item?.value || "").trim()
      }))
      .filter((item) => item.name);
  } catch {
    return [];
  }
}

function compareSeatLabels(a, b) {
  const pa = String(a || "").toUpperCase().match(/^(\d{1,3})([A-Z]+)?$/);
  const pb = String(b || "").toUpperCase().match(/^(\d{1,3})([A-Z]+)?$/);

  if (!pa && !pb) return String(a || "").localeCompare(String(b || ""));
  if (!pa) return 1;
  if (!pb) return -1;

  const rowDiff = Number(pa[1]) - Number(pb[1]);
  if (rowDiff !== 0) return rowDiff;

  return String(pa[2] || "").localeCompare(String(pb[2] || ""));
}

function extractSeatFeatureSummaryFromSeatmapHtml(html, seatmapId) {
  const seatTagRegex = /<div class="absolute comp-plane_seat[^>]*>/gi;
  const economyFeatureCounts = {};
  const economyExitRows = new Set();
  const economyExitSeats = new Set();

  let parsedSeatCount = 0;
  let parsedEconomySeatCount = 0;
  let match;

  while ((match = seatTagRegex.exec(html))) {
    const attrs = parseHtmlAttributes(match[0]);
    const seatNumber = String(attrs["data-number"] || "").trim().toUpperCase();
    const seatClass = String(attrs["data-class"] || "").trim().toUpperCase();
    const seatLabel = String(attrs["data-label"] || "").trim().toLowerCase();
    if (!seatNumber) continue;

    parsedSeatCount += 1;
    const isEconomySeat = seatClass === "E" || /economy/.test(seatLabel);
    if (!isEconomySeat) continue;
    parsedEconomySeatCount += 1;

    const rowNumber = extractSeatRowNumber(attrs["data-row-number"], seatNumber);
    const features = parseSeatFeatures(attrs["data-features"]);
    for (const feature of features) {
      const featureName = feature.name;
      economyFeatureCounts[featureName] = (economyFeatureCounts[featureName] || 0) + 1;

      if (featureName === "exitRow") {
        if (rowNumber !== null) economyExitRows.add(rowNumber);
        economyExitSeats.add(seatNumber);
      }
    }
  }

  return {
    seatmapId: String(seatmapId || "").trim().toLowerCase() || null,
    parsedSeatCount,
    parsedEconomySeatCount,
    featureCounts: economyFeatureCounts,
    exitRows: Array.from(economyExitRows).sort((a, b) => a - b),
    exitSeatNumbers: Array.from(economyExitSeats).sort(compareSeatLabels)
  };
}

function mergeSeatFeatureSummaries(summaries) {
  const rows = new Set();
  const seats = new Set();
  const featureCounts = {};
  const seatmapIds = [];
  let parsedSeatCount = 0;
  let parsedEconomySeatCount = 0;
  let parsedSeatmaps = 0;

  for (const summary of summaries) {
    if (!summary) continue;
    parsedSeatmaps += 1;
    if (summary.seatmapId) seatmapIds.push(summary.seatmapId);
    parsedSeatCount += Number(summary.parsedSeatCount || 0);
    parsedEconomySeatCount += Number(summary.parsedEconomySeatCount || 0);

    for (const row of Array.isArray(summary.exitRows) ? summary.exitRows : []) {
      rows.add(row);
    }

    for (const seat of Array.isArray(summary.exitSeatNumbers) ? summary.exitSeatNumbers : []) {
      seats.add(seat);
    }

    for (const [key, value] of Object.entries(summary.featureCounts || {})) {
      featureCounts[key] = (featureCounts[key] || 0) + Number(value || 0);
    }
  }

  return {
    seatmapIds: Array.from(new Set(seatmapIds)),
    parsedSeatmaps,
    parsedSeatCount,
    parsedEconomySeatCount,
    featureCounts,
    exitRows: Array.from(rows).sort((a, b) => a - b),
    exitSeatNumbers: Array.from(seats).sort(compareSeatLabels)
  };
}

async function getSeatmapDetailHtml(seatmapId) {
  const id = String(seatmapId || "").trim().toLowerCase();
  if (!id) return null;

  const cached = seatmapDetailCache.get(id);
  if (cached && cached.expiresAt > nowMs()) {
    return cached.html;
  }

  const url = `https://seatmaps.com/seatmaps/${id}.html?seatbar=hide&tooltip_on_hover=true`;
  const html = await fetchText(url);

  seatmapDetailCache.set(id, {
    html: html || null,
    expiresAt: nowMs() + (html ? SIX_HOURS_MS : ONE_HOUR_MS)
  });

  return html || null;
}

async function fetchSeatFeatureSummaryForSeatmapIds(seatmapIds) {
  const ids = Array.isArray(seatmapIds)
    ? seatmapIds.filter(Boolean).slice(0, 3)
    : [];
  if (ids.length === 0) return null;

  const summaries = await mapWithConcurrency(ids, 2, async (id) => {
    const html = await getSeatmapDetailHtml(id);
    if (!html) return null;
    return extractSeatFeatureSummaryFromSeatmapHtml(html, id);
  });

  const merged = mergeSeatFeatureSummaries(summaries.filter(Boolean));
  if (merged.parsedSeatmaps === 0) return null;
  return merged;
}

function extractSeatmapMetrics(html, sourceUrl) {
  const out = {
    sourceUrl,
    pitchIn: null,
    widthIn: null,
    reclineIn: null,
    reclineRaw: null,
    rating: null,
    summary: null,
    confidence: "low",
    seatmapIds: extractSeatmapIdsFromAircraftPage(html),
    exitRows: [],
    exitSeatNumbers: [],
    featureCounts: {},
    seatFeaturesConfidence: "low"
  };

  const ratingMatch = html.match(/class="rating-value">\s*([\d.]+)/i);
  if (ratingMatch) out.rating = Number(ratingMatch[1]);

  const summaryMatch = html.match(/<section class="aircraft-group-page__group-description">[\s\S]*?<div class="truncated"><div>([\s\S]*?)<\/div>/i);
  if (summaryMatch) {
    out.summary = stripTags(decodeHtmlEntities(summaryMatch[1]));
  }

  const economyMatch = html.match(/accordion-item__title">Economy<\/h2><\/dt><dd class="accordion-item__content">([\s\S]*?)<\/dd>/i);

  if (economyMatch) {
    const economy = economyMatch[1];
    const labelRegex = /<span class="item-label">\s*(Pitch|Width|Recline)\s*<\/span><span class="item-value">\s*([^<]+)\s*<\/span>/gi;
    const map = {};

    let m;
    while ((m = labelRegex.exec(economy))) {
      map[m[1].toLowerCase()] = decodeHtmlEntities(m[2]).trim();
    }

    out.pitchIn = parseInches(map.pitch);
    out.widthIn = parseInches(map.width);
    out.reclineRaw = map.recline || null;
    out.reclineIn = parseInches(map.recline);

    if (out.pitchIn !== null || out.widthIn !== null || out.reclineIn !== null) {
      out.confidence = "high";
    }
  }

  if (out.summary) {
    const pitchMatch = out.summary.match(/pitch\s+of\s+([\d.]+)\s*inches?/i);
    const widthMatch = out.summary.match(/width\s+of\s+([\d.]+)\s*inches?/i);
    const noRecline = /with\s+no\s+recline/i.test(out.summary);
    const reclineMatch = out.summary.match(/with\s+([\d.]+)\s*inches?\s+of\s+recline/i);

    if (pitchMatch && out.pitchIn === null) out.pitchIn = Number(pitchMatch[1]);
    if (widthMatch && out.widthIn === null) out.widthIn = Number(widthMatch[1]);
    if (noRecline) {
      out.reclineIn = 0;
      out.reclineRaw = "no recline";
    } else if (reclineMatch && out.reclineIn === null) {
      out.reclineIn = Number(reclineMatch[1]);
      out.reclineRaw = `${reclineMatch[1]}\"`;
    }

    if (out.pitchIn !== null || out.widthIn !== null || out.reclineIn !== null) {
      out.confidence = out.confidence === "high" ? "high" : "medium";
    }
  }

  return out;
}

async function getSeatmapMetrics(airlineSlug, aircraftSlug) {
  const pageUrl = `https://seatmaps.com/airlines/${airlineSlug}/${aircraftSlug}/`;
  const cached = seatmapMetricsCache.get(pageUrl);

  if (cached && cached.expiresAt > nowMs()) {
    return cached.metrics;
  }

  const html = await fetchText(pageUrl);
  if (!html) {
    seatmapMetricsCache.set(pageUrl, {
      metrics: null,
      expiresAt: nowMs() + ONE_HOUR_MS
    });
    return null;
  }

  const metrics = extractSeatmapMetrics(html, pageUrl);
  const seatFeatureSummary = await fetchSeatFeatureSummaryForSeatmapIds(metrics?.seatmapIds || []);
  if (seatFeatureSummary) {
    metrics.exitRows = seatFeatureSummary.exitRows;
    metrics.exitSeatNumbers = seatFeatureSummary.exitSeatNumbers.slice(0, 18);
    metrics.featureCounts = seatFeatureSummary.featureCounts;
    metrics.seatmapIds = seatFeatureSummary.seatmapIds.length
      ? seatFeatureSummary.seatmapIds
      : metrics.seatmapIds;
    metrics.seatFeaturesConfidence = "high";
  }

  seatmapMetricsCache.set(pageUrl, {
    metrics,
    expiresAt: nowMs() + SIX_HOURS_MS
  });

  return metrics;
}

function formatAerolopaAirlineApiUrl(airlineCode) {
  const code = toLowerSafe(airlineCode).replace(/[^a-z0-9]/g, "");
  return `https://www.aerolopa.com/dummyversion/v1/airlines/${code}`;
}

function formatAerolopaAircraftApiUrl(aircraftCode) {
  return `https://www.aerolopa.com/dummyversion/v1/aircraft/${aircraftCode}`;
}

function formatAerolopaAircraftPageUrl(aircraftCode) {
  return `https://www.aerolopa.com/${aircraftCode}`;
}

function normalizeAerolopaAircraftCandidate(raw) {
  const item = raw || {};
  const code = String(item.aircraft_code || "").trim();
  const codeDisplayed = String(item.aircraft_code_displayed || "").trim();
  const typeDisplayed = String(item.aircraft_type_displayed || "").trim();
  const optionalText = String(item.optional_text || "").trim();

  return {
    code,
    codeDisplayed,
    codeDisplayedNorm: normalizeAircraftCode(codeDisplayed),
    typeDisplayed,
    typeNorm: slugify(typeDisplayed),
    optionalText,
    seats: {
      f: Number(item.f_seats || 0) || 0,
      j: Number(item.j_seats || 0) || 0,
      w: Number(item.w_seats || 0) || 0,
      m: Number(item.m_seats || 0) || 0
    }
  };
}

async function getAerolopaAirlineFleet(airlineCode) {
  const normalized = toLowerSafe(airlineCode).replace(/[^a-z0-9]/g, "");
  if (!normalized) return [];

  const cached = aerolopaAirlineFleetCache.get(normalized);
  if (cached && cached.expiresAt > nowMs()) {
    return cached.fleet;
  }

  const response = await fetchWithTimeout(formatAerolopaAirlineApiUrl(normalized), {
    headers: {
      accept: "application/json,text/plain,*/*"
    }
  });

  if (!response.ok) {
    aerolopaAirlineFleetCache.set(normalized, {
      fleet: [],
      expiresAt: nowMs() + ONE_HOUR_MS
    });
    return [];
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    aerolopaAirlineFleetCache.set(normalized, {
      fleet: [],
      expiresAt: nowMs() + ONE_HOUR_MS
    });
    return [];
  }

  const fleet = [];
  const seen = new Set();
  const bodies = Array.isArray(payload?.bodies) ? payload.bodies : [];
  for (const body of bodies) {
    const aircrafts = Array.isArray(body?.aircrafts) ? body.aircrafts : [];
    for (const aircraft of aircrafts) {
      const candidate = normalizeAerolopaAircraftCandidate(aircraft);
      if (!candidate.code) continue;
      if (seen.has(candidate.code)) continue;
      seen.add(candidate.code);
      fleet.push(candidate);
    }
  }

  aerolopaAirlineFleetCache.set(normalized, {
    fleet,
    expiresAt: nowMs() + SIX_HOURS_MS
  });

  return fleet;
}

function scoreAerolopaFleetCandidate(flight, candidate) {
  let score = 0;
  const aircraftCode = normalizeAircraftCode(flight.aircraftCode);
  const codeDisplayed = candidate.codeDisplayedNorm;
  const candidateText = `${candidate.code} ${candidate.codeDisplayed} ${candidate.typeDisplayed} ${candidate.optionalText}`.trim();
  const candidateTokens = tokenSet(candidateText);

  if (aircraftCode && codeDisplayed) {
    if (aircraftCode === codeDisplayed) score += 120;
    if (aircraftCode.endsWith(codeDisplayed)) score += 100;
    if (codeDisplayed.endsWith(aircraftCode)) score += 90;
    if (aircraftCode.includes(codeDisplayed) || codeDisplayed.includes(aircraftCode)) score += 65;
  }

  const hintByCode = getAircraftHintByCode(aircraftCode);
  if (hintByCode?.model) {
    const hintTokens = tokenSet(hintByCode.model);
    for (const token of hintTokens) {
      if (candidateTokens.has(token)) score += 4;
    }
  }

  if (flight.aircraftHint) {
    const hintTokens = tokenSet(flight.aircraftHint);
    for (const token of hintTokens) {
      if (candidateTokens.has(token)) score += 2;
    }
  }

  return score;
}

function chooseAerolopaAircraftCode(flight, fleet) {
  if (!Array.isArray(fleet) || fleet.length === 0) return null;

  let best = null;
  let bestScore = -Infinity;
  for (const candidate of fleet) {
    const score = scoreAerolopaFleetCandidate(flight, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (!best || bestScore < 6) return null;
  return best.code;
}

async function getAerolopaAircraftDetails(aircraftCode) {
  const key = String(aircraftCode || "").trim();
  if (!key) return null;

  const cached = aerolopaAircraftCache.get(key);
  if (cached && cached.expiresAt > nowMs()) {
    return cached.details;
  }

  const response = await fetchWithTimeout(formatAerolopaAircraftApiUrl(key), {
    method: "POST",
    headers: {
      accept: "application/json,text/plain,*/*",
      "content-type": "application/json"
    },
    body: JSON.stringify({ token: "" })
  });

  if (!response.ok) {
    aerolopaAircraftCache.set(key, {
      details: null,
      expiresAt: nowMs() + ONE_HOUR_MS
    });
    return null;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    aerolopaAircraftCache.set(key, {
      details: null,
      expiresAt: nowMs() + ONE_HOUR_MS
    });
    return null;
  }

  if (!payload || payload.message) {
    aerolopaAircraftCache.set(key, {
      details: null,
      expiresAt: nowMs() + ONE_HOUR_MS
    });
    return null;
  }

  aerolopaAircraftCache.set(key, {
    details: payload,
    expiresAt: nowMs() + SIX_HOURS_MS
  });

  return payload;
}

function extractAerolopaEconomyMetrics(details) {
  if (!details || typeof details !== "object") return null;
  const cabins = Array.isArray(details.cabin_list) ? details.cabin_list : [];
  const cabinByType = new Map();
  for (const cabin of cabins) {
    const type = toUpperSafe(cabin?.cabin_type);
    if (type && !cabinByType.has(type)) {
      cabinByType.set(type, cabin);
    }
  }

  let economyCabin = cabinByType.get("M") || null;
  if (!economyCabin && cabins.length > 0) {
    economyCabin = cabins
      .slice()
      .sort((a, b) => (Number(b?.num_seats || 0) || 0) - (Number(a?.num_seats || 0) || 0))[0];
  }

  const seatsByCabin = {
    f: Number(cabinByType.get("F")?.num_seats || 0) || 0,
    j: Number(cabinByType.get("J")?.num_seats || 0) || 0,
    w: Number(cabinByType.get("W")?.num_seats || 0) || 0,
    m: Number(cabinByType.get("M")?.num_seats || 0) || 0
  };

  const pitchIn = parseInches(economyCabin?.pitch);
  const widthIn = parseInches(economyCabin?.width);
  const reclineIn = parseInches(economyCabin?.recline);
  const reclineRaw = String(economyCabin?.recline || "").trim() || null;
  const rows = String(economyCabin?.rows || "").trim() || null;
  const summary = stripTags(String(details?.description || "").trim());
  const hasOnlySummary = pitchIn === null && widthIn === null && reclineIn === null;
  const confidence = hasOnlySummary ? "low" : "medium";

  return {
    sourceUrl: formatAerolopaAircraftPageUrl(details.aircraft_code || ""),
    apiUrl: formatAerolopaAircraftApiUrl(details.aircraft_code || ""),
    aircraftCode: String(details.aircraft_code || "").trim() || null,
    aircraftType: String(details.aircraft_type_displayed || details.aircraft_type || "").trim() || null,
    publicationDate: String(details.publication_date || "").trim() || null,
    haulType: String(details.haul_type || "").trim() || null,
    svgUrl: String(details.svg_url || "").trim() || null,
    pitchIn,
    widthIn,
    reclineIn,
    reclineRaw,
    rows,
    seatsByCabin,
    summary: summary || null,
    confidence,
    guestLimited: hasOnlySummary
  };
}

function mergeSeatMetrics(seatmapsMetrics, aerolopaMetrics) {
  if (!seatmapsMetrics && !aerolopaMetrics) return null;

  const merged = {
    sourceUrl: seatmapsMetrics?.sourceUrl || null,
    confidence: seatmapsMetrics?.confidence || "low",
    pitchIn: seatmapsMetrics?.pitchIn ?? null,
    widthIn: seatmapsMetrics?.widthIn ?? null,
    reclineIn: seatmapsMetrics?.reclineIn ?? null,
    reclineRaw: seatmapsMetrics?.reclineRaw || null,
    rating: seatmapsMetrics?.rating ?? null,
    summary: seatmapsMetrics?.summary || null,
    seatmapIds: Array.isArray(seatmapsMetrics?.seatmapIds) ? seatmapsMetrics.seatmapIds : [],
    exitRows: Array.isArray(seatmapsMetrics?.exitRows) ? seatmapsMetrics.exitRows : [],
    exitSeatNumbers: Array.isArray(seatmapsMetrics?.exitSeatNumbers) ? seatmapsMetrics.exitSeatNumbers : [],
    featureCounts: seatmapsMetrics?.featureCounts || {},
    seatFeaturesConfidence: seatmapsMetrics?.seatFeaturesConfidence || "low",
    sources: ["seatmaps"]
  };

  if (aerolopaMetrics) {
    merged.sources.push("aerolopa");
    if (merged.pitchIn === null && aerolopaMetrics.pitchIn !== null) merged.pitchIn = aerolopaMetrics.pitchIn;
    if (merged.widthIn === null && aerolopaMetrics.widthIn !== null) merged.widthIn = aerolopaMetrics.widthIn;
    if (merged.reclineIn === null && aerolopaMetrics.reclineIn !== null) merged.reclineIn = aerolopaMetrics.reclineIn;
    if (!merged.reclineRaw && aerolopaMetrics.reclineRaw) merged.reclineRaw = aerolopaMetrics.reclineRaw;
    if (!merged.summary && aerolopaMetrics.summary) merged.summary = aerolopaMetrics.summary;

    if (merged.confidence === "low" && aerolopaMetrics.confidence === "medium") {
      merged.confidence = "medium";
    }
  }

  if (!seatmapsMetrics && aerolopaMetrics) {
    merged.sourceUrl = aerolopaMetrics.sourceUrl || null;
  }

  return merged;
}

function evaluateSlimlineSeatRisk(metrics) {
  const out = {
    level: "unknown",
    score: 0,
    label: "未知（数据不足）",
    reason: "缺少可用于判断超薄座椅的公开字段",
    indicators: []
  };

  if (!metrics) return out;

  let riskScore = 0;
  const indicators = [];
  const summaryText = `${metrics.summary || ""} ${metrics.reclineRaw || ""}`.toLowerCase();

  if (/(slimline|slim line|slim\s*seat|thin\s*seat|ultra[-\s]?thin|超薄|薄座椅|轻薄座椅)/i.test(summaryText)) {
    riskScore += 4.2;
    indicators.push("公开文案提到 slimline/超薄座椅关键词");
  }

  if (metrics.pitchIn !== null && metrics.pitchIn <= 29) {
    riskScore += 1.6;
    indicators.push(`座椅间距 ${metrics.pitchIn}" 偏小`);
  }

  if (metrics.widthIn !== null && metrics.widthIn <= 17) {
    riskScore += 1.2;
    indicators.push(`座椅宽度 ${metrics.widthIn}" 偏窄`);
  }

  if (metrics.reclineIn !== null && metrics.reclineIn <= 2) {
    riskScore += 1.1;
    indicators.push(`后仰 ${metrics.reclineIn}" 偏小`);
  }

  const limitedReclineCount = Number(metrics.featureCounts?.limitedRecline || 0);
  const doNotReclineCount = Number(metrics.featureCounts?.doNotRecline || 0);
  if (limitedReclineCount + doNotReclineCount >= 6) {
    riskScore += 1.0;
    indicators.push(`座位图中受限后仰座位 ${limitedReclineCount + doNotReclineCount} 个`);
  }

  const hasSignal = indicators.length > 0;
  if (!hasSignal) {
    if (metrics.pitchIn !== null || metrics.widthIn !== null || metrics.reclineIn !== null || metrics.summary) {
      out.level = "low";
      out.label = "低风险（未发现明显超薄信号）";
      out.reason = "当前公开参数未出现明显超薄座椅特征";
    }
    return out;
  }

  const roundedScore = Number(riskScore.toFixed(2));
  if (riskScore >= 4.0) {
    out.level = "high";
    out.label = "高风险（疑似超薄座椅）";
  } else if (riskScore >= 2.2) {
    out.level = "medium";
    out.label = "中风险（建议复核）";
  } else {
    out.level = "low";
    out.label = "低风险（未发现明显超薄信号）";
  }

  out.score = roundedScore;
  out.reason = indicators.join("；");
  out.indicators = indicators;
  return out;
}

function toRadians(deg) {
  return deg * Math.PI / 180;
}

function toDegrees(rad) {
  return rad * 180 / Math.PI;
}

function normalizeDegrees(deg) {
  let value = Number(deg) || 0;
  while (value < 0) value += 360;
  while (value >= 360) value -= 360;
  return value;
}

function normalizeSignedDegrees(deg) {
  let value = normalizeDegrees(deg);
  if (value > 180) value -= 360;
  return value;
}

function bearingToDirectionLabel(bearing) {
  const b = normalizeDegrees(bearing);
  if (b >= 22.5 && b < 67.5) return "东北向";
  if (b >= 67.5 && b < 112.5) return "东向";
  if (b >= 112.5 && b < 157.5) return "东南向";
  if (b >= 157.5 && b < 202.5) return "南向";
  if (b >= 202.5 && b < 247.5) return "西南向";
  if (b >= 247.5 && b < 292.5) return "西向";
  if (b >= 292.5 && b < 337.5) return "西北向";
  return "北向";
}

function calculateInitialBearing(lat1, lon1, lat2, lon2) {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const lambda1 = toRadians(lon1);
  const lambda2 = toRadians(lon2);
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  return normalizeDegrees(toDegrees(Math.atan2(y, x)));
}

function calculateSolarPosition(date, latDeg, lonDeg) {
  const utcTime = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(utcTime.getTime())) return null;

  const jd = utcTime.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = normalizeDegrees(280.46 + 0.9856474 * n);
  const g = normalizeDegrees(357.528 + 0.9856003 * n);
  const lambda = normalizeDegrees(L + 1.915 * Math.sin(toRadians(g)) + 0.02 * Math.sin(toRadians(2 * g)));
  const epsilon = 23.439 - 0.0000004 * n;

  const alpha = normalizeDegrees(toDegrees(Math.atan2(
    Math.cos(toRadians(epsilon)) * Math.sin(toRadians(lambda)),
    Math.cos(toRadians(lambda))
  )));
  const delta = toDegrees(Math.asin(Math.sin(toRadians(epsilon)) * Math.sin(toRadians(lambda))));

  const gmst = normalizeDegrees(280.46061837 + 360.98564736629 * (jd - 2451545.0));
  const lst = normalizeDegrees(gmst + lonDeg);
  const hourAngle = normalizeSignedDegrees(lst - alpha);

  const latRad = toRadians(latDeg);
  const decRad = toRadians(delta);
  const hRad = toRadians(hourAngle);

  const elevation = toDegrees(Math.asin(
    Math.sin(latRad) * Math.sin(decRad) +
    Math.cos(latRad) * Math.cos(decRad) * Math.cos(hRad)
  ));

  const azimuth = normalizeDegrees(toDegrees(Math.atan2(
    Math.sin(hRad),
    Math.cos(hRad) * Math.sin(latRad) - Math.tan(decRad) * Math.cos(latRad)
  )) + 180);

  return {
    azimuthDeg: Number(azimuth.toFixed(1)),
    elevationDeg: Number(elevation.toFixed(1))
  };
}

function calculateWindowAdvice(flight, airportByIata) {
  const origin = airportByIata.get(toUpperSafe(flight.departureIata));
  const destination = airportByIata.get(toUpperSafe(flight.arrivalIata));
  const departure = parseScheduleDate(flight.departureTime);

  if (!origin || !destination || origin.lat === null || origin.lon === null || destination.lat === null || destination.lon === null || !departure) {
    return {
      confidence: "low",
      routeDirection: null,
      routeBearingDeg: null,
      sunAzimuthDeg: null,
      sunElevationDeg: null,
      sunSide: null,
      scenicSide: null,
      shadeSide: null,
      scenicSideLabel: "未知",
      shadeSideLabel: "未知",
      summary: "缺少起降机场坐标或起飞时刻，暂无法判断左右舷日照与窗景侧。",
      reasons: ["建议在值机时优先选靠窗并查看 AeroLOPA 座舱图实时确认。"]
    };
  }

  const bearing = calculateInitialBearing(origin.lat, origin.lon, destination.lat, destination.lon);
  const routeDirection = bearingToDirectionLabel(bearing);
  const solar = calculateSolarPosition(departure, origin.lat, origin.lon);
  if (!solar) {
    return {
      confidence: "low",
      routeDirection,
      routeBearingDeg: Number(bearing.toFixed(1)),
      sunAzimuthDeg: null,
      sunElevationDeg: null,
      sunSide: null,
      scenicSide: null,
      shadeSide: null,
      scenicSideLabel: "未知",
      shadeSideLabel: "未知",
      summary: "太阳方位估算失败，暂无法给出左右舷建议。",
      reasons: ["建议在值机时优先选靠窗并查看 AeroLOPA 座舱图实时确认。"]
    };
  }

  const relative = normalizeSignedDegrees(solar.azimuthDeg - bearing);
  let sunSide = null;
  if (solar.elevationDeg > -1) {
    if (Math.abs(relative) > 12 && Math.abs(relative) < 168) {
      sunSide = relative > 0 ? "right" : "left";
    }
  }

  let scenicSide = null;
  let shadeSide = null;
  let summary = "";
  const reasons = [
    `航向约 ${bearing.toFixed(0)}°（${routeDirection}）`,
    `起飞时太阳方位约 ${solar.azimuthDeg.toFixed(0)}°，高度角约 ${solar.elevationDeg.toFixed(0)}°`
  ];

  if (solar.elevationDeg <= -1) {
    summary = "起飞时接近日落/夜间，左右舷日照差异较小，可优先按转机便利或机翼遮挡区避让选座。";
    reasons.push("当前太阳高度较低，窗景光照差异不明显");
  } else if (sunSide === "left" || sunSide === "right") {
    scenicSide = sunSide;
    shadeSide = sunSide === "left" ? "right" : "left";
    summary = `观景优先建议选${scenicSide === "left" ? "左侧" : "右侧"}窗（顺光），防晒休息建议选${shadeSide === "left" ? "左侧" : "右侧"}窗（背光）。`;
    reasons.push(`太阳主要位于航向${sunSide === "left" ? "左侧" : "右侧"}`);
  } else {
    summary = "太阳大致位于航向前后方，左右舷差异较小，可优先按机翼遮挡和前后间距选座。";
    reasons.push("太阳与航向接近同向或反向，左右舷差异有限");
  }

  return {
    confidence: solar.elevationDeg > -1 ? "medium" : "low",
    routeDirection,
    routeBearingDeg: Number(bearing.toFixed(1)),
    sunAzimuthDeg: solar.azimuthDeg,
    sunElevationDeg: solar.elevationDeg,
    sunSide,
    scenicSide,
    shadeSide,
    scenicSideLabel: scenicSide === "left" ? "左侧" : scenicSide === "right" ? "右侧" : "差异不明显",
    shadeSideLabel: shadeSide === "left" ? "左侧" : shadeSide === "right" ? "右侧" : "差异不明显",
    summary,
    reasons
  };
}

function scoreComfort(metrics, slimlineRisk = null) {
  if (!metrics) {
    return {
      score: 0,
      level: "数据不足",
      advice: "SeatMaps 未匹配到该航班机型页面，建议人工复核。",
      reasons: ["未获取到 SeatMaps 机型参数"]
    };
  }

  let score = 0;
  const reasons = [];

  if (metrics.pitchIn !== null) {
    if (metrics.pitchIn >= 32) {
      score += 2.2;
      reasons.push(`前后间距 ${metrics.pitchIn}\"，相对宽敞`);
    } else if (metrics.pitchIn >= 30) {
      score += 1.2;
      reasons.push(`前后间距 ${metrics.pitchIn}\"，中等`);
    } else {
      score -= 1.0;
      reasons.push(`前后间距 ${metrics.pitchIn}\"，偏紧凑`);
    }
  } else {
    reasons.push("未获取到前后间距");
  }

  if (metrics.widthIn !== null) {
    if (metrics.widthIn >= 18) {
      score += 1.8;
      reasons.push(`座椅宽度 ${metrics.widthIn}\"，偏宽`);
    } else if (metrics.widthIn >= 17) {
      score += 1.0;
      reasons.push(`座椅宽度 ${metrics.widthIn}\"，常规`);
    } else {
      score -= 0.8;
      reasons.push(`座椅宽度 ${metrics.widthIn}\"，偏窄`);
    }
  } else {
    reasons.push("未获取到座椅宽度");
  }

  if (metrics.reclineIn !== null) {
    if (metrics.reclineIn <= 0) {
      score -= 1.4;
      reasons.push("座椅不可后仰或接近不可后仰");
    } else if (metrics.reclineIn >= 3) {
      score += 0.6;
      reasons.push(`后仰约 ${metrics.reclineIn}\"`);
    } else {
      reasons.push(`后仰约 ${metrics.reclineIn}\"`);
    }
  } else if (metrics.reclineRaw) {
    reasons.push(`后仰信息：${metrics.reclineRaw}`);
  } else {
    reasons.push("未获取到后仰信息");
  }

  if (typeof metrics.rating === "number" && Number.isFinite(metrics.rating)) {
    if (metrics.rating >= 4) {
      score += 0.8;
      reasons.push(`SeatMaps 评分 ${metrics.rating.toFixed(2)}`);
    } else if (metrics.rating <= 2.5) {
      score -= 0.5;
      reasons.push(`SeatMaps 评分 ${metrics.rating.toFixed(2)}，口碑偏弱`);
    }
  }

  const risk = slimlineRisk || evaluateSlimlineSeatRisk(metrics);
  if (risk.level === "high") {
    score -= 0.9;
    reasons.push(`超薄座椅风险高：${risk.reason}`);
  } else if (risk.level === "medium") {
    score -= 0.4;
    reasons.push(`超薄座椅风险中：${risk.reason}`);
  } else if (risk.level === "low") {
    reasons.push(`超薄座椅风险低：${risk.reason}`);
  } else {
    reasons.push(`超薄座椅风险未知：${risk.reason}`);
  }

  if (Array.isArray(metrics.exitRows) && metrics.exitRows.length > 0) {
    const rowsText = metrics.exitRows.join("、");
    const seatExamples = Array.isArray(metrics.exitSeatNumbers)
      ? metrics.exitSeatNumbers.slice(0, 8).join(" / ")
      : "";
    reasons.push(seatExamples
      ? `安全出口排：${rowsText} 排（示例座位 ${seatExamples}）`
      : `安全出口排：${rowsText} 排`);
  } else {
    reasons.push("未解析到安全出口排座位标注");
  }

  let level = "偏拥挤风险";
  if (score >= 3.6) {
    level = "较宽敞";
  } else if (score >= 2.0) {
    level = "中等可接受";
  }

  const hardRisk = metrics.reclineIn === 0
    || (metrics.pitchIn !== null && metrics.pitchIn < 30)
    || (metrics.widthIn !== null && metrics.widthIn < 17)
    || risk.level === "high";
  const advice = hardRisk
    ? "建议规避：该配置触发窄间距/窄座宽/不可后仰或超薄座椅风险。"
    : "可考虑：当前参数未触发明显狭小风险。";

  return {
    score: Number(score.toFixed(2)),
    level,
    advice,
    reasons
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;

      try {
        results[current] = await worker(items[current], current);
      } catch (error) {
        results[current] = {
          error: safeErrorMessage(error)
        };
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => run());
  await Promise.all(workers);
  return results;
}

async function enrichFlightWithSeatmaps(flight, airlineMap, airportByIata) {
  const airlineFromMap = airlineMap.get(flight.airlineIata);
  const airlineSlug = airlineFromMap?.slug || `${toLowerSafe(flight.airlineIata)}-${slugify(flight.airlineName || "airline")}`;

  const fleet = await getAirlineFleet(airlineSlug);
  const chosenAircraftSlug = chooseAircraftSlug(flight, fleet);
  const aerolopaFleet = await getAerolopaAirlineFleet(flight.airlineIata);
  const aerolopaAircraftCode = chooseAerolopaAircraftCode(flight, aerolopaFleet);

  const [seatMetrics, aerolopaDetails] = await Promise.all([
    chosenAircraftSlug ? getSeatmapMetrics(airlineSlug, chosenAircraftSlug) : Promise.resolve(null),
    aerolopaAircraftCode ? getAerolopaAircraftDetails(aerolopaAircraftCode) : Promise.resolve(null)
  ]);
  const aerolopaMetrics = extractAerolopaEconomyMetrics(aerolopaDetails);
  const mergedMetrics = mergeSeatMetrics(seatMetrics, aerolopaMetrics);
  const slimlineRisk = evaluateSlimlineSeatRisk(mergedMetrics);
  const comfort = scoreComfort(mergedMetrics, slimlineRisk);
  const windowAdvice = calculateWindowAdvice(flight, airportByIata);

  if (windowAdvice?.summary) {
    comfort.reasons.push(`左右舷建议：${windowAdvice.summary}`);
  }

  return {
    ...flight,
    seatmaps: {
      airlineSlug,
      aircraftSlug: chosenAircraftSlug,
      sourceUrl: seatMetrics?.sourceUrl || mergedMetrics?.sourceUrl || null,
      confidence: mergedMetrics?.confidence || seatMetrics?.confidence || "low",
      pitchIn: mergedMetrics?.pitchIn ?? null,
      widthIn: mergedMetrics?.widthIn ?? null,
      reclineIn: mergedMetrics?.reclineIn ?? null,
      reclineRaw: mergedMetrics?.reclineRaw || null,
      rating: seatMetrics?.rating ?? null,
      summary: mergedMetrics?.summary || null,
      seatmapIds: mergedMetrics?.seatmapIds || [],
      exitRows: mergedMetrics?.exitRows || [],
      exitSeatNumbers: mergedMetrics?.exitSeatNumbers || [],
      featureCounts: mergedMetrics?.featureCounts || {},
      seatFeaturesConfidence: mergedMetrics?.seatFeaturesConfidence || "low",
      slimlineRisk,
      sources: mergedMetrics?.sources || ["seatmaps"]
    },
    aerolopa: aerolopaMetrics
      ? {
        aircraftCode: aerolopaMetrics.aircraftCode,
        aircraftType: aerolopaMetrics.aircraftType,
        sourceUrl: aerolopaMetrics.sourceUrl,
        apiUrl: aerolopaMetrics.apiUrl,
        svgUrl: aerolopaMetrics.svgUrl,
        publicationDate: aerolopaMetrics.publicationDate,
        haulType: aerolopaMetrics.haulType,
        confidence: aerolopaMetrics.confidence,
        guestLimited: aerolopaMetrics.guestLimited,
        rows: aerolopaMetrics.rows,
        seatsByCabin: aerolopaMetrics.seatsByCabin
      }
      : {
        aircraftCode: aerolopaAircraftCode || null,
        aircraftType: null,
        sourceUrl: aerolopaAircraftCode ? formatAerolopaAircraftPageUrl(aerolopaAircraftCode) : null,
        apiUrl: aerolopaAircraftCode ? formatAerolopaAircraftApiUrl(aerolopaAircraftCode) : null,
        svgUrl: null,
        publicationDate: null,
        haulType: null,
        confidence: "low",
        guestLimited: true,
        rows: null,
        seatsByCabin: null
      },
    windowAdvice,
    comfort
  };
}

function byComfortDesc(a, b) {
  const scoreA = a?.comfort?.score ?? -Infinity;
  const scoreB = b?.comfort?.score ?? -Infinity;
  if (scoreA !== scoreB) return scoreB - scoreA;

  const aTime = a?.departureTime || "";
  const bTime = b?.departureTime || "";
  return aTime.localeCompare(bTime);
}

async function searchAndAnalyze({ origin, destination, date, flightFilter = null, flightLookup = null, excludeLowCost = false }) {
  const routeFlightsWindow = await fetchFlights(origin, destination, date, { skipDateFilter: true });
  const routeFlights = routeFlightsWindow.filter((flight) => String(flight.departureTime || "").slice(0, 10) === date);
  const routeMatchedFlights = flightFilter
    ? routeFlights.filter((flight) => matchesFlightFilter(flight, flightFilter))
    : routeFlights;

  let flights = routeFlights;
  let matchedFlights = routeMatchedFlights;
  let dataSource = routeFlightsWindow.some((item) => item?.raw?.source === "searchapi_google_flights")
    ? "searchapi_google_flights"
    : "flightaware_route_page";
  let fallbackFetched = 0;
  let fallbackSourceUrl = null;
  let attemptedCandidates = 0;
  let inferredCount = 0;

  if (flightFilter && routeMatchedFlights.length === 0 && flightLookup) {
    const fallbackResult = await fetchFlightsFromFlightPage(date, flightLookup);
    fallbackFetched = fallbackResult.flights.length;
    fallbackSourceUrl = fallbackResult.sourceUrl;
    if (fallbackResult.flights.length > 0) {
      flights = fallbackResult.flights;
      matchedFlights = fallbackResult.flights.filter((flight) => matchesFlightFilter(flight, flightFilter));
      dataSource = fallbackResult.source;
    }
  } else if (!flightFilter && routeFlights.length === 0 && routeFlightsWindow.length > 0) {
    const routeFallbackResult = await fetchFlightsFromRouteCandidates({
      origin,
      destination,
      date,
      routeFlights: routeFlightsWindow
    });
    attemptedCandidates = routeFallbackResult.attemptedCandidates || 0;
    fallbackFetched = routeFallbackResult.flights.length;
    fallbackSourceUrl = routeFallbackResult.sourceUrl;
    if (routeFallbackResult.flights.length > 0) {
      flights = routeFallbackResult.flights;
      matchedFlights = routeFallbackResult.flights;
      dataSource = routeFallbackResult.source;
    }
  }

  if (!flightFilter && routeFlights.length === 0 && routeFlightsWindow.length > 0) {
    const inferredFlights = inferFlightsFromRecentPattern({
      routeFlights: routeFlightsWindow,
      existingFlights: flights,
      targetDate: date
    });

    if (inferredFlights.length > 0) {
      inferredCount = inferredFlights.length;
      flights = dedupeFlights([...flights, ...inferredFlights]);
      matchedFlights = flights;
      if (dataSource === "flightaware_route_candidates_trackpoll") {
        dataSource = "flightaware_route_candidates_trackpoll_plus_inferred";
      }
    }
  }

  const lowCostFilterEnabled = Boolean(excludeLowCost);
  const nonLowCostFlights = lowCostFilterEnabled
    ? matchedFlights.filter((flight) => !isLowCostAirline(flight))
    : matchedFlights;
  const trimmedFlights = nonLowCostFlights.slice(0, MAX_FLIGHTS);

  const [airlineMap, airportIndex] = await Promise.all([
    getSeatmapsAirlineMap(),
    getAirportIndex()
  ]);

  const enriched = await mapWithConcurrency(
    trimmedFlights,
    5,
    (flight) => enrichFlightWithSeatmaps(flight, airlineMap, airportIndex.byIata)
  );
  const cleaned = enriched.filter((item) => item && !item.error);
  cleaned.sort(byComfortDesc);

  return {
    query: {
      origin,
      destination,
      date
    },
    meta: {
      totalFetched: flights.length,
      routeFetched: routeFlights.length,
      routeWindowFetched: routeFlightsWindow.length,
      fallbackFetched,
      dataSource,
      fallbackSourceUrl,
      attemptedCandidates,
      inferredCount,
      afterFlightFilter: matchedFlights.length,
      afterLowCostFilter: nonLowCostFlights.length,
      lowCostFilterEnabled,
      analyzed: cleaned.length,
      droppedAsFlightMismatch: flights.length - matchedFlights.length,
      droppedAsLowCost: lowCostFilterEnabled ? (matchedFlights.length - nonLowCostFlights.length) : 0,
      notes: [
        dataSource === "searchapi_google_flights"
          ? "航班数据主源已切换为 SearchAPI 的 Google Flights（与 jessalva7 MCP 同源）"
          : dataSource === "flightaware_route_page"
          ? "航班数据来自 FlightAware 路由页面实时抓取（不落本地库）"
          : dataSource === "flightaware_route_candidates_trackpoll" || dataSource === "flightaware_route_candidates_trackpoll_plus_inferred"
            ? "路线模式下，路由页缺目标日期时已回退至候选航班号页活动日志抓取（不落本地库）"
            : "航班号模式下已回退至 FlightAware 航班页活动日志抓取（不落本地库）",
        "城市/机场自动解析来自全球机场索引（实时加载+内存缓存）",
        "座椅宽窄优先来自 SeatMaps，补充参考 AeroLOPA 公开接口与座舱图（不落本地库）",
        "左右舷建议基于航线方位 + 起飞时刻太阳方位估算（用于观景/防晒选座）",
        inferredCount > 0 ? `已基于最近连续运营模式补全 ${inferredCount} 条“推断班次”` : "未使用推断班次补全",
        lowCostFilterEnabled ? "已启用廉价航空过滤" : "未启用廉价航空过滤（按你的要求默认不过滤）",
        "同航班号可能临时换机，建议出发前再次复核"
      ]
    },
    flights: cleaned
  };
}

function validateDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function publicFilePath(urlPathname) {
  const baseDir = path.join(__dirname, "public");
  const normalizedPath = urlPathname === "/" ? "/index.html" : urlPathname;
  const absolute = path.join(baseDir, normalizedPath);

  if (!absolute.startsWith(baseDir)) {
    return null;
  }

  return absolute;
}

function serveStatic(req, res, pathname) {
  const filePath = publicFilePath(pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return;
      }

      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Internal Server Error");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_BY_EXT[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  let requestUrl;
  try {
    requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    makeJsonResponse(res, 400, { error: "Invalid URL" });
    return;
  }

  const pathname = requestUrl.pathname;

  if (pathname === "/api/health") {
    makeJsonResponse(res, 200, { ok: true, time: new Date().toISOString() });
    return;
  }

  if (pathname === "/api/config") {
    makeJsonResponse(res, 200, {
      needsApiKey: !SEARCHAPI_KEY,
      flightSource: SEARCHAPI_KEY ? "searchapi_google_flights" : "flightaware_fallback",
      airportSource: "mwgg_airports_github",
      supportsGlobalAirportSearch: true,
      maxFlights: MAX_FLIGHTS,
      defaultExcludeLowCost: false
    });
    return;
  }

  if (pathname === "/api/airports/suggest") {
    if (req.method !== "GET") {
      makeJsonResponse(res, 405, { error: "Method Not Allowed" });
      return;
    }

    const q = String(requestUrl.searchParams.get("q") || "").trim();
    if (!q) {
      makeJsonResponse(res, 200, { query: q, suggestions: [] });
      return;
    }

    try {
      const candidates = await searchAirportCandidates(q, 12);
      const suggestions = candidates.map((airport) => ({
        value: `${airport.city || airport.name.replace(/\s*Airport.*/i, "").trim() || toTitleCase(airport.country)} (${airport.iata})`,
        label: airportDisplayLabel(airport),
        iata: airport.iata,
        icao: airport.icao,
        city: airport.city,
        airport: airport.name,
        country: airport.country
      }));

      makeJsonResponse(res, 200, { query: q, suggestions });
      return;
    } catch (error) {
      makeJsonResponse(res, 502, { error: safeErrorMessage(error), query: q, suggestions: [] });
      return;
    }
  }

  if (pathname === "/api/search") {
    if (req.method !== "GET") {
      makeJsonResponse(res, 405, { error: "Method Not Allowed" });
      return;
    }

    const originRaw = String(requestUrl.searchParams.get("origin") || "").trim();
    const destinationRaw = String(requestUrl.searchParams.get("destination") || "").trim();
    const flightRaw = String(requestUrl.searchParams.get("flight") || "").trim();
    const date = String(requestUrl.searchParams.get("date") || "").trim();
    const excludeLowCostRaw = String(requestUrl.searchParams.get("excludeLowCost") || "").trim();
    const excludeLowCost = new Set(["1", "true", "yes", "on"]).has(toLowerSafe(excludeLowCostRaw));

    if (!validateDate(date)) {
      makeJsonResponse(res, 400, {
        error: "Invalid date format. Use YYYY-MM-DD."
      });
      return;
    }

    const hasRouteInput = Boolean(originRaw && destinationRaw);
    const hasFlightInput = Boolean(flightRaw);
    if (!date || (!hasRouteInput && !hasFlightInput)) {
      makeJsonResponse(res, 400, {
        error: "Missing required params. Use either (origin + destination + date) or (flight + date), date format YYYY-MM-DD."
      });
      return;
    }

    try {
      let result;

      if (hasFlightInput) {
        const flightQuery = parseFlightQuery(flightRaw);

        if (hasRouteInput) {
          const originResolved = await resolveToIata(originRaw);
          const destinationResolved = await resolveToIata(destinationRaw);

          result = await searchAndAnalyze({
            origin: originResolved.iata,
            destination: destinationResolved.iata,
            date,
            flightFilter: flightQuery,
            flightLookup: null,
            excludeLowCost
          });

          result.query.input = {
            origin: originRaw,
            destination: destinationRaw,
            flight: flightRaw,
            date
          };
          result.query.resolved = {
            mode: "flight",
            routeSource: "user_input",
            flightNormalized: flightQuery.normalized,
            canonicalFlightIdent: null,
            sourceUrl: null,
            originIata: originResolved.iata,
            destinationIata: destinationResolved.iata,
            originIcao: "",
            destinationIcao: "",
            originSource: originResolved.source,
            destinationSource: destinationResolved.source,
            originMatched: originResolved.matched,
            destinationMatched: destinationResolved.matched
          };
        } else {
          const routeByFlight = await resolveRouteByFlightNumber(flightRaw);
          result = await searchAndAnalyze({
            origin: routeByFlight.originIata,
            destination: routeByFlight.destinationIata,
            date,
            flightFilter: routeByFlight.flightQuery,
            flightLookup: routeByFlight,
            excludeLowCost
          });

          result.query.input = {
            origin: originRaw,
            destination: destinationRaw,
            flight: flightRaw,
            date
          };
          result.query.resolved = {
            mode: "flight",
            routeSource: "flight_number_page",
            flightNormalized: routeByFlight.flightQuery.normalized,
            canonicalFlightIdent: routeByFlight.canonicalFlightIdent,
            sourceUrl: routeByFlight.sourceUrl,
            originIata: routeByFlight.originIata,
            destinationIata: routeByFlight.destinationIata,
            originIcao: routeByFlight.originIcao,
            destinationIcao: routeByFlight.destinationIcao,
            originSource: "flight_number_page",
            destinationSource: "flight_number_page",
            originMatched: routeByFlight.originMatched,
            destinationMatched: routeByFlight.destinationMatched
          };
        }
      } else {
        const originResolved = await resolveToIata(originRaw);
        const destinationResolved = await resolveToIata(destinationRaw);

        result = await searchAndAnalyze({
          origin: originResolved.iata,
          destination: destinationResolved.iata,
          date,
          excludeLowCost
        });

        result.query.input = {
          origin: originRaw,
          destination: destinationRaw,
          flight: flightRaw,
          date
        };
        result.query.resolved = {
          mode: "route",
          originIata: originResolved.iata,
          destinationIata: destinationResolved.iata,
          originSource: originResolved.source,
          destinationSource: destinationResolved.source,
          originMatched: originResolved.matched,
          destinationMatched: destinationResolved.matched
        };
      }

      makeJsonResponse(res, 200, result);
      return;
    } catch (error) {
      makeJsonResponse(res, 502, {
        error: safeErrorMessage(error)
      });
      return;
    }
  }

  if (pathname.startsWith("/api/")) {
    makeJsonResponse(res, 404, { error: "API endpoint not found" });
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Flight Seat Advisor running on http://${HOST}:${PORT}`);
});
