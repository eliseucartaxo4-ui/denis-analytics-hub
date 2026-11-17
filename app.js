/**
 * Denis Ryabtsev Analytics Hub — Interactive Client SPA
 */

// Global State
let rawData = null;
let currentFilter = "all";
let currentSearch = "";
let currentSort = { column: "views", desc: true };
let currentView = "table"; // 'table' | 'cards'
let currentPeriod = "all"; // '1d' | '7d' | '30d' | 'all'
let selectedCategoryIndex = null;
let currentDeficitMode = "c50"; // 'c50' | 'c200' | 'auth'

const PERIOD_LABELS = {
  "1d": "1 день",
  "7d": "7 дней",
  "30d": "1 месяц",
  "all": "Всё время",
};

// Period Switcher Handler
window.setPeriod = function (period) {
  currentPeriod = period;
  document.querySelectorAll(".period-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.period === period);
  });
  const globalActivePeriod = document.getElementById("global-active-period-name");
  if (globalActivePeriod) globalActivePeriod.textContent = PERIOD_LABELS[period] || period;

  const catPeriodBadge = document.getElementById("cat-panel-period-badge");
  if (catPeriodBadge) catPeriodBadge.textContent = `Период: ${PERIOD_LABELS[period] || period}`;

  const tablePeriodLabel = document.getElementById("table-period-views-label");
  if (tablePeriodLabel) tablePeriodLabel.textContent = PERIOD_LABELS[period] || "Всё время";

  renderDashboard();
};

// Utility number formatting
function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return "0";
  const n = Math.round(Number(num));
  if (n >= 1000000000) return (n / 1000000000).toFixed(1).replace(".0", "") + "B";
  if (n >= 10000000) return (n / 1000000).toFixed(1).replace(".0", "") + "M";
  return new Intl.NumberFormat("ru-RU").format(n);
}

function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(msg, duration = 3000) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), duration);
}

// PIN extraction helper (from URL, localStorage, or SSR window)
function getActivePin() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const qPin = urlParams.get("pin");
    if (qPin) {
      try { localStorage.setItem("denis_pin", qPin); } catch(e) {}
      return qPin;
    }
  } catch(e) {}
  try {
    const hash = window.location.hash || "";
    if (hash.includes("pin=")) {
      const hPin = hash.split("pin=")[1].split("&")[0];
      if (hPin) {
        try { localStorage.setItem("denis_pin", hPin); } catch(e) {}
        return hPin;
      }
    }
  } catch(e) {}
  try {
    const sPin = localStorage.getItem("denis_pin");
    if (sPin) return sPin;
  } catch(e) {}
  if (window.__PIN__) return window.__PIN__;
  return "";
}

const EXPECTED_PIN = "2850";

function isCloudStaticHost() {
  return window.location.hostname.endsWith(".github.io");
}

function isLocalHost() {
  return window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
}

function isValidPin(pin) {
  return String(pin || "").trim() === EXPECTED_PIN;
}

// Fetch Master Analytics Data (Hybrid Local API + 24/7 Cloud Static CDN, just like /crm/)
async function loadData(showLoading = true) {
  if (window.__INITIAL_DATA__ && !rawData && !showLoading) {
    rawData = window.__INITIAL_DATA__;
    hidePinModal();
    const syncElem = document.getElementById("sync-text");
    if (syncElem) syncElem.textContent = "Синхронизировано: " + (rawData.overview?.generated_at_text || "сейчас");
    renderDashboard();
    return;
  }

  const pin = getActivePin();
  if (!isLocalHost() && !window.__INITIAL_DATA__ && !isValidPin(pin)) {
    showPinModal();
    return;
  }

  const refreshBtn = document.getElementById("refresh-btn");
  if (showLoading && refreshBtn) {
    refreshBtn.classList.add("spinning");
  }

  const ts = Date.now();
  const effPin = pin || EXPECTED_PIN;
  const candidateUrls = [];

  if (isCloudStaticHost()) {
    candidateUrls.push(`./denis_data.json?t=${ts}`);
  } else {
    if (window.location.pathname.startsWith("/denis-stats")) {
      candidateUrls.push(`/api/denis-stats/all?pin=${encodeURIComponent(effPin)}&t=${ts}`);
      candidateUrls.push(`/denis-stats/denis_data.json?t=${ts}`);
    }
    candidateUrls.push(`/api/stats/all?pin=${encodeURIComponent(effPin)}&t=${ts}`);
    candidateUrls.push(`./denis_data.json?t=${ts}`);
  }

  const headers = {};
  if (!isCloudStaticHost() && effPin) {
    headers["X-Pin-Code"] = effPin;
  }

  let loadedOk = false;
  let lastErr = null;
  try {
    for (const u of candidateUrls) {
      try {
        const res = await fetch(u, { cache: "no-store", headers: u.includes("/api/") ? headers : {} });
        if (res.status === 401 && u.includes("/api/")) {
          if (!isLocalHost() && !isValidPin(pin)) {
            showPinModal();
            return;
          }
          continue;
        }
        if (!res.ok) continue;
        const json = await res.json();
        if (json && json.overview) {
          rawData = json;
          loadedOk = true;
          break;
        }
      } catch (innerErr) {
        lastErr = innerErr;
      }
    }

    if (loadedOk) {
      hidePinModal();
      const syncElem = document.getElementById("sync-text");
      if (syncElem) syncElem.textContent = "Синхронизировано: " + (rawData.overview?.generated_at_text || "сейчас");
      renderDashboard();
    } else if (window.__INITIAL_DATA__ && !rawData) {
      rawData = window.__INITIAL_DATA__;
      hidePinModal();
      renderDashboard();
    } else if (!rawData) {
      const msg = lastErr ? lastErr.message : "не удалось получить снимок данных";
      showToast("Ошибка загрузки данных: " + msg, 4000);
      const syncElem = document.getElementById("sync-text");
      if (syncElem) syncElem.textContent = "Ожидание синхронизации";
    }
  } finally {
    if (refreshBtn) refreshBtn.classList.remove("spinning");
  }
}

// Render Complete Dashboard
function renderDashboard() {
  if (!rawData) return;

  const globalActivePeriod = document.getElementById("global-active-period-name");
  if (globalActivePeriod) globalActivePeriod.textContent = PERIOD_LABELS[currentPeriod] || currentPeriod;

  const tablePeriodLabel = document.getElementById("table-period-views-label");
  if (tablePeriodLabel) tablePeriodLabel.textContent = PERIOD_LABELS[currentPeriod] || "Всё время";

  renderKPIs(rawData.overview);
  renderStagnantBanner(rawData.overview, rawData.stagnant_accounts);
  renderDeficitWindow(rawData.deficit_analysis);
  renderCategories(rawData.categories);
  if (selectedCategoryIndex !== null) {
    renderCategoryProfilesPanel(selectedCategoryIndex);
  } else {
    closeCategoryProfilesPanel();
  }
  renderAccounts();
}

// Render Top KPI Cards
function renderKPIs(ov) {
  const container = document.getElementById("kpi-container");
  if (!container || !ov) return;

  const yt = ov.platforms?.youtube || {};
  const ig = ov.platforms?.instagram || {};
  const tt = ov.platforms?.tiktok || {};

  const pViews = ov.periods?.[currentPeriod]?.views ?? ov.total_views;
  const pPubs = ov.periods?.[currentPeriod]?.published_count ?? ov.published_today;
  const periodLabel = PERIOD_LABELS[currentPeriod] || "Всё время";

  container.innerHTML = `
    <!-- 1. Total Views Card -->
    <div class="kpi-card highlight-amber">
      <div class="kpi-header">
        <span class="kpi-title">Просмотры (${periodLabel.toLowerCase()})</span>
        <span class="kpi-icon">👁️</span>
      </div>
      <div class="kpi-value">${formatNumber(pViews)}</div>
      <div class="kpi-footer">
        <span>▶ YT: <b>${formatNumber(ov.periods?.[currentPeriod]?.yt_views ?? yt.views ?? 0)}</b></span>
        <span>📱 TT: <b>${formatNumber(ov.periods?.[currentPeriod]?.tt_views ?? tt.views ?? 0)}</b></span>
        <span>📸 IG: <b>${formatNumber(ov.periods?.[currentPeriod]?.ig_views ?? ig.views ?? 0)}</b></span>
      </div>
    </div>

    <!-- 2. Daily Velocity / Publications in Period -->
    <div class="kpi-card highlight-emerald">
      <div class="kpi-header">
        <span class="kpi-title">Выкладка роликов</span>
        <span class="kpi-icon">🎬</span>
      </div>
      <div class="kpi-value" style="color: #34d399">
        ${pPubs} <span style="font-size: 14px; font-weight: 600; color: var(--text-dim)">видео (${periodLabel.toLowerCase()})</span>
      </div>
      <div class="kpi-footer">
        <span>Сегодня: <b>${ov.published_today}</b> шт</span>
        <span>Вчера: <b>${ov.published_yesterday}</b> шт</span>
        <span>Всего: <b>${ov.total_published_videos}</b></span>
      </div>
    </div>

    <!-- 3. Total Audience -->
    <div class="kpi-card highlight-purple">
      <div class="kpi-header">
        <span class="kpi-title">Суммарная аудитория</span>
        <span class="kpi-icon">👥</span>
      </div>
      <div class="kpi-value" style="color: #c084fc">${formatNumber(ov.total_subscribers)}</div>
      <div class="kpi-footer">
        <span>Подписчики YT: <b>${formatNumber(yt.subscribers || 0)}</b></span>
        <span>Фолловеры TT/IG: <b>${formatNumber((tt.followers || 0) + (ig.followers || 0))}</b></span>
      </div>
    </div>

    <!-- 4. Health & Stagnation Tracker -->
    <div class="kpi-card highlight-cyan">
      <div class="kpi-header">
        <span class="kpi-title">Статус аккаунтов</span>
        <span class="kpi-icon">📊</span>
      </div>
      <div class="kpi-value">
        <span style="color: #38bdf8">${ov.total_accounts}</span>
        <span style="font-size: 14px; font-weight: 600; color: var(--text-dim)">каналов</span>
      </div>
      <div class="kpi-footer">
        <span style="color: #34d399; cursor: pointer;" onclick="setQuickFilter('working')" title="Показать только работающие аккаунты">🟢 Работают: <b>${ov.working_accounts_count ?? (ov.total_accounts - (ov.archived_accounts_count || 0))}</b></span>
        <span style="color: #cbd5e1; cursor: pointer;" onclick="setQuickFilter('archive')" title="Показать только аккаунты в архиве">📦 В архиве: <b>${ov.archived_accounts_count || 0}</b></span>
        <span style="color: #fde68a; cursor: pointer;" onclick="setQuickFilter('stagnant')" title="Показать стагнирующие аккаунты">⚠️ В простое: <b>${ov.stagnant_accounts_count}</b></span>
      </div>
    </div>
  `;
}

// Render Stagnant, Low Views & Archive Alert Banners
function renderStagnantBanner(ov, stagnantList) {
  const banner = document.getElementById("stagnant-alert-banner");
  const countEl = document.getElementById("stagnant-btn-count");
  const pillCount = document.getElementById("pill-stagnant-count");
  const pillDead = document.getElementById("pill-dead-count");

  const count = ov?.stagnant_accounts_count || (stagnantList ? stagnantList.length : 0);
  if (pillCount) pillCount.textContent = count;
  if (pillDead) pillDead.textContent = ov?.dead_accounts_count || 0;

  if (count > 0 && banner) {
    banner.classList.remove("hidden");
    if (countEl) countEl.textContent = count;
  } else if (banner) {
    banner.classList.add("hidden");
  }

  // Working & Archive counts
  const workingCount = ov?.working_accounts_count ?? (rawData?.working_accounts ? rawData.working_accounts.length : (rawData?.accounts ? rawData.accounts.filter(a => a.is_working).length : 24));
  const archiveCount = ov?.archived_accounts_count ?? (rawData?.archived_accounts ? rawData.archived_accounts.length : (rawData?.accounts ? rawData.accounts.filter(a => a.is_archived).length : 9));

  const pillWorking = document.getElementById("pill-working-count");
  const pillArchive = document.getElementById("pill-archive-count");
  const archiveBanner = document.getElementById("archive-alert-banner");
  const archiveBannerCount = document.getElementById("archive-banner-count");
  const archiveBtnCount = document.getElementById("archive-btn-count");

  if (pillWorking) pillWorking.textContent = workingCount;
  if (pillArchive) pillArchive.textContent = archiveCount;
  if (archiveBannerCount) archiveBannerCount.textContent = archiveCount;
  if (archiveBtnCount) archiveBtnCount.textContent = archiveCount;

  if (archiveCount > 0 && archiveBanner) {
    archiveBanner.classList.remove("hidden");
  } else if (archiveBanner) {
    archiveBanner.classList.add("hidden");
  }

  // Low views (<= 50) banner and pill
  const lowViewsList = rawData?.low_views_accounts || (rawData?.accounts ? rawData.accounts.filter(a => (a.total_views || 0) <= 50) : []);
  const lowViewsCount = lowViewsList.length;
  const pillLowViews = document.getElementById("pill-low-views-count");
  const lowViewsBanner = document.getElementById("low-views-alert-banner");
  const lowViewsBtnCount = document.getElementById("low-views-btn-count");
  const lowViewsBannerCount = document.getElementById("low-views-banner-count");

  if (pillLowViews) pillLowViews.textContent = lowViewsCount;
  if (lowViewsBtnCount) lowViewsBtnCount.textContent = lowViewsCount;
  if (lowViewsBannerCount) lowViewsBannerCount.textContent = lowViewsCount;

  if (lowViewsCount > 0 && lowViewsBanner) {
    lowViewsBanner.classList.remove("hidden");
  } else if (lowViewsBanner) {
    lowViewsBanner.classList.add("hidden");
  }
}

// ==========================================
// Dedicated Account Deficit & Category Balance Window
// ==========================================

window.scrollToDeficitWindow = function () {
  const el = document.getElementById("deficit-window-section");
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
};

window.setDeficitMode = function (mode) {
  currentDeficitMode = mode;
  document.querySelectorAll("#deficit-mode-selector .mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  if (rawData && rawData.deficit_analysis) {
    renderDeficitWindow(rawData.deficit_analysis);
  }
};

function renderDeficitWindow(deficitData) {
  if (!deficitData) return;

  const mode = currentDeficitMode || "c50";
  const summary = deficitData.summaries?.[mode] || {};
  const cats = deficitData.categories_deficit || [];
  const targetPerPlat = deficitData.target_per_platform || 30;
  const targetTotal = deficitData.target_total || 90;

  // 1. Update header button badge counter
  const headerBadge = document.getElementById("header-deficit-badge");
  if (headerBadge) {
    headerBadge.textContent = summary.total_missing ?? 78;
  }

  // 2. Render KPI Summary Bar (#deficit-kpi-bar)
  const kpiBar = document.getElementById("deficit-kpi-bar");
  if (kpiBar) {
    kpiBar.innerHTML = `
      <div class="deficit-kpi-item total-deficit">
        <div class="deficit-kpi-title-row">
          <span>Общий дефицит в сетку 90</span>
          <span>⚖️</span>
        </div>
        <div class="deficit-kpi-numbers">
          <span class="deficit-num-missing" style="color: #f87171;">-${summary.total_missing ?? 0}</span>
          <span class="deficit-num-sub">из ${targetTotal} мест</span>
        </div>
        <div class="deficit-kpi-foot">
          <span>🟢 Работают: <b>${summary.total_working ?? 0}</b> аккаунтов</span>
        </div>
      </div>

      <div class="deficit-kpi-item">
        <div class="deficit-kpi-title-row">
          <span style="color: #fca5a5;">▶ YouTube дефицит</span>
          <span>🎬</span>
        </div>
        <div class="deficit-kpi-numbers">
          <span class="deficit-num-missing" style="color: #fb7185;">-${summary.yt_missing ?? 0}</span>
          <span class="deficit-num-sub">из ${targetPerPlat} каналов</span>
        </div>
        <div class="deficit-kpi-foot">
          <span style="color: #38bdf8;">🟢 В норме: <b>${summary.yt_working ?? 0}</b> каналов</span>
        </div>
      </div>

      <div class="deficit-kpi-item">
        <div class="deficit-kpi-title-row">
          <span style="color: #7dd3fc;">📱 TikTok дефицит</span>
          <span>📱</span>
        </div>
        <div class="deficit-kpi-numbers">
          <span class="deficit-num-missing" style="color: #38bdf8;">-${summary.tt_missing ?? 0}</span>
          <span class="deficit-num-sub">из ${targetPerPlat} профилей</span>
        </div>
        <div class="deficit-kpi-foot">
          <span style="color: ${summary.tt_working > 0 ? '#34d399' : '#94a3b8'};">🟢 В норме: <b>${summary.tt_working ?? 0}</b> профилей</span>
        </div>
      </div>

      <div class="deficit-kpi-item">
        <div class="deficit-kpi-title-row">
          <span style="color: #f472b6;">📸 Instagram дефицит</span>
          <span>📸</span>
        </div>
        <div class="deficit-kpi-numbers">
          <span class="deficit-num-missing" style="color: #f472b6;">-${summary.ig_missing ?? 0}</span>
          <span class="deficit-num-sub">из ${targetPerPlat} профилей</span>
        </div>
        <div class="deficit-kpi-foot">
          <span style="color: ${summary.ig_working > 0 ? '#34d399' : '#94a3b8'};">🟢 В норме: <b>${summary.ig_working ?? 0}</b> профилей</span>
        </div>
      </div>
    `;
  }

  // 3. Render Categories Deficit Grid (#deficit-cats-container)
  const catsContainer = document.getElementById("deficit-cats-container");
  if (catsContainer) {
    catsContainer.innerHTML = cats.map((cat) => {
      const modeData = cat[mode] || {
        missing_yt_count: 0,
        missing_tt_count: 0,
        missing_ig_count: 0,
        total_missing: 0,
        missing_yt: [],
        missing_tt: [],
        missing_ig: []
      };

      const profilesDetails = cat.profiles_details || [];
      const isOk = modeData.total_missing === 0;

      // Group missing profiles info
      const missingProfilesMap = new Map();
      (modeData.missing_yt || []).forEach(item => {
        if (!missingProfilesMap.has(item.profile)) missingProfilesMap.set(item.profile, {});
        missingProfilesMap.get(item.profile).yt = item;
      });
      (modeData.missing_tt || []).forEach(item => {
        if (!missingProfilesMap.has(item.profile)) missingProfilesMap.set(item.profile, {});
        missingProfilesMap.get(item.profile).tt = item;
      });
      (modeData.missing_ig || []).forEach(item => {
        if (!missingProfilesMap.has(item.profile)) missingProfilesMap.set(item.profile, {});
        missingProfilesMap.get(item.profile).ig = item;
      });

      return `
        <div class="deficit-cat-card">
          <div class="deficit-cat-top">
            <div class="deficit-cat-header-left">
              <div class="deficit-cat-num">${cat.index}</div>
              <div class="deficit-cat-name">${esc(cat.name)}</div>
            </div>
            <span class="deficit-cat-badge ${isOk ? 'ok' : ''}">
              ${isOk ? '✅ Сетка закрыта' : `⚠️ Не хватает: ${modeData.total_missing}`}
            </span>
          </div>

          <div class="deficit-platforms-row">
            <div class="deficit-plat-cell">
              <span class="deficit-plat-title">▶ YouTube</span>
              <div class="deficit-plat-val ${modeData.missing_yt_count > 0 ? 'bad' : 'good'}">
                ${modeData.missing_yt_count > 0 ? `-${modeData.missing_yt_count}` : '✓ ОК'}
                <span class="deficit-plat-sub">из ${cat.profiles_count}</span>
              </div>
            </div>

            <div class="deficit-plat-cell">
              <span class="deficit-plat-title">📱 TikTok</span>
              <div class="deficit-plat-val ${modeData.missing_tt_count > 0 ? 'bad' : 'good'}">
                ${modeData.missing_tt_count > 0 ? `-${modeData.missing_tt_count}` : '✓ ОК'}
                <span class="deficit-plat-sub">из ${cat.profiles_count}</span>
              </div>
            </div>

            <div class="deficit-plat-cell">
              <span class="deficit-plat-title">📸 Instagram</span>
              <div class="deficit-plat-val ${modeData.missing_ig_count > 0 ? 'bad' : 'good'}">
                ${modeData.missing_ig_count > 0 ? `-${modeData.missing_ig_count}` : '✓ ОК'}
                <span class="deficit-plat-sub">из ${cat.profiles_count}</span>
              </div>
            </div>
          </div>

          <div class="deficit-profiles-box">
            ${profilesDetails.map((pd) => {
              const mYt = missingProfilesMap.get(pd.profile)?.yt;
              const mTt = missingProfilesMap.get(pd.profile)?.tt;
              const mIg = missingProfilesMap.get(pd.profile)?.ig;
              const hasMissing = mYt || mTt || mIg;

              return `
                <div class="deficit-prof-row">
                  <span class="deficit-prof-name">${esc(pd.profile)}</span>
                  <div class="deficit-prof-missing-tags">
                    ${!hasMissing ? `
                      <span class="missing-tag" style="background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.3);">
                        ✓ Все 3 в норме
                      </span>
                    ` : ''}
                    ${mYt ? `
                      <span class="missing-tag yt" title="YouTube: ${esc(mYt.reason)}">
                        YT: <span class="missing-reason-dim">${esc(mYt.reason)}</span>
                      </span>
                    ` : ''}
                    ${mTt ? `
                      <span class="missing-tag tt" title="TikTok: ${esc(mTt.reason)}">
                        TT: <span class="missing-reason-dim">${esc(mTt.reason)}</span>
                      </span>
                    ` : ''}
                    ${mIg ? `
                      <span class="missing-tag ig" title="Instagram: ${esc(mIg.reason)}">
                        IG: <span class="missing-reason-dim">${esc(mIg.reason)}</span>
                      </span>
                    ` : ''}
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }).join("");
  }
}

window.copyDeficitSummaryList = function () {
  if (!rawData || !rawData.deficit_analysis) {
    showToast("Данные ещё загружаются...");
    return;
  }
  const mode = currentDeficitMode || "c50";
  const s = rawData.deficit_analysis.summaries?.[mode] || {};
  const cats = rawData.deficit_analysis.categories_deficit || [];

  const modeLabel = mode === "c50" ? "≥ 50 просмотров на крайних 7 роликах" : (mode === "c200" ? "≥ 200 просмотров (~1000)" : "По живой авторизации");

  let text = `Дефицит аккаунтов Дениса Рябцева (критерий: ${modeLabel})\n`;
  text += `Всего не хватает до сетки 90: ${s.total_missing} шт.\n`;
  text += `- YouTube: не хватает ${s.yt_missing} шт. (в норме ${s.yt_working} из 30)\n`;
  text += `- TikTok: не хватает ${s.tt_missing} шт. (в норме ${s.tt_working} из 30)\n`;
  text += `- Instagram: не хватает ${s.ig_missing} шт. (в норме ${s.ig_working} из 30)\n\n`;
  text += `Детализация по категориям:\n`;

  cats.forEach(c => {
    const md = c[mode] || {};
    text += `\n[${c.name}] — Профилей: ${c.profiles_count}. Не хватает: ${md.total_missing} (YT: -${md.missing_yt_count}, TT: -${md.missing_tt_count}, IG: -${md.missing_ig_count})\n`;
    (c.profiles_details || []).forEach(p => {
      const issues = [];
      const mYt = md.missing_yt?.find(x => x.profile === p.profile);
      const mTt = md.missing_tt?.find(x => x.profile === p.profile);
      const mIg = md.missing_ig?.find(x => x.profile === p.profile);
      if (mYt) issues.push(`YT (${mYt.reason})`);
      if (mTt) issues.push(`TT (${mTt.reason})`);
      if (mIg) issues.push(`IG (${mIg.reason})`);
      if (issues.length > 0) {
        text += `  • ${p.profile}: не хватает [${issues.join(', ')}]\n`;
      } else {
        text += `  • ${p.profile}: все 3 платформы в норме ✓\n`;
      }
    });
  });

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast("📋 Полный список нехватки скопирован в буфер!");
    }).catch(() => {
      showToast("⚠️ Не удалось скопировать");
    });
  } else {
    showToast("📋 Скопировано");
  }
};

// Render 6 Content Categories
function renderCategories(cats) {
  const container = document.getElementById("categories-container");
  if (!container || !cats) return;

  const totalPeriodViews = cats.reduce(
    (acc, cat) => acc + (cat.periods?.[currentPeriod]?.views ?? cat.total_views),
    0
  );

  container.innerHTML = cats
    .map((cat) => {
      const isSelected = selectedCategoryIndex === cat.index;
      const catViews = cat.periods?.[currentPeriod]?.views ?? cat.total_views;
      const catPubs = cat.periods?.[currentPeriod]?.published_count ?? cat.published_total;
      const sharePct =
        totalPeriodViews > 0 ? ((catViews / totalPeriodViews) * 100).toFixed(1) : cat.views_share_pct;

      return `
      <div class="cat-card ${isSelected ? "active" : ""}" onclick="selectCategory(${cat.index})" title="Нажмите, чтобы показать профили категории ${cat.index}">
        <div class="cat-top">
          <div class="cat-num-badge">${cat.index}</div>
          <div class="cat-title">${esc(cat.name)}</div>
          <div class="cat-share-badge">${sharePct}% пула</div>
        </div>

        <div class="cat-views-row">
          <span class="cat-views-num">${formatNumber(catViews)}</span>
          <span class="cat-views-label">просмотров (${PERIOD_LABELS[currentPeriod].toLowerCase()})</span>
        </div>

        <div class="cat-progress-track">
          <div class="cat-progress-fill" style="width: ${Math.max(4, Math.min(100, sharePct))}%"></div>
        </div>

        <div class="cat-footer-stats">
          <span>👥 <b>${cat.profiles_count}</b> аккаунтов</span>
          <span>🎬 Роликов: <b>${catPubs}</b> шт</span>
        </div>

        <div class="cat-working-badge" title="${cat.working_accounts_label || ''}">
          <span class="working-dot"></span>
          <span><b>${cat.working_accounts_count ?? cat.profiles_count} из ${cat.profiles_count}</b> работают</span>
          ${cat.archived_accounts_count > 0 ? `<span class="cat-archived-tag">· 📦 ${cat.archived_accounts_count} в архиве</span>` : ''}
        </div>
      </div>
    `;
    })
    .join("");
}

// Select Category Interaction
window.selectCategory = function (catIndex) {
  if (selectedCategoryIndex === catIndex) {
    selectedCategoryIndex = null;
    closeCategoryProfilesPanel();
  } else {
    selectedCategoryIndex = catIndex;
    renderCategoryProfilesPanel(catIndex);
  }
  renderCategories(rawData.categories);
};

window.closeCategoryProfilesPanel = function () {
  selectedCategoryIndex = null;
  const panel = document.getElementById("category-profiles-panel");
  if (panel) panel.classList.add("hidden");
  document.querySelectorAll(".cat-card").forEach((c) => c.classList.remove("active"));
};

// Render Selected Category Profiles Drop Panel
function renderCategoryProfilesPanel(catIndex) {
  const panel = document.getElementById("category-profiles-panel");
  if (!panel || !rawData) return;

  const cat = rawData.categories.find((c) => c.index === catIndex);
  if (!cat) return;

  const badgeEl = document.getElementById("cat-panel-badge");
  const titleEl = document.getElementById("cat-panel-title");
  const metaEl = document.getElementById("cat-panel-meta");
  const periodBadge = document.getElementById("cat-panel-period-badge");
  const gridEl = document.getElementById("category-profiles-grid");

  if (badgeEl) badgeEl.textContent = `Категория ${cat.index}`;
  if (titleEl) titleEl.textContent = cat.name;
  const catViews = cat.periods?.[currentPeriod]?.views ?? cat.total_views;
  const catPubs = cat.periods?.[currentPeriod]?.published_count ?? cat.published_total;
  if (metaEl) {
    metaEl.textContent = `Профилей: ${cat.profiles_count} (${cat.working_accounts_count ?? cat.profiles_count} работают, ${cat.archived_accounts_count ?? 0} в архиве) · Просмотров: ${formatNumber(catViews)} · Выложено: ${catPubs} шт (${PERIOD_LABELS[currentPeriod].toLowerCase()})`;
  }
  if (periodBadge) {
    periodBadge.textContent = `Период: ${PERIOD_LABELS[currentPeriod] || "Всё время"}`;
  }

  // Filter accounts belonging to this category
  const catAccounts = (rawData.accounts || []).filter((a) => (cat.profiles || []).includes(a.profile));

  // Sort by active period views descending
  catAccounts.sort((a, b) => {
    const vA = a.periods?.[currentPeriod]?.views ?? a.total_views;
    const vB = b.periods?.[currentPeriod]?.views ?? b.total_views;
    return vB - vA;
  });

  if (gridEl) {
    gridEl.innerHTML = catAccounts
      .map((a) => {
        const aViews = a.periods?.[currentPeriod]?.views ?? a.total_views;
        const aPubs = a.periods?.[currentPeriod]?.published_count ?? a.published_total;
        const yt = a.youtube || {};
        const ig = a.instagram || {};
        const tt = a.tiktok || {};

        // 1. YouTube Button
        const ytDeadClass = yt.is_dead ? "dead" : "";
        const ytDeadTitle = yt.is_dead ? `YouTube: ОТЛЕТЕЛ ⚠️ ${esc(yt.dead_reason || 'Вход не выполнен')} | ` : "";
        const ytDeadTag = yt.is_dead ? `<span class="dead-tag">ОТЛЕТЕЛ</span>` : "";

        const ytChannelBtn = yt.channel_url
          ? `<a href="${esc(yt.channel_url)}" target="_blank" rel="noopener noreferrer" class="plat-badge yt ${ytDeadClass}" title="${ytDeadTitle}Открыть YouTube канал (${esc(yt.title || a.profile)})">▶ YouTube ${ytDeadTag} ↗</a>`
          : `<span class="plat-badge yt disabled" title="Канал не привязан">▶ YT: нет</span>`;

        const ytShortBtn = yt.last_video
          ? `<a href="${esc(yt.last_video)}" target="_blank" rel="noopener noreferrer" class="plat-badge yt-short ${ytDeadClass}" title="Открыть крайний Short">🎬 Short ↗</a>`
          : "";

        // 2. TikTok Button
        const ttDeadClass = tt.is_dead ? "dead" : "";
        const ttDeadTitle = tt.is_dead ? `TikTok: ОТЛЕТЕЛ ⚠️ ${esc(tt.dead_reason || 'Вход не выполнен')} | ` : "";
        const ttDeadTag = tt.is_dead ? `<span class="dead-tag">ОТЛЕТЕЛ</span>` : "";

        const ttProfileBtn = tt.profile_url
          ? `<a href="${esc(tt.profile_url)}" target="_blank" rel="noopener noreferrer" class="plat-badge tt ${ttDeadClass}" title="${ttDeadTitle}Открыть TikTok профиль (@${esc(tt.username)})">📱 TikTok ${ttDeadTag} ↗</a>`
          : `<span class="plat-badge tt disabled" title="TikTok не привязан">📱 TT: нет</span>`;

        const ttVideoBtn = tt.last_video
          ? `<a href="${esc(tt.last_video)}" target="_blank" rel="noopener noreferrer" class="plat-badge tt-video ${ttDeadClass}" title="Открыть видео TikTok">🎬 Видео ↗</a>`
          : "";

        // 3. Instagram Button
        const igDeadClass = ig.is_dead ? "dead" : "";
        const igDeadTitle = ig.is_dead ? `Instagram: ОТЛЕТЕЛ ⚠️ ${esc(ig.dead_reason || 'Вход не выполнен')} | ` : "";
        const igDeadTag = ig.is_dead ? `<span class="dead-tag">ОТЛЕТЕЛ</span>` : "";

        const igProfileBtn = (ig.reels_url || ig.profile_url)
          ? `<a href="${esc(ig.reels_url || ig.profile_url)}" target="_blank" rel="noopener noreferrer" class="plat-badge ig ${igDeadClass}" title="${igDeadTitle}Открыть Instagram Reels (@${esc(ig.username)})">📸 Reels ${igDeadTag} ↗</a>`
          : `<span class="plat-badge ig disabled" title="Instagram не привязан">📸 IG: нет</span>`;

        const statusBadge = a.is_archived
          ? `<span class="badge badge-archive" title="${esc(a.archive_reason)}">📦 В архиве</span>`
          : a.is_working
          ? `<span class="badge badge-working" title="Аккаунт активен и работает по категории">🟢 Работает</span>`
          : a.is_fully_dead
          ? `<span class="badge status-dead" title="Все платформы аккаунта отлетели">⚪ Отлетел</span>`
          : a.is_stagnant
          ? `<span class="badge status-stagnant" title="${esc(a.stagnant_reason)}">⚠️ Не набирает > 7 дн</span>`
          : a.status_code === "viral"
          ? `<span class="badge status-viral">🔥 Растёт</span>`
          : a.published_today > 0
          ? `<span class="badge status-active">🟢 Активен</span>`
          : `<span class="badge status-normal">🟢 В ротации</span>`;

        return `
        <div class="cat-profile-card ${a.is_archived ? "is-archive-card" : (a.is_fully_dead ? "is-dead-card" : "")} ${a.is_stagnant ? "stagnant" : ""}">
          <div class="cat-prof-top">
            <div>
              <div class="cat-prof-id">${esc(a.profile)}</div>
              <div class="cat-prof-channel-title" title="${esc(yt.title || "")}">${esc(yt.title || a.profile)}</div>
            </div>
            ${statusBadge}
          </div>

          <div class="cat-prof-metrics-grid">
            <div class="cat-prof-metric-item">
              <span class="cat-prof-metric-lbl">Просмотры (${PERIOD_LABELS[currentPeriod].toLowerCase()})</span>
              <span class="cat-prof-metric-val">${formatNumber(aViews)}</span>
            </div>
            <div class="cat-prof-metric-item">
              <span class="cat-prof-metric-lbl">Выложено роликов</span>
              <span class="cat-prof-metric-val" style="color: #34d399">${aPubs} <span style="font-size: 11px; color: var(--text-dim)">шт</span></span>
            </div>
          </div>

          <div style="font-size: 11px; color: var(--text-muted); display: flex; justify-content: space-between;">
            <span>Крайний ролик: <b>${esc(a.last_published_text)}</b></span>
            <span>Аудитория: <b>${formatNumber(a.total_audience)}</b></span>
          </div>

          <div class="cat-prof-links">
            ${ytChannelBtn}
            ${ytShortBtn}
            ${ttProfileBtn}
            ${ttVideoBtn}
            ${igProfileBtn}
            <button class="btn btn-secondary small" style="margin-left: auto;" onclick="openAccountDetail('${esc(a.profile)}')">Детали ↗</button>
          </div>
        </div>
      `;
      })
      .join("");
  }

  panel.classList.remove("hidden");
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Filter and Sort Accounts
function getFilteredAccounts() {
  if (!rawData || !rawData.accounts) return [];
  let list = [...rawData.accounts];

  // 1. Search filter
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    list = list.filter(
      (a) =>
        a.profile.toLowerCase().includes(q) ||
        (a.category_name && a.category_name.toLowerCase().includes(q)) ||
        (a.youtube?.title && a.youtube.title.toLowerCase().includes(q)) ||
        (a.instagram?.username && a.instagram.username.toLowerCase().includes(q)) ||
        (a.tiktok?.username && a.tiktok.username.toLowerCase().includes(q))
    );
  }

  // 2. Quick Pill filter
  if (currentFilter === "working") {
    list = list.filter((a) => a.is_working);
  } else if (currentFilter === "archive") {
    list = list.filter((a) => a.is_archived);
  } else if (currentFilter === "dead") {
    list = list.filter((a) => a.has_dead_platforms || a.is_fully_dead || a.is_archived);
  } else if (currentFilter === "low-views") {
    list = list.filter((a) => (a.total_views || 0) <= 50 || a.is_archived);
  } else if (currentFilter === "stagnant") {
    list = list.filter((a) => a.is_stagnant);
  } else if (currentFilter === "active") {
    list = list.filter((a) => a.published_today > 0 || a.published_yesterday > 0);
  } else if (currentFilter === "viral") {
    list = list.filter((a) => a.total_views >= 300);
  } else if (currentFilter.startsWith("cat-")) {
    const idx = parseInt(currentFilter.replace("cat-", ""), 10);
    list = list.filter((a) => a.category_index === idx);
  }

  // 3. Sorting
  const col = currentSort.column;
  const desc = currentSort.desc;

  list.sort((a, b) => {
    let valA, valB;
    if (col === "views") {
      valA = a.periods?.[currentPeriod]?.views ?? a.total_views;
      valB = b.periods?.[currentPeriod]?.views ?? b.total_views;
    } else if (col === "profile") {
      valA = a.profile;
      valB = b.profile;
    } else if (col === "category") {
      valA = a.category_index;
      valB = b.category_index;
    } else if (col === "today") {
      valA = (a.periods?.[currentPeriod]?.published_count ?? a.published_today) * 1000 + a.published_yesterday;
      valB = (b.periods?.[currentPeriod]?.published_count ?? b.published_today) * 1000 + b.published_yesterday;
    } else if (col === "last_pub") {
      valA = a.last_published_at || 0;
      valB = b.last_published_at || 0;
    } else if (col === "status") {
      valA = a.is_stagnant ? 0 : 1;
      valB = b.is_stagnant ? 0 : 1;
    } else {
      valA = a.periods?.[currentPeriod]?.views ?? a.total_views;
      valB = b.periods?.[currentPeriod]?.views ?? b.total_views;
    }

    if (valA < valB) return desc ? 1 : -1;
    if (valA > valB) return desc ? -1 : 1;
    return 0;
  });

  return list;
}

// Render Accounts Matrix (Table and Cards)
function renderAccounts() {
  const accounts = getFilteredAccounts();
  const countEl = document.getElementById("filtered-count");
  if (countEl) countEl.textContent = accounts.length;

  const tbody = document.getElementById("accounts-tbody");
  const cardsContainer = document.getElementById("accounts-cards-grid");

  if (!tbody || !cardsContainer) return;

  if (accounts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 32px; color: var(--text-dim)">Ни одного аккаунта не найдено по заданному фильтру</td></tr>`;
    cardsContainer.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 32px; color: var(--text-dim)">Ни одного аккаунта не найдено</div>`;
    return;
  }

  // 1. Table Render
  tbody.innerHTML = accounts
    .map((a) => {
      const yt = a.youtube || {};
      const ig = a.instagram || {};
      const tt = a.tiktok || {};

      const aViews = a.periods?.[currentPeriod]?.views ?? a.total_views;
      const aPubs = a.periods?.[currentPeriod]?.published_count ?? a.published_total;

      // 1. YouTube Badge
      const ytDeadClass = yt.is_dead ? "dead" : "";
      const ytDeadTitle = yt.is_dead ? `YouTube: ОТЛЕТЕЛ ⚠️ ${esc(yt.dead_reason || 'Вход не выполнен')} | ` : "";
      const ytDeadTag = yt.is_dead ? `<span class="dead-tag">ОТЛЕТЕЛ</span>` : "";

      const ytBadge = yt.channel_url
        ? `<a href="${esc(yt.channel_url)}" target="_blank" rel="noopener noreferrer" class="plat-badge yt ${ytDeadClass}" title="${ytDeadTitle}Открыть YouTube канал: ${esc(yt.title)} (${formatNumber(yt.views)} views)">▶ YT: ${formatNumber(yt.views)} ${ytDeadTag}</a>`
        : `<span class="plat-badge yt disabled" title="Канал не привязан">▶ YT</span>`;

      // 2. TikTok Badge
      const ttDeadClass = tt.is_dead ? "dead" : "";
      const ttDeadTitle = tt.is_dead ? `TikTok: ОТЛЕТЕЛ ⚠️ ${esc(tt.dead_reason || 'Вход не выполнен')} | ` : "";
      const ttDeadTag = tt.is_dead ? `<span class="dead-tag">ОТЛЕТЕЛ</span>` : "";

      const ttBadge = tt.profile_url
        ? `<a href="${esc(tt.profile_url)}" target="_blank" rel="noopener noreferrer" class="plat-badge tt ${ttDeadClass}" title="${ttDeadTitle}Открыть TikTok @${esc(tt.username)} (${formatNumber(tt.views)} views)">📱 TT: ${formatNumber(tt.views)} ${ttDeadTag}</a>`
        : `<span class="plat-badge tt disabled" title="TikTok не привязан">📱 TT</span>`;

      // 3. Instagram Badge
      const igDeadClass = ig.is_dead ? "dead" : "";
      const igDeadTitle = ig.is_dead ? `Instagram: ОТЛЕТЕЛ ⚠️ ${esc(ig.dead_reason || 'Вход не выполнен')} | ` : "";
      const igDeadTag = ig.is_dead ? `<span class="dead-tag">ОТЛЕТЕЛ</span>` : "";

      const igBadge = (ig.reels_url || ig.profile_url)
        ? `<a href="${esc(ig.reels_url || ig.profile_url)}" target="_blank" rel="noopener noreferrer" class="plat-badge ig ${igDeadClass}" title="${igDeadTitle}Открыть Instagram Reels @${esc(ig.username)} (${formatNumber(ig.views)} views)">📸 IG: ${formatNumber(ig.views)} ${igDeadTag}</a>`
        : `<span class="plat-badge ig disabled" title="Instagram не привязан">📸 IG</span>`;

      let statusBadge;
      if (a.is_archived) {
        statusBadge = `<span class="badge badge-archive" title="${esc(a.archive_reason)}">📦 В архиве</span>`;
      } else if (a.is_working) {
        statusBadge = `<span class="badge badge-working" title="Аккаунт активен и работает по категории">🟢 Работает</span>`;
      } else if (a.is_fully_dead) {
        statusBadge = `<span class="badge status-dead" title="Все платформы аккаунта отлетели или заблокированы">⚪ Отлетел</span>`;
      } else if (a.is_stagnant) {
        statusBadge = `<span class="badge status-stagnant" title="${esc(a.stagnant_reason)}">⚠️ Не набирает > 7 дн</span>`;
      } else if (a.status_code === "viral") {
        statusBadge = `<span class="badge status-viral">🔥 Растёт</span>`;
      } else if (a.published_today > 0) {
        statusBadge = `<span class="badge status-active">🟢 Активен</span>`;
      } else {
        statusBadge = `<span class="badge status-normal">🟢 В ротации</span>`;
      }

      const trClass = a.is_archived ? "is-archive-row" : (a.is_fully_dead ? "is-dead-row" : (a.is_stagnant ? "is-stagnant-row" : ""));

      return `
      <tr class="${trClass}">
        <td>
          <div class="prof-cell">
            <span class="prof-name">${esc(a.profile)}</span>
            <span class="prof-title" title="${esc(yt.title || "")}">${esc(yt.title || a.profile)}</span>
          </div>
        </td>
        <td>
          <span class="cat-tag" title="${esc(a.category_name)}">${esc(a.category_name)}</span>
        </td>
        <td>
          ${statusBadge}
        </td>
        <td>
          <div class="views-cell">
            <span class="views-total" title="За выбранный период: ${formatNumber(aViews)} (Всего: ${formatNumber(a.total_views)})">${formatNumber(aViews)}</span>
            <span class="views-breakdown">
              <span>YT: ${formatNumber(a.periods?.[currentPeriod]?.yt_views ?? yt.views ?? 0)}</span> ·
              <span>TT: ${formatNumber(a.periods?.[currentPeriod]?.tt_views ?? tt.views ?? 0)}</span> ·
              <span>IG: ${formatNumber(a.periods?.[currentPeriod]?.ig_views ?? ig.views ?? 0)}</span>
            </span>
          </div>
        </td>
        <td>
          <div class="platform-icons">
            ${ytBadge}
            ${ttBadge}
            ${igBadge}
          </div>
        </td>
        <td>
          <div class="pub-count-cell">
            <span class="pub-pill-today" title="Выложено сегодня">${a.published_today} сег</span>
            <span class="pub-pill-yesterday" title="Выложено вчера">${a.published_yesterday} вч</span>
            <span style="color: var(--text-dim)" title="Всего выложено">(${a.published_total})</span>
          </div>
        </td>
        <td>
          <div style="font-size: 12px; color: ${a.is_stagnant ? "#fde68a" : "var(--text-main)"}">
            ${esc(a.last_published_text)}
          </div>
        </td>
        <td>
          <div style="font-size: 12px; font-weight: 600; color: #a5b4fc">
            ${formatNumber(a.total_audience)}
          </div>
        </td>
        <td>
          <button class="btn btn-secondary small" onclick="openAccountDetail('${esc(a.profile)}')">Детали</button>
        </td>
      </tr>
    `;
    })
    .join("");

  // 2. Cards Render (Alternate Grid View)
  cardsContainer.innerHTML = accounts
    .map((a) => {
      const yt = a.youtube || {};
      const ig = a.instagram || {};
      const tt = a.tiktok || {};

      const aViews = a.periods?.[currentPeriod]?.views ?? a.total_views;

      const ytDeadClass = yt.is_dead ? "dead" : "";
      const ytDeadTitle = yt.is_dead ? `YouTube: ОТЛЕТЕЛ ⚠️ ${esc(yt.dead_reason || 'Вход не выполнен')} | ` : "";
      const ytDeadTag = yt.is_dead ? `<span class="dead-tag">ОТЛЕТЕЛ</span>` : "";

      const ttDeadClass = tt.is_dead ? "dead" : "";
      const ttDeadTitle = tt.is_dead ? `TikTok: ОТЛЕТЕЛ ⚠️ ${esc(tt.dead_reason || 'Вход не выполнен')} | ` : "";
      const ttDeadTag = tt.is_dead ? `<span class="dead-tag">ОТЛЕТЕЛ</span>` : "";

      const igDeadClass = ig.is_dead ? "dead" : "";
      const igDeadTitle = ig.is_dead ? `Instagram: ОТЛЕТЕЛ ⚠️ ${esc(ig.dead_reason || 'Вход не выполнен')} | ` : "";
      const igDeadTag = ig.is_dead ? `<span class="dead-tag">ОТЛЕТЕЛ</span>` : "";

      const cardClass = a.is_archived ? "is-archive-card" : (a.is_fully_dead ? "is-dead-card" : (a.is_stagnant ? "is-stagnant-card" : ""));
      const cardBadge = a.is_archived
        ? `<span class="badge badge-archive" title="${esc(a.archive_reason)}">📦 В архиве</span>`
        : a.is_working
        ? `<span class="badge badge-working" title="Аккаунт активен и работает по категории">🟢 Работает</span>`
        : a.is_fully_dead
        ? `<span class="badge status-dead">⚪ Отлетел</span>`
        : a.is_stagnant
        ? `<span class="badge status-stagnant">⚠️ Стагнация > 7 дн</span>`
        : `<span class="badge status-active">🟢 В ротации</span>`;

      return `
      <div class="account-card-item ${cardClass}">
        <div style="display: flex; justify-content: space-between; align-items: flex-start">
          <div>
            <div style="font-size: 15px; font-weight: 800; color: #fff">${esc(a.profile)}</div>
            <div style="font-size: 11px; color: var(--text-dim)">${esc(yt.title || "")}</div>
          </div>
          <span class="cat-tag">${esc(a.category_name)}</span>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: baseline; margin: 4px 0">
          <div style="font-size: 22px; font-weight: 800; color: #f59e0b">${formatNumber(aViews)} <span style="font-size: 11px; color: var(--text-dim)">просм.</span></div>
          ${cardBadge}
        </div>

        <div style="font-size: 11px; color: var(--text-muted); display: flex; justify-content: space-between; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px">
          <span>Сегодня: <b>${a.published_today}</b> · Вчера: <b>${a.published_yesterday}</b></span>
          <span>Крайний: <b>${esc(a.last_published_text)}</b></span>
        </div>

        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px">
          ${yt.channel_url ? `<a href="${esc(yt.channel_url)}" target="_blank" rel="noopener noreferrer" class="plat-badge yt ${ytDeadClass}" title="${ytDeadTitle}">▶ YT ${ytDeadTag}</a>` : ""}
          ${tt.profile_url ? `<a href="${esc(tt.profile_url)}" target="_blank" rel="noopener noreferrer" class="plat-badge tt ${ttDeadClass}" title="${ttDeadTitle}">📱 TT ${ttDeadTag}</a>` : ""}
          ${(ig.reels_url || ig.profile_url) ? `<a href="${esc(ig.reels_url || ig.profile_url)}" target="_blank" rel="noopener noreferrer" class="plat-badge ig ${igDeadClass}" title="${igDeadTitle}">📸 IG ${igDeadTag}</a>` : ""}
          <button class="btn btn-secondary small" style="margin-left: auto" onclick="openAccountDetail('${esc(a.profile)}')">Детали</button>
        </div>
      </div>
    `;
    })
    .join("");
}

// Quick Filter Switcher
window.setQuickFilter = function (filterKey) {
  currentFilter = filterKey;
  if (!filterKey.startsWith("cat-")) {
    selectedCategoryIndex = null;
  }
  updatePillsUI();
  renderCategories(rawData.categories);
  renderAccounts();
};

function updatePillsUI() {
  const pills = document.querySelectorAll(".pill");
  pills.forEach((p) => {
    p.classList.toggle("active", p.dataset.filter === currentFilter);
  });
}

// Open Account Modal Details
window.openAccountDetail = function (profileName) {
  if (!rawData || !rawData.accounts) return;
  const a = rawData.accounts.find((item) => item.profile === profileName);
  if (!a) return;

  const modal = document.getElementById("detail-modal");
  const title = document.getElementById("modal-profile-title");
  const catBadge = document.getElementById("modal-category-badge");
  const body = document.getElementById("modal-body");

  title.textContent = `${a.profile} — Подробная карточка`;
  catBadge.textContent = a.category_name;

  const yt = a.youtube || {};
  const ig = a.instagram || {};
  const tt = a.tiktok || {};

  const archiveNotice = a.is_archived
    ? `<div style="background: rgba(100,116,139,0.18); border: 1px solid rgba(148,163,184,0.4); border-radius: 8px; padding: 12px 16px; margin-bottom: 14px; display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 20px;">📦</span>
        <div>
          <div style="font-size: 13px; font-weight: 700; color: #cbd5e1;">Аккаунт находится в архиве</div>
          <div style="font-size: 12px; color: #94a3b8;">${esc(a.archive_reason)}</div>
        </div>
      </div>`
    : (a.is_working ? `<div style="background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.3); border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; display: flex; align-items: center; gap: 8px;">
        <span>🟢</span>
        <span style="font-size: 12px; color: #34d399; font-weight: 600;">Активно работает по категории: <b>${esc(a.category_name)}</b></span>
      </div>` : '');

  body.innerHTML = `
    ${archiveNotice}
    <!-- Top Stats Row -->
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; background: rgba(0,0,0,0.25); padding: 14px; border-radius: 8px;">
      <div>
        <div style="font-size: 11px; color: var(--text-dim); text-transform: uppercase">Просмотры</div>
        <div style="font-size: 20px; font-weight: 800; color: #f59e0b">${formatNumber(a.total_views)}</div>
      </div>
      <div>
        <div style="font-size: 11px; color: var(--text-dim); text-transform: uppercase">Выложено роликов</div>
        <div style="font-size: 20px; font-weight: 800; color: #34d399">${a.published_total} <span style="font-size: 12px; color: var(--text-dim)">(${a.published_today} сег)</span></div>
      </div>
      <div>
        <div style="font-size: 11px; color: var(--text-dim); text-transform: uppercase">Аудитория</div>
        <div style="font-size: 20px; font-weight: 800; color: #a5b4fc">${formatNumber(a.total_audience)}</div>
      </div>
    </div>

    ${
      a.is_fully_dead
        ? `<div style="padding: 10px 14px; background: rgba(148, 163, 184, 0.12); border: 1px solid rgba(148, 163, 184, 0.35); border-radius: 6px; font-size: 13px; color: #cbd5e1;">
            ⚪ <b>Аккаунт отлетел:</b> все площадки потеряли авторизацию или заблокированы.
          </div>`
        : a.has_dead_platforms
        ? `<div style="padding: 10px 14px; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 6px; font-size: 13px; color: #fde68a;">
            ⚠️ <b>Частично отлетел:</b> ${esc(a.dead_platforms.join(', '))} отлетели (нужен повторный вход или прохождение проверки).
          </div>`
        : a.is_stagnant
        ? `<div style="padding: 10px 14px; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 6px; font-size: 13px; color: #fde68a;">
            ⚠️ <b>Статус стагнации:</b> ${esc(a.stagnant_reason)}
          </div>`
        : `<div style="padding: 10px 14px; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; font-size: 13px; color: #34d399;">
            🟢 <b>Аккаунт активен:</b> публикует ролики и находится в ротации.
          </div>`
    }

    <!-- Social Platforms Deep Dive -->
    <div style="display: flex; flex-direction: column; gap: 12px">
      <!-- YouTube -->
      <div style="${yt.is_dead ? 'background: rgba(148, 163, 184, 0.06); border: 1px dashed rgba(148, 163, 184, 0.35);' : 'background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25);'} border-radius: 8px; padding: 12px">
        <div style="display: flex; justify-content: space-between; align-items: center">
          <div style="display: flex; align-items: center; gap: 8px">
            <b style="color: ${yt.is_dead ? '#94a3b8' : '#fca5a5'}">▶ YouTube: ${esc(yt.title || "Канал")}</b>
            ${yt.is_dead ? '<span class="badge status-dead">⚠️ ОТЛЕТЕЛ</span>' : '<span class="badge status-active">🟢 Активен</span>'}
          </div>
          ${yt.channel_url ? `<a href="${esc(yt.channel_url)}" target="_blank" rel="noopener noreferrer" class="btn ${yt.is_dead ? 'btn-secondary' : 'btn-primary'} small">${yt.is_dead ? 'Проверить канал ↗' : 'Открыть канал ↗'}</a>` : '<span class="badge" style="background: rgba(255,255,255,0.05); color: var(--text-dim)">Не привязан</span>'}
        </div>
        ${yt.is_dead ? `<div style="font-size: 12px; color: #f87171; margin-top: 6px"><b>Статус:</b> ${esc(yt.dead_reason || 'Сессия отсутствует')}</div>` : ''}
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 6px">
          Просмотры: <b>${formatNumber(yt.views)}</b> · Подписчики: <b>${formatNumber(yt.subscribers)}</b>
        </div>
        ${
          yt.last_video
            ? `<div style="font-size: 11px; margin-top: 6px"><a href="${esc(yt.last_video)}" target="_blank" rel="noopener noreferrer" style="color: #38bdf8">🎬 Крайний Short ↗</a></div>`
            : ""
        }
      </div>

      <!-- TikTok -->
      <div style="${tt.is_dead ? 'background: rgba(148, 163, 184, 0.06); border: 1px dashed rgba(148, 163, 184, 0.35);' : 'background: rgba(6, 182, 212, 0.08); border: 1px solid rgba(6, 182, 212, 0.25);'} border-radius: 8px; padding: 12px">
        <div style="display: flex; justify-content: space-between; align-items: center">
          <div style="display: flex; align-items: center; gap: 8px">
            <b style="color: ${tt.is_dead ? '#94a3b8' : '#67e8f9'}">📱 TikTok: ${esc(tt.username ? "@" + tt.username : "Аккаунт")}</b>
            ${tt.is_dead ? '<span class="badge status-dead">⚠️ ОТЛЕТЕЛ</span>' : '<span class="badge status-active">🟢 Активен</span>'}
          </div>
          ${tt.profile_url ? `<a href="${esc(tt.profile_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary small">${tt.is_dead ? 'Проверить профиль ↗' : 'Профиль ↗'}</a>` : '<span class="badge" style="background: rgba(255,255,255,0.05); color: var(--text-dim)">Не привязан</span>'}
        </div>
        ${tt.is_dead ? `<div style="font-size: 12px; color: #f87171; margin-top: 6px"><b>Статус:</b> ${esc(tt.dead_reason || 'Сессия отсутствует')}</div>` : ''}
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 6px">
          Просмотры: <b>${formatNumber(tt.views)}</b> · Фолловеры: <b>${formatNumber(tt.followers)}</b>
        </div>
        ${
          tt.last_video
            ? `<div style="font-size: 11px; margin-top: 6px"><a href="${esc(tt.last_video)}" target="_blank" rel="noopener noreferrer" style="color: #67e8f9">🎬 Крайнее видео ↗</a></div>`
            : ""
        }
      </div>

      <!-- Instagram -->
      <div style="${ig.is_dead ? 'background: rgba(148, 163, 184, 0.06); border: 1px dashed rgba(148, 163, 184, 0.35);' : 'background: rgba(236, 72, 153, 0.08); border: 1px solid rgba(236, 72, 153, 0.25);'} border-radius: 8px; padding: 12px">
        <div style="display: flex; justify-content: space-between; align-items: center">
          <div style="display: flex; align-items: center; gap: 8px">
            <b style="color: ${ig.is_dead ? '#94a3b8' : '#f472b6'}">📸 Instagram: ${esc(ig.username ? "@" + ig.username : "Аккаунт")}</b>
            ${ig.is_dead ? '<span class="badge status-dead">⚠️ ОТЛЕТЕЛ</span>' : '<span class="badge status-active">🟢 Активен</span>'}
          </div>
          ${(ig.reels_url || ig.profile_url) ? `<a href="${esc(ig.reels_url || ig.profile_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary small">${ig.is_dead ? 'Проверить Reels ↗' : 'Профиль ↗'}</a>` : '<span class="badge" style="background: rgba(255,255,255,0.05); color: var(--text-dim)">Не привязан</span>'}
        </div>
        ${ig.is_dead ? `<div style="font-size: 12px; color: #f87171; margin-top: 6px"><b>Статус:</b> ${esc(ig.dead_reason || 'Сессия отсутствует')}</div>` : ''}
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 6px">
          Просмотры: <b>${formatNumber(ig.views)}</b> · Фолловеры: <b>${formatNumber(ig.followers)}</b>
        </div>
        ${
          ig.reels_url
            ? `<div style="font-size: 11px; margin-top: 6px"><a href="${esc(ig.reels_url)}" target="_blank" rel="noopener noreferrer" style="color: #f472b6">🎬 Раздел Reels ↗</a></div>`
            : ""
        }
      </div>
    </div>
  `;

  modal.classList.remove("hidden");
};

// Export to CSV Report
function exportReportCSV() {
  if (!rawData || !rawData.accounts) return;

  const rows = [
    [
      "Профиль",
      "Категория",
      "Статус",
      "Суммарно просмотров",
      "YT Просмотры",
      "TT Просмотры",
      "IG Просмотры",
      "Выложено Сегодня",
      "Выложено Вчера",
      "Выложено Всего",
      "Крайняя публикация",
      "Аудитория (Подписчики)",
      "Причина стагнации",
    ],
  ];

  for (const a of rawData.accounts) {
    rows.push([
      `"${a.profile}"`,
      `"${a.category_name}"`,
      `"${a.status_label}"`,
      a.total_views,
      a.youtube?.views || 0,
      a.tiktok?.views || 0,
      a.instagram?.views || 0,
      a.published_today,
      a.published_yesterday,
      a.published_total,
      `"${a.last_published_text}"`,
      a.total_audience,
      `"${a.stagnant_reason || ""}"`,
    ]);
  }

  const csvContent = "\uFEFF" + rows.map((e) => e.join(";")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `Статистика_Денис_Рябцев_${new Date().toISOString().split("T")[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("Отчёт выгружен в формате CSV!");
}

// Setup Event Listeners
function setupEvents() {
  // Period Switcher Buttons (Global listener for top bar and categories bar)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".period-btn");
    if (!btn) return;
    const p = btn.dataset.period;
    if (p) setPeriod(p);
  });

  // Close Category Dropdown Panel
  document.getElementById("close-cat-panel-btn")?.addEventListener("click", () => {
    closeCategoryProfilesPanel();
  });

  // Refresh button - triggers genuine live views sync across origin platforms
  let refreshPollInterval = null;
  document.getElementById("refresh-btn")?.addEventListener("click", async () => {
    const refreshBtn = document.getElementById("refresh-btn");
    const syncText = document.getElementById("sync-text");

    if (refreshBtn?.classList.contains("spinning")) {
      showToast("Синхронизация уже выполняется...");
      return;
    }
    if (refreshBtn) refreshBtn.classList.add("spinning");

    if (isCloudStaticHost()) {
      await loadData(true);
      showToast("✅ Данные обновлены из облака 24/7!");
      return;
    }

    const pin = getActivePin() || "2850";
    showToast("🔄 Запуск живой синхронизации просмотров (YouTube / TikTok / Instagram)...");

    try {
      const res = await fetch(`/api/stats/refresh?pin=${encodeURIComponent(pin)}`, {
        method: "POST",
        headers: { "X-Pin-Code": pin }
      });
      const data = await res.json();
      if (data.status === "already_running") {
        showToast("⏳ Синхронизация уже идёт в фоне...");
      }

      // Start polling status
      if (refreshPollInterval) clearInterval(refreshPollInterval);
      refreshPollInterval = setInterval(async () => {
        try {
          const stRes = await fetch(`/api/stats/refresh-status?pin=${encodeURIComponent(pin)}`, {
            headers: { "X-Pin-Code": pin }
          });
          const st = await stRes.json();
          if (st.is_running) {
            if (syncText) {
              const done = st.done || 0;
              const total = st.total || 0;
              const step = st.step || "Сбор данных...";
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              syncText.textContent = `🔄 ${step} (${pct}%)`;
            }
          } else {
            clearInterval(refreshPollInterval);
            refreshPollInterval = null;
            if (refreshBtn) refreshBtn.classList.remove("spinning");
            const gained = st.total_gain || 0;
            const upd = st.updated_count || 0;
            if (gained > 0) {
              showToast(`✅ Просмотры обновлены: +${gained.toLocaleString()} просм. (${upd} роликов)`, 6000);
            } else {
              showToast("✅ Синхронизация завершена, данные актуальны!", 4000);
            }
            await loadData(false);
          }
        } catch (e) {
          clearInterval(refreshPollInterval);
          refreshPollInterval = null;
          if (refreshBtn) refreshBtn.classList.remove("spinning");
        }
      }, 1500);

    } catch (err) {
      showToast("Ошибка запуска синхронизации: " + err.message, 4000);
      if (refreshBtn) refreshBtn.classList.remove("spinning");
    }
  });

  // Export button
  document.getElementById("export-btn")?.addEventListener("click", exportReportCSV);

  // Stagnant Banner filter button
  document.getElementById("show-stagnant-filter-btn")?.addEventListener("click", () => {
    setQuickFilter("stagnant");
    document.getElementById("accounts-table-wrap")?.scrollIntoView({ behavior: "smooth" });
  });

  // Low Views Banner filter button
  document.getElementById("show-low-views-filter-btn")?.addEventListener("click", () => {
    setQuickFilter("low-views");
    document.getElementById("accounts-table-wrap")?.scrollIntoView({ behavior: "smooth" });
  });

  // Search input
  const searchInput = document.getElementById("search-input");
  const clearSearchBtn = document.getElementById("clear-search-btn");

  searchInput?.addEventListener("input", (e) => {
    currentSearch = e.target.value.trim();
    if (clearSearchBtn) clearSearchBtn.classList.toggle("hidden", !currentSearch);
    renderAccounts();
  });

  clearSearchBtn?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    currentSearch = "";
    clearSearchBtn.classList.add("hidden");
    renderAccounts();
  });

  // Quick filter pills
  const pillsBar = document.getElementById("filter-pills-bar");
  pillsBar?.addEventListener("click", (e) => {
    const pill = e.target.closest(".pill");
    if (!pill) return;
    setQuickFilter(pill.dataset.filter);
  });

  // View toggle buttons (table vs cards)
  const viewTableBtn = document.getElementById("view-table-btn");
  const viewCardsBtn = document.getElementById("view-cards-btn");
  const tableWrap = document.getElementById("accounts-table-wrap");
  const cardsWrap = document.getElementById("accounts-cards-grid");

  viewTableBtn?.addEventListener("click", () => {
    currentView = "table";
    viewTableBtn.classList.add("active");
    viewCardsBtn.classList.remove("active");
    tableWrap.classList.remove("hidden");
    cardsWrap.classList.add("hidden");
  });

  viewCardsBtn?.addEventListener("click", () => {
    currentView = "cards";
    viewCardsBtn.classList.add("active");
    viewTableBtn.classList.remove("active");
    tableWrap.classList.add("hidden");
    cardsWrap.classList.remove("hidden");
  });

  // Sortable headers
  const table = document.getElementById("accounts-table");
  table?.addEventListener("click", (e) => {
    const th = e.target.closest("th.sortable");
    if (!th) return;
    const col = th.dataset.sort;

    if (currentSort.column === col) {
      currentSort.desc = !currentSort.desc;
    } else {
      currentSort.column = col;
      currentSort.desc = true;
    }

    table.querySelectorAll("th.sortable").forEach((header) => {
      header.classList.remove("active-sort");
      const icon = header.querySelector(".sort-icon");
      if (icon) icon.textContent = "↕";
    });

    th.classList.add("active-sort");
    const icon = th.querySelector(".sort-icon");
    if (icon) icon.textContent = currentSort.desc ? "↓" : "↑";

    renderAccounts();
  });

  // Share button
  document.getElementById("share-btn")?.addEventListener("click", () => {
    openShareModal();
  });

  // Modal close
  document.getElementById("modal-close-btn")?.addEventListener("click", () => {
    document.getElementById("detail-modal").classList.add("hidden");
  });

  document.getElementById("detail-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "detail-modal") {
      document.getElementById("detail-modal").classList.add("hidden");
    }
  });

  // Auto-refresh every 60s
  setInterval(() => {
    loadData(false);
  }, 60000);
}

// ==========================================================================
// PIN Authentication & Observer Mode
// ==========================================================================

window.showPinModal = function () {
  const modal = document.getElementById("pin-modal");
  if (modal) {
    modal.classList.remove("hidden");
    const inp = document.getElementById("pin-input");
    if (inp) {
      inp.value = "";
      setTimeout(() => inp.focus(), 100);
    }
  }
};

window.hidePinModal = function () {
  const modal = document.getElementById("pin-modal");
  if (modal) modal.classList.add("hidden");
  const err = document.getElementById("pin-error");
  if (err) err.classList.add("hidden");
};

window.handlePinSubmit = async function (e) {
  if (e) e.preventDefault();
  const input = document.getElementById("pin-input");
  const err = document.getElementById("pin-error");
  const btn = document.getElementById("pin-submit-btn");
  const pin = input ? input.value.trim() : "";

  if (!pin) return;
  if (btn) btn.disabled = true;

  const acceptPin = () => {
    try { localStorage.setItem("denis_pin", pin); } catch(e) {}
    window.__PIN__ = pin;
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("pin", pin);
      window.history.replaceState({ path: u.toString() }, "", u.toString());
    } catch(e) {}
    hidePinModal();
    showToast("✅ Доступ открыт!");
    loadData(true);
  };

  try {
    if (isCloudStaticHost()) {
      if (isValidPin(pin)) {
        acceptPin();
      } else {
        if (err) {
          err.textContent = "Неверный PIN-код. Попробуйте снова.";
          err.classList.remove("hidden");
        }
        if (input) input.select();
      }
      return;
    }

    const res = await fetch("/api/auth/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });

    if (res.ok || isValidPin(pin)) {
      acceptPin();
    } else {
      if (err) {
        err.textContent = "Неверный PIN-код. Попробуйте снова.";
        err.classList.remove("hidden");
      }
      if (input) input.select();
    }
  } catch (ex) {
    if (isValidPin(pin)) {
      acceptPin();
    } else if (err) {
      err.textContent = "Неверный PIN-код.";
      err.classList.remove("hidden");
    }
  } finally {
    if (btn) btn.disabled = false;
  }
};

// ==========================================================================
// Share Modal Functions
// ==========================================================================

window.openShareModal = async function () {
  const modal = document.getElementById("share-modal");
  if (!modal) return;
  const pin = getActivePin() || "2850";
  modal.classList.remove("hidden");

  const primInp = document.getElementById("share-primary-input");
  const cfInp = document.getElementById("share-cf-input");
  const locInp = document.getElementById("share-local-input");

  const fallbackCloud = rawData?.share_url || (rawData?.public_url ? `${rawData.public_url.replace(/\/+$/, "")}/?pin=${pin}` : "");
  if (primInp && fallbackCloud) {
    primInp.value = fallbackCloud;
  }
  if (locInp) {
    locInp.value = window.location.pathname.startsWith("/denis-stats")
      ? `${window.location.protocol}//${window.location.host}/denis-stats/?pin=${pin}`
      : `http://127.0.0.1:5000/denis-stats/?pin=${pin}`;
  }

  if (isCloudStaticHost()) {
    if (primInp) primInp.value = `${window.location.origin}${window.location.pathname.replace(/\/+$/, "")}/?pin=${pin}`;
    if (cfInp) cfInp.value = "Облачный режим GitHub Pages 24/7 активен";
    return;
  }

  try {
    const res = await fetch(`/api/tunnel/info?pin=${encodeURIComponent(pin)}`, {
      headers: { "X-Pin-Code": pin }
    });
    const data = await res.json();

    if (primInp) {
      const best = data.cloud_share_url || data.share_url || fallbackCloud || data.tunnelmole_share_url || data.serveo_share_url || data.lhr_share_url;
      primInp.value = best || "Синхронизация постоянной ссылки 24/7...";
      if (best) primInp.select();
    }

    if (cfInp) {
      cfInp.value = data.tunnelmole_share_url || data.serveo_share_url || data.lhr_share_url || data.cloudflare_share_url || "Не требуется (активна постоянная ссылка 24/7 выше)";
    }
  } catch (e) {
    if (!fallbackCloud) {
      showToast("Не удалось получить инфо ссылки: " + e.message, 3500);
    }
  }
};

window.closeShareModal = function () {
  const modal = document.getElementById("share-modal");
  if (modal) modal.classList.add("hidden");
};

window.copyInputText = function (inputId) {
  const inp = document.getElementById(inputId);
  if (inp && inp.value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(inp.value).then(() => {
        showToast("📋 Ссылка скопирована в буфер обмена!");
      }).catch(() => {
        inp.select();
        document.execCommand("copy");
        showToast("📋 Ссылка скопирована!");
      });
    } else {
      inp.select();
      document.execCommand("copy");
      showToast("📋 Ссылка скопирована!");
    }
  }
};

// Observer Mode & PIN query check
function checkObserverAndAutoPin() {
  const isLocal = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
  const cpLink = document.getElementById("control-panel-link");
  if (cpLink) {
    if (window.location.pathname.startsWith("/denis-stats")) {
      cpLink.href = "/";
    } else {
      cpLink.href = `${window.location.protocol}//${window.location.hostname}:5000/`;
    }
  }

  if (!isLocal) {
    if (cpLink) cpLink.classList.add("hidden");
    const obsBadge = document.getElementById("observer-badge");
    if (obsBadge) obsBadge.classList.remove("hidden");
    const shareBtn = document.getElementById("share-btn");
    if (shareBtn) shareBtn.classList.add("hidden");
  }

  // Check URL query ?pin=... or hash #pin=...
  const pin = getActivePin();
  if (pin) {
    window.__PIN__ = pin;
    if (isCloudStaticHost()) {
      if (isValidPin(pin)) {
        hidePinModal();
      }
      return;
    }
    fetch("/api/auth/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    })
      .then((res) => {
        if (res.ok) {
          hidePinModal();
          if (!rawData) {
            loadData(true);
          }
        }
      })
      .catch(() => {});
  }
}

// Init on DOM ready
function init() {
  setupEvents();
  checkObserverAndAutoPin();
  if (window.__INITIAL_DATA__) {
    rawData = window.__INITIAL_DATA__;
    hidePinModal();
    renderDashboard();
    const syncElem = document.getElementById("sync-text");
    if (syncElem) syncElem.textContent = "Синхронизировано: " + (rawData.overview?.generated_at_text || "сейчас");
  } else {
    loadData(true);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
