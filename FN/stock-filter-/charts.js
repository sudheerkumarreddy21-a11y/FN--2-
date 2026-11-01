/**
 * charts.js — dependency-free SVG chart (line/area or candlesticks) with crosshair tooltip.
 * renderChart(container, { candles, mode: 'line'|'candle', ref?: {value,label}, format })
 * Returns { destroy() }. Re-renders itself when the container is resized.
 */
const NS = "http://www.w3.org/2000/svg";
const el = (name, attrs = {}, parent) => {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};

function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => s >= raw) || raw;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

export function renderChart(container, opts) {
  const { candles, mode = "line", ref = null, format = v => v.toFixed(2) } = opts;
  container.textContent = "";
  container.style.position = "relative";

  const W = Math.max(container.clientWidth || 640, 280);
  const H = Math.max(Math.min(Math.round(W * 0.42), 360), 220);
  const m = { t: 12, r: 64, b: 26, l: 8 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;

  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Price chart" }, container);
  svg.style.display = "block";

  let lo = Math.min(...candles.map(c => (mode === "candle" ? c.low : c.close)));
  let hi = Math.max(...candles.map(c => (mode === "candle" ? c.high : c.close)));
  if (ref) { lo = Math.min(lo, ref.value); hi = Math.max(hi, ref.value); }
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad; hi += pad;

  const n = candles.length;
  const x = i => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = v => m.t + (1 - (v - lo) / (hi - lo)) * ih;

  // grid + y labels
  niceTicks(lo, hi, 5).forEach(v => {
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "ch-grid" }, svg);
    const t = el("text", { x: W - m.r + 6, y: y(v) + 3.5, class: "ch-axis" }, svg);
    t.textContent = format(v);
  });
  // x labels (≈5 dates)
  const labelEvery = Math.max(1, Math.floor(n / 5));
  for (let i = 0; i < n; i += labelEvery) {
    const t = el("text", { x: x(i), y: H - 8, class: "ch-axis", "text-anchor": i === 0 ? "start" : "middle" }, svg);
    t.textContent = new Date(candles[i].date + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  }

  const up = candles[n - 1].close >= candles[0].close;
  const trend = up ? "var(--teal)" : "var(--danger)";

  if (mode === "candle") {
    const cw = Math.max(1.5, Math.min(10, (iw / n) * 0.65));
    candles.forEach((c, i) => {
      const color = c.close >= c.open ? "var(--teal)" : "var(--danger)";
      el("line", { x1: x(i), x2: x(i), y1: y(c.high), y2: y(c.low), stroke: color, "stroke-width": 1 }, svg);
      const top = y(Math.max(c.open, c.close)), h = Math.max(1, Math.abs(y(c.open) - y(c.close)));
      el("rect", { x: x(i) - cw / 2, y: top, width: cw, height: h, fill: color }, svg);
    });
  } else {
    const pts = candles.map((c, i) => `${x(i).toFixed(1)},${y(c.close).toFixed(1)}`);
    const gid = "g" + Math.random().toString(36).slice(2, 8);
    const defs = el("defs", {}, svg);
    const grad = el("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0%", "stop-color": trend, "stop-opacity": 0.28 }, grad);
    el("stop", { offset: "100%", "stop-color": trend, "stop-opacity": 0 }, grad);
    el("polygon", { points: `${x(0)},${m.t + ih} ${pts.join(" ")} ${x(n - 1)},${m.t + ih}`, fill: `url(#${gid})` }, svg);
    el("polyline", { points: pts.join(" "), fill: "none", stroke: trend, "stroke-width": 2, "stroke-linejoin": "round" }, svg);
  }

  if (ref) {
    el("line", { x1: m.l, x2: W - m.r, y1: y(ref.value), y2: y(ref.value), class: "ch-ref" }, svg);
    const t = el("text", { x: m.l + 6, y: y(ref.value) - 5, class: "ch-ref-label" }, svg);
    t.textContent = ref.label;
  }

  // crosshair + tooltip
  const cross = el("line", { y1: m.t, y2: m.t + ih, class: "ch-cross", visibility: "hidden" }, svg);
  const dot = el("circle", { r: 4, fill: trend, stroke: "var(--bg-panel)", "stroke-width": 2, visibility: "hidden" }, svg);
  const tip = document.createElement("div");
  tip.className = "ch-tip";
  tip.hidden = true;
  container.appendChild(tip);

  const hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" }, svg);
  const show = ev => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.min(n - 1, Math.max(0, Math.round(((px - m.l) / iw) * (n - 1))));
    const c = candles[i];
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(c.close)); dot.setAttribute("visibility", "visible");
    const d = new Date(c.date + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    tip.innerHTML = "";
    const head = document.createElement("strong"); head.textContent = d; tip.appendChild(head);
    const rows = mode === "candle"
      ? [["O", c.open], ["H", c.high], ["L", c.low], ["C", c.close]]
      : [["Close", c.close]];
    rows.forEach(([k, v]) => { const s = document.createElement("span"); s.textContent = `${k}  ${format(v)}`; tip.appendChild(s); });
    tip.hidden = false;
    const left = (x(i) / W) * r.width;
    tip.style.left = Math.min(Math.max(left + 12, 4), r.width - tip.offsetWidth - 4) + "px";
    tip.style.top = "8px";
  };
  const hide = () => { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.hidden = true; };
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerleave", hide);

  let ro = null, lastW = W;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      if (w && Math.abs(w - lastW) > 8) { ro.disconnect(); renderChart(container, opts); }
    });
    ro.observe(container);
  }
  return { destroy() { if (ro) ro.disconnect(); } };
}
