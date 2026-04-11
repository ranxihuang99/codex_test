const form = document.getElementById("search-form");
const flightInput = document.getElementById("flight");
const originInput = document.getElementById("origin");
const destinationInput = document.getElementById("destination");
const flightOptionsEl = document.getElementById("flight-options");
const originOptionsEl = document.getElementById("origin-options");
const destinationOptionsEl = document.getElementById("destination-options");
const yearSelect = document.getElementById("year-select");
const monthSelect = document.getElementById("month-select");
const daySelect = document.getElementById("day-select");
const excludeLowCostInput = document.getElementById("exclude-low-cost");
const submitBtn = document.getElementById("submit-btn");
const clearHistoryBtn = document.getElementById("clear-history-btn");

const statusEl = document.getElementById("status");
const configTipEl = document.getElementById("config-tip");
const resultWrapEl = document.getElementById("result-wrap");
const metaEl = document.getElementById("meta");
const resultsEl = document.getElementById("results");
const suggestionCache = new Map();
const INPUT_HISTORY_KEY = "seat_advisor_input_history_v1";
const INPUT_HISTORY_LIMIT = 15;

let inputHistory = {
  flights: [],
  origins: [],
  destinations: []
};

function setStatus(text) {
  statusEl.textContent = text || "";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function toLevelClass(level) {
  if (level.includes("较宽敞")) return "good";
  if (level.includes("中等")) return "mid";
  return "bad";
}

function formatSeatValue(value, suffix = "\"") {
  if (value === null || value === undefined) return "-";
  return `${value}${suffix}`;
}

function formatExitRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "-";
  return `${rows.join("、")}排`;
}

function formatSlimlineRiskLabel(risk) {
  if (!risk || typeof risk !== "object") return "-";
  return String(risk.label || "").trim() || "-";
}

function extractRowsFromSeatNumbers(seats) {
  if (!Array.isArray(seats)) return [];
  const rows = new Set();
  for (const rawSeat of seats) {
    const seat = String(rawSeat || "").trim().toUpperCase();
    const match = seat.match(/^(\d{1,3})/);
    if (!match) continue;
    rows.add(Number(match[1]));
  }
  return Array.from(rows).sort((a, b) => a - b);
}

function formatRowList(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "-";
  return `${rows.join("、")}排`;
}

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function fillSelect(selectEl, values, selectedValue) {
  selectEl.innerHTML = values
    .map((item) => {
      const value = String(item.value);
      const selected = String(selectedValue) === value ? "selected" : "";
      return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(item.label)}</option>`;
    })
    .join("");
}

function initDateSelectors() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();

  const years = [];
  for (let y = currentYear; y <= currentYear + 2; y += 1) {
    years.push({ value: y, label: `${y}年` });
  }

  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    months.push({ value: m, label: `${String(m).padStart(2, "0")}月` });
  }

  fillSelect(yearSelect, years, currentYear);
  fillSelect(monthSelect, months, currentMonth);

  const renderDays = () => {
    const y = Number(yearSelect.value);
    const m = Number(monthSelect.value);
    const maxDay = getDaysInMonth(y, m);
    const currentSelected = Number(daySelect.value) || currentDay;

    const days = [];
    for (let d = 1; d <= maxDay; d += 1) {
      days.push({ value: d, label: `${String(d).padStart(2, "0")}日` });
    }

    fillSelect(daySelect, days, Math.min(currentSelected, maxDay));
  };

  yearSelect.addEventListener("change", renderDays);
  monthSelect.addEventListener("change", renderDays);
  renderDays();
}

function selectedDateIso() {
  const y = Number(yearSelect.value);
  const m = Number(monthSelect.value);
  const d = Number(daySelect.value);

  if (!y || !m || !d) return "";

  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function debounce(fn, waitMs) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}

function getSafeStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeFlightHistoryValue(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function normalizeLocationHistoryValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeHistoryKey(value) {
  return String(value || "").trim().toLowerCase();
}

function safeHistoryShape(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  return {
    flights: Array.isArray(data.flights) ? data.flights.filter(Boolean).slice(0, INPUT_HISTORY_LIMIT) : [],
    origins: Array.isArray(data.origins) ? data.origins.filter(Boolean).slice(0, INPUT_HISTORY_LIMIT) : [],
    destinations: Array.isArray(data.destinations) ? data.destinations.filter(Boolean).slice(0, INPUT_HISTORY_LIMIT) : []
  };
}

function loadInputHistory() {
  const storage = getSafeStorage();
  if (!storage) return;

  try {
    const raw = storage.getItem(INPUT_HISTORY_KEY);
    if (!raw) return;
    inputHistory = safeHistoryShape(JSON.parse(raw));
  } catch {
    inputHistory = safeHistoryShape({});
  }
}

function saveInputHistory() {
  const storage = getSafeStorage();
  if (!storage) return;

  try {
    storage.setItem(INPUT_HISTORY_KEY, JSON.stringify(inputHistory));
  } catch {
    // Ignore write errors (e.g. private mode / quota).
  }
}

function upsertHistory(bucket, value, normalizeFn) {
  if (!inputHistory[bucket]) return false;

  const normalized = normalizeFn(value);
  if (!normalized) return false;

  const key = normalizeHistoryKey(normalized);
  const existing = inputHistory[bucket];
  const merged = [normalized, ...existing.filter((item) => normalizeHistoryKey(item) !== key)];
  inputHistory[bucket] = merged.slice(0, INPUT_HISTORY_LIMIT);
  return true;
}

function getHistorySuggestions(bucket, query, limit = 12) {
  const all = Array.isArray(inputHistory[bucket]) ? inputHistory[bucket] : [];
  const q = normalizeHistoryKey(query);
  const picked = q
    ? all.filter((item) => normalizeHistoryKey(item).includes(q))
    : all;

  return picked.slice(0, limit).map((value) => ({
    value,
    label: `历史记录 · ${value}`
  }));
}

function mergeSuggestionsByValue(primary, secondary) {
  const out = [];
  const seen = new Set();

  for (const list of [primary || [], secondary || []]) {
    for (const item of list) {
      const value = String(item?.value || "").trim();
      if (!value) continue;
      const key = normalizeHistoryKey(value);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }

  return out;
}

function refreshHistoryDatalists() {
  renderAirportSuggestions(flightOptionsEl, getHistorySuggestions("flights", flightInput.value, INPUT_HISTORY_LIMIT));
  renderAirportSuggestions(originOptionsEl, getHistorySuggestions("origins", originInput.value, INPUT_HISTORY_LIMIT));
  renderAirportSuggestions(destinationOptionsEl, getHistorySuggestions("destinations", destinationInput.value, INPUT_HISTORY_LIMIT));
}

function recordInputHistory({ flight, origin, destination }) {
  let changed = false;
  changed = upsertHistory("flights", flight, normalizeFlightHistoryValue) || changed;
  changed = upsertHistory("origins", origin, normalizeLocationHistoryValue) || changed;
  changed = upsertHistory("destinations", destination, normalizeLocationHistoryValue) || changed;

  if (!changed) return;
  saveInputHistory();
  refreshHistoryDatalists();
}

function clearAllInputHistory() {
  inputHistory = safeHistoryShape({});
  saveInputHistory();
  refreshHistoryDatalists();
}

function renderAirportSuggestions(datalistEl, suggestions) {
  if (!datalistEl) return;

  datalistEl.innerHTML = (suggestions || [])
    .map((item) => {
      const value = escapeHtml(item.value || "");
      const label = escapeHtml(item.label || "");
      return `<option value="${value}" label="${label}"></option>`;
    })
    .join("");
}

async function fetchAirportSuggestions(query) {
  const key = String(query || "").trim().toLowerCase();
  if (!key || key.length < 2) {
    return [];
  }

  if (suggestionCache.has(key)) {
    return suggestionCache.get(key);
  }

  const params = new URLSearchParams({ q: key });
  const response = await fetch(`/api/airports/suggest?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "城市联想查询失败");
  }

  const suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
  suggestionCache.set(key, suggestions);
  return suggestions;
}

function bindAirportAutocomplete(inputEl, datalistEl, historyBucket) {
  let requestSerial = 0;

  const run = debounce(async () => {
    const q = inputEl.value.trim();
    const currentSerial = requestSerial + 1;
    requestSerial = currentSerial;
    const historySuggestions = getHistorySuggestions(historyBucket, q, 12);

    if (q.length < 2) {
      renderAirportSuggestions(datalistEl, historySuggestions);
      return;
    }

    try {
      const suggestions = await fetchAirportSuggestions(q);
      if (currentSerial !== requestSerial) return;
      renderAirportSuggestions(datalistEl, mergeSuggestionsByValue(historySuggestions, suggestions));
    } catch {
      if (currentSerial !== requestSerial) return;
      renderAirportSuggestions(datalistEl, historySuggestions);
    }
  }, 220);

  inputEl.addEventListener("input", run);
  inputEl.addEventListener("focus", run);
}

function bindFlightHistoryAutocomplete() {
  const run = debounce(() => {
    const q = flightInput.value.trim();
    renderAirportSuggestions(flightOptionsEl, getHistorySuggestions("flights", q, INPUT_HISTORY_LIMIT));
  }, 120);

  flightInput.addEventListener("input", run);
  flightInput.addEventListener("focus", run);
}

function renderMeta(meta, query) {
  const lowCostFilterEnabled = Boolean(meta.lowCostFilterEnabled);
  const badges = [
    `抓取航班 ${meta.totalFetched ?? 0}`,
    `航班号匹配后 ${meta.afterFlightFilter ?? meta.totalFetched ?? 0}`,
    `廉航过滤 ${lowCostFilterEnabled ? "开启" : "关闭"}`,
    `过滤后剩余 ${meta.afterLowCostFilter ?? 0}`,
    `完成分析 ${meta.analyzed ?? 0}`,
    `过滤廉航 ${meta.droppedAsLowCost ?? 0}`
  ];

  if (
    meta?.dataSource === "flightaware_flight_page_trackpoll" ||
    meta?.dataSource === "flightaware_route_candidates_trackpoll" ||
    meta?.dataSource === "flightaware_route_candidates_trackpoll_plus_inferred"
  ) {
    badges.unshift("已使用航班页回退抓取");
  }

  if (Number(meta?.inferredCount || 0) > 0) {
    badges.unshift(`推断补全 ${meta.inferredCount}`);
  }

  if (query?.resolved?.originIata && query?.resolved?.destinationIata) {
    badges.unshift(`自动解析：${query.resolved.originIata} → ${query.resolved.destinationIata}`);
  }

  if (query?.resolved?.flightNormalized) {
    badges.unshift(`航班号：${query.resolved.flightNormalized}`);
  }

  metaEl.innerHTML = badges
    .map((text) => `<span class="meta-badge">${escapeHtml(text)}</span>`)
    .join("");
}

function renderFlights(flights) {
  if (!Array.isArray(flights) || flights.length === 0) {
    resultsEl.innerHTML = `<div class="flight-card">没有可展示的航班结果。可能是当天无航班、上游页面该日期数据暂未开放，或 SeatMaps 匹配失败。</div>`;
    return;
  }

  resultsEl.innerHTML = flights
    .map((flight) => {
      const levelClass = toLevelClass(flight.comfort.level);
      const reasons = (flight.comfort.reasons || [])
        .map((reason) => `<li>${escapeHtml(reason)}</li>`)
        .join("");

      const seatmapsLink = flight.seatmaps?.sourceUrl
        ? `<a href="${escapeHtml(flight.seatmaps.sourceUrl)}" target="_blank" rel="noopener noreferrer">SeatMaps 页面</a>`
        : "无";
      const aerolopaLink = flight.aerolopa?.sourceUrl
        ? `<a href="${escapeHtml(flight.aerolopa.sourceUrl)}" target="_blank" rel="noopener noreferrer">AeroLOPA 页面</a>`
        : "无";

      const aircraftDisplay = flight.aircraftHint || flight.aircraftCode || "未知机型";
      const inferredMark = flight.raw?.inferred ? "（推断班次）" : "";
      const scenicSide = flight.windowAdvice?.scenicSideLabel || "-";
      const shadeSide = flight.windowAdvice?.shadeSideLabel || "-";
      const windowSummary = flight.windowAdvice?.summary || "暂无左右舷建议";
      const exitRows = formatExitRows(flight.seatmaps?.exitRows);
      const restrictedReclineRowsRaw = Array.isArray(flight.seatmaps?.restrictedReclineRows)
        ? flight.seatmaps.restrictedReclineRows
        : [];
      const restrictedReclineRows = restrictedReclineRowsRaw.length > 0
        ? restrictedReclineRowsRaw
        : extractRowsFromSeatNumbers(flight.seatmaps?.restrictedReclineSeatNumbers || []);
      const restrictedReclineRowsText = formatRowList(restrictedReclineRows);
      const slimlineRiskLabel = formatSlimlineRiskLabel(flight.seatmaps?.slimlineRisk);
      const slimlineRiskReason = String(flight.seatmaps?.slimlineRisk?.reason || "").trim();
      const aerolopaMeta = [
        flight.aerolopa?.aircraftCode ? `机型码 ${flight.aerolopa.aircraftCode}` : null,
        flight.aerolopa?.haulType ? `航程 ${flight.aerolopa.haulType}` : null,
        flight.aerolopa?.publicationDate ? `发布 ${flight.aerolopa.publicationDate}` : null
      ].filter(Boolean).join(" · ");

      return `
        <article class="flight-card">
          <div class="flight-top">
            <div>
              <div class="flight-id">${escapeHtml(flight.flightCode)}</div>
              <div class="flight-route">${escapeHtml(flight.airlineName)} · ${escapeHtml(flight.departureIata)} → ${escapeHtml(flight.arrivalIata)} · ${formatDateTime(flight.departureTime)} - ${formatDateTime(flight.arrivalTime)}</div>
            </div>
            <span class="level ${levelClass}">${escapeHtml(flight.comfort.level)} · 分数 ${escapeHtml(flight.comfort.score)}</span>
          </div>

          <div class="detail-grid">
            <div class="kv"><span class="k">机型</span><span class="v">${escapeHtml(aircraftDisplay)}</span></div>
            <div class="kv"><span class="k">座椅间距</span><span class="v">${escapeHtml(formatSeatValue(flight.seatmaps?.pitchIn))}</span></div>
            <div class="kv"><span class="k">座椅宽度</span><span class="v">${escapeHtml(formatSeatValue(flight.seatmaps?.widthIn))}</span></div>
            <div class="kv"><span class="k">后仰</span><span class="v">${escapeHtml(formatSeatValue(flight.seatmaps?.reclineIn))}</span></div>
            <div class="kv"><span class="k">观景优先侧</span><span class="v">${escapeHtml(scenicSide)}</span></div>
            <div class="kv"><span class="k">防晒优先侧</span><span class="v">${escapeHtml(shadeSide)}</span></div>
            <div class="kv"><span class="k">安全出口排</span><span class="v">${escapeHtml(exitRows)}</span></div>
            <div class="kv"><span class="k">受限后仰排说明</span><span class="v">${escapeHtml(restrictedReclineRowsText)}</span></div>
            <div class="kv"><span class="k">超薄座椅风险</span><span class="v">${escapeHtml(slimlineRiskLabel)}</span></div>
          </div>

          <ul class="reason-list">${reasons}</ul>
          <div class="footer-line">建议：${escapeHtml(flight.comfort.advice)}</div>
          <div class="footer-line">左右舷：${escapeHtml(windowSummary)}</div>
          <div class="footer-line">超薄识别：${escapeHtml(slimlineRiskReason || "未获取到明确风险理由（建议结合值机座位图再确认）")}</div>
          <div class="footer-line">航班源：${escapeHtml(flight.raw?.source || "unknown")}${escapeHtml(inferredMark)}</div>
          <div class="footer-line">Seat 数据源：${seatmapsLink} · 置信度 ${escapeHtml(flight.seatmaps?.confidence || "low")}</div>
          <div class="footer-line">AeroLOPA：${aerolopaLink}${aerolopaMeta ? ` · ${escapeHtml(aerolopaMeta)}` : ""}</div>
        </article>
      `;
    })
    .join("");
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const payload = await response.json();

    if (payload.needsApiKey) {
      configTipEl.textContent = "服务端当前配置需要航班 API key。";
      configTipEl.classList.remove("hidden");
      return;
    }

    if (excludeLowCostInput && typeof payload.defaultExcludeLowCost === "boolean") {
      excludeLowCostInput.checked = payload.defaultExcludeLowCost;
    }

    configTipEl.classList.add("hidden");
  } catch (error) {
    configTipEl.textContent = `读取配置失败：${error.message}`;
    configTipEl.classList.remove("hidden");
  }
}

async function onSubmit(event) {
  event.preventDefault();

  const flight = flightInput.value.trim();
  const origin = originInput.value.trim();
  const destination = destinationInput.value.trim();
  const date = selectedDateIso();
  const excludeLowCost = Boolean(excludeLowCostInput?.checked);

  if (!flight && (!origin || !destination)) {
    setStatus("请填写航班号，或填写起飞地+目的地。");
    return;
  }

  if (!date) {
    setStatus("请选择完整出行日期。");
    return;
  }

  recordInputHistory({
    flight,
    origin,
    destination
  });

  setStatus(flight
    ? "正在按航班号查询并抓取 SeatMaps，请稍候..."
    : "正在查询航班并抓取 SeatMaps，请稍候...");
  submitBtn.disabled = true;

  try {
    const params = new URLSearchParams({ date });
    params.set("excludeLowCost", String(excludeLowCost));
    if (flight) {
      params.set("flight", flight);
    } else {
      params.set("origin", origin);
      params.set("destination", destination);
    }
    const response = await fetch(`/api/search?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "查询失败");
    }

    renderMeta(payload.meta || {}, payload.query || {});
    renderFlights(payload.flights || []);
    resultWrapEl.classList.remove("hidden");

    const resolved = payload.query?.resolved;
    if (resolved?.mode === "flight" && resolved?.flightNormalized) {
      if (resolved?.routeSource === "user_input") {
        setStatus(`查询完成。已按你输入的航线 ${resolved.originIata} → ${resolved.destinationIata} 过滤航班号 ${resolved.flightNormalized} 并完成排序。`);
      } else {
        setStatus(`查询完成。已按航班号 ${resolved.flightNormalized} 解析为 ${resolved.originIata} → ${resolved.destinationIata} 并完成排序。`);
      }
    } else if (resolved?.originIata && resolved?.destinationIata) {
      setStatus(`查询完成。已自动解析：${resolved.originIata} → ${resolved.destinationIata}，并按座椅宽敞度排序。`);
    } else {
      setStatus("查询完成。结果已按座椅宽敞度从高到低排序。");
    }
  } catch (error) {
    resultWrapEl.classList.add("hidden");
    setStatus(`查询失败：${error.message}`);
  } finally {
    submitBtn.disabled = false;
  }
}

function init() {
  loadInputHistory();
  initDateSelectors();
  bindFlightHistoryAutocomplete();
  bindAirportAutocomplete(originInput, originOptionsEl, "origins");
  bindAirportAutocomplete(destinationInput, destinationOptionsEl, "destinations");

  clearHistoryBtn.addEventListener("click", () => {
    if (!window.confirm("确定要清除已记录的航班号和地点历史吗？")) {
      return;
    }

    clearAllInputHistory();
    setStatus("已清除输入历史记录。");
  });

  refreshHistoryDatalists();
  form.addEventListener("submit", onSubmit);
  loadConfig();
}

init();
