/**
 * analysis-ui.js — the "Stock Analysis" modal: verdict, P/B metrics, price / P-B charts,
 * valuation gauge, reasoning and sector peers.
 * Usage: openAnalysis(stock, allStocks)
 */
import { analyzePB, generateHistory, pbSeries, windowStats, RANGES, BUY_UPSIDE, SELL_DOWNSIDE } from "./analysis.js";
import { renderChart } from "./charts.js";

const inr = v => "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const pctText = v => (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1) + "%";

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  kids.flat().forEach(c => n.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return n;
}

let modal, lastFocus, chartHandle;

function ensureModal() {
  if (modal) return modal;
  modal = h("div", { class: "modal", id: "analysisModal", hidden: "" });
  modal.addEventListener("pointerdown", e => { if (e.target === modal) closeAnalysis(); });
  document.body.appendChild(modal);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) closeAnalysis(); });
  return modal;
}

export function closeAnalysis() {
  if (!modal || modal.hidden) return;
  if (chartHandle) chartHandle.destroy();
  modal.hidden = true;
  modal.textContent = "";
  document.body.classList.remove("modal-open");
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

export function openAnalysis(stock, allStocks = []) {
  ensureModal();
  const price = Number(stock.price) || Number(stock.bookValue) * Number(stock.pbRatio);
  const s = { ...stock, price };
  const a = analyzePB(s);
  if (!a) return;

  if (modal.hidden) lastFocus = document.activeElement;
  if (chartHandle) chartHandle.destroy();
  modal.textContent = "";

  const v = a.verdict.toLowerCase();
  const closeBtn = h("button", { class: "modal__close", type: "button", "aria-label": "Close analysis", onclick: closeAnalysis }, "✕");

  /* ---- header ---- */
  const head = h("header", { class: "am-head" },
    h("div", {},
      h("p", { class: "am-sector" }, `${s.sector}${s.tier ? " · " + s.tier + " cap" : ""}${s.isCustom ? " · Your stock" : ""}`),
      h("h2", { id: "amTitle" }, s.name.trim())),
    closeBtn);

  /* ---- verdict ---- */
  const verdict = h("section", { class: `am-verdict am-verdict--${v}` },
    h("div", {},
      h("p", { class: "am-label" }, "P/B signal"),
      h("p", { class: "am-verdict__word" }, a.verdict)),
    h("div", { class: "am-verdict__text" },
      h("p", {}, a.summary),
      h("p", { class: "am-muted" }, `Confidence: ${a.confidence} · Fair-value ${a.upside >= 0 ? "upside" : "downside"} ${pctText(a.upside)}`)));

  /* ---- metrics ---- */
  const metric = (label, value, tone = "") => h("div", { class: "am-metric" }, h("span", {}, label), h("strong", { class: tone }, value));
  const metrics = h("section", { class: "am-metrics" },
    metric("Market price", inr(s.price)),
    metric("Book value / share", inr(s.bookValue)),
    metric("P/B ratio", a.pb.toFixed(2) + "×", v),
    metric(`Sector fair P/B`, a.fairPB.toFixed(1) + "×"),
    metric("Fair value", inr(a.fairValue)),
    metric(a.upside >= 0 ? "Upside" : "Downside", pctText(a.upside), v));

  /* ---- chart ---- */
  const chartBox = h("div", { class: "am-chart" });
  const chartStats = h("div", { class: "am-chart__stats" });
  const section = h("section", { class: "am-section" });
  let state = { view: "price", type: "line", range: "6M" };
  const history = s.isCustom ? null : generateHistory(s);
  const draw = () => {
    if (!history) return;
    if (chartHandle) chartHandle.destroy();
    const full = state.view === "pb" ? pbSeries(history, s.bookValue) : history;
    const win = full.slice(-RANGES[state.range]);
    const st = windowStats(win);
    const f = state.view === "pb" ? x => x.toFixed(2) + "×" : x => "₹" + x.toLocaleString("en-IN", { maximumFractionDigits: 2 });
    chartStats.textContent = "";
    chartStats.append(
      h("span", {}, `${state.range} change `, h("b", { class: st.change >= 0 ? "up" : "down" }, pctText(st.change))),
      h("span", {}, "High ", h("b", {}, f(st.high))),
      h("span", {}, "Low ", h("b", {}, f(st.low))));
    chartHandle = renderChart(chartBox, {
      candles: win,
      mode: state.view === "price" ? state.type : "line",
      ref: state.view === "pb" ? { value: a.fairPB, label: `Sector fair P/B ${a.fairPB.toFixed(1)}×` } : null,
      format: f
    });
    syncTabs();
  };
  const tabs = {};
  const seg = (group, key, label) => {
    const b = h("button", { type: "button", class: "seg", "data-g": group, "data-k": key, onclick: () => { state[group] = key; draw(); } }, label);
    (tabs[group] ||= []).push(b);
    return b;
  };
  const syncTabs = () => {
    Object.entries(tabs).forEach(([g, list]) => list.forEach(b => b.classList.toggle("on", state[g] === b.dataset.k)));
    typeGroup.hidden = state.view !== "price";
  };
  const typeGroup = h("div", { class: "seg-group" }, seg("type", "line", "Line"), seg("type", "candle", "Candles"));
  if (history) {
    section.append(
      h("div", { class: "am-toolbar" },
        h("div", { class: "seg-group" }, seg("view", "price", "Price"), seg("view", "pb", "P/B ratio")),
        typeGroup,
        h("div", { class: "seg-group" }, Object.keys(RANGES).map(r => seg("range", r, r)))),
      chartStats, chartBox,
      h("p", { class: "am-note" }, "Chart shows simulated illustrative history that ends at the sample price — not real market data."));
  } else {
    section.append(h("p", { class: "am-note" }, "Price history is shown for the built-in sample stocks. For your own stocks, the valuation analysis below uses the price and book value you entered."));
  }

  /* ---- gauge ---- */
  const buyMax = a.fairPB / (1 + BUY_UPSIDE);
  const sellMin = a.fairPB / (1 + SELL_DOWNSIDE);
  const scaleMax = Math.max(sellMin * 1.4, a.pb * 1.1);
  const pos = x => Math.min(100, (x / scaleMax) * 100);
  const gauge = h("section", { class: "am-section" },
    h("h3", {}, "Valuation gauge"),
    h("div", { class: "gauge" },
      h("div", { class: "gauge__zone gauge__zone--buy", style: `width:${pos(buyMax)}%` }, "BUY"),
      h("div", { class: "gauge__zone gauge__zone--hold", style: `width:${pos(sellMin) - pos(buyMax)}%` }, "HOLD"),
      h("div", { class: "gauge__zone gauge__zone--sell", style: `width:${100 - pos(sellMin)}%` }, "SELL"),
      h("div", { class: "gauge__pin", style: `left:${pos(a.pb)}%` }, h("span", {}, a.pb.toFixed(2) + "×"))),
    h("div", { class: "gauge__scale" },
      h("span", {}, "0×"),
      h("span", {}, `Buy ≤ ${buyMax.toFixed(2)}×`),
      h("span", {}, `Sell ≥ ${sellMin.toFixed(2)}×`)));

  /* ---- reasoning ---- */
  const why = h("section", { class: "am-section" },
    h("h3", {}, "Why this signal"),
    h("ul", { class: "am-list" }, a.reasons.map(r => h("li", {}, r))),
    h("p", { class: "am-caution" }, "⚠ " + a.caution));

  /* ---- peers ---- */
  const peers = allStocks.filter(p => p !== stock && p.sector === s.sector).slice(0, 6);
  const peerSection = peers.length ? h("section", { class: "am-section" },
    h("h3", {}, `Peers in ${s.sector}`),
    h("div", { class: "am-peers" }, peers.map(p => {
      const pa = analyzePB({ ...p, price: Number(p.price) || p.bookValue * p.pbRatio });
      return h("button", { type: "button", class: "peer", onclick: () => openAnalysis(p, allStocks) },
        h("span", {}, p.name.trim()),
        h("span", { class: `peer__sig advice-${pa.verdict.toLowerCase()}` }, `${pa.pb.toFixed(2)}× · ${pa.verdict}`));
    }))) : null;

  const disclaimer = h("p", { class: "am-disclaimer" },
    "Educational screening tool, not investment advice. Signals use only P/B against assumed sector norms (editable in analysis.js). Always check earnings, debt, cash flow and consult a SEBI-registered adviser before investing.");

  const card = h("div", { class: "modal__card", role: "dialog", "aria-modal": "true", "aria-labelledby": "amTitle" },
    head, verdict, metrics, section, gauge, why, peerSection, disclaimer);
  modal.append(card);
  modal.hidden = false;
  document.body.classList.add("modal-open");
  card.scrollTop = 0;
  closeBtn.focus();
  draw();
}
