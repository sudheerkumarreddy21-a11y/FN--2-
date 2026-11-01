/**
 * analysis.js — pure P/B valuation + advice engine and price-history generator.
 * No DOM, no THREE.js, so it is unit-tested in Node (tests/analysis.test.mjs).
 *
 * METHOD
 *   P/B            = market price ÷ book value per share
 *   Fair P/B       = reference P/B for the stock's sector (SECTOR_FAIR_PB below)
 *   Fair value     = book value × Fair P/B
 *   Upside         = Fair value ÷ price − 1
 *   Verdict        = BUY  if upside ≥ +20%  (P/B ≤ fair P/B ÷ 1.2)
 *                    SELL if upside ≤ −20%  (P/B ≥ fair P/B × 1.25)
 *                    HOLD otherwise
 *
 * SECTOR_FAIR_PB are editable ASSUMPTIONS (rough long-run norms), not market data.
 */

export const BUY_UPSIDE = 0.20;
export const SELL_DOWNSIDE = -0.20;
export const DEEP_VALUE_PB = 0.8; // below this the stock trades far under book value → "High" confidence

export const SECTOR_FAIR_PB = {
  "Financials": 2.5, "Metals": 2.0, "Energy": 2.0, "Auto": 4.0, "Cement": 3.5,
  "Pharma": 5.0, "IT": 7.0, "FMCG": 8.0, "Chemicals": 5.0, "Retail": 8.0,
  "Services": 8.0, "Consumer Durables": 6.0, "Hospitality": 4.0, "Other": 3.0
};
/** Sectors whose value sits mostly in brands/people/IP rather than assets → P/B is a weaker yardstick. */
export const ASSET_LIGHT = new Set(["IT", "FMCG", "Retail", "Services", "Pharma", "Consumer Durables"]);

export const fairPBFor = sector => SECTOR_FAIR_PB[sector] ?? SECTOR_FAIR_PB.Other;

export function pbBand(pb) {
  if (pb < 1) return "Below book value";
  if (pb < 2) return "Modest premium to book";
  if (pb < 4) return "Moderate premium to book";
  if (pb < 8) return "High premium to book";
  return "Very high premium to book";
}

/**
 * @param {{price:number, bookValue:number, sector?:string}} stock
 * @returns analysis object, or null when inputs are not positive numbers
 */
export function analyzePB(stock) {
  const price = Number(stock.price), bookValue = Number(stock.bookValue);
  if (!(price > 0) || !(bookValue > 0)) return null;

  const pb = price / bookValue;
  const sector = stock.sector || "Other";
  const fairPB = fairPBFor(sector);
  const fairValue = bookValue * fairPB;
  const upside = fairValue / price - 1;

  let verdict = "HOLD";
  if (upside >= BUY_UPSIDE) verdict = "BUY";
  else if (upside <= SELL_DOWNSIDE) verdict = "SELL";

  const magnitude = Math.abs(upside);
  const confidence = verdict === "HOLD" ? "Neutral" : (magnitude >= 0.4 || pb < DEEP_VALUE_PB ? "High" : "Moderate");

  const pct = n => `${Math.abs(n * 100).toFixed(0)}%`;
  const reasons = [];
  reasons.push(`P/B is ${pb.toFixed(2)}× — ${pbBand(pb).toLowerCase()}.`);
  reasons.push(`The ${sector} reference P/B is ${fairPB.toFixed(1)}×, so the stock trades ${pb <= fairPB ? "below" : "above"} its sector norm (${pct(pb / fairPB - 1)} ${pb <= fairPB ? "discount" : "premium"}).`);
  if (pb < 1) reasons.push("Price is below book value per share: you pay less than the accounting value of net assets.");
  reasons.push(`At the sector P/B, fair value is about ₹${fairValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}, implying ${upside >= 0 ? "upside" : "downside"} of ${pct(upside)}.`);

  const summary = {
    BUY: "Valuation looks attractive versus book value and sector norms.",
    HOLD: "Valuation is close to the sector norm — no strong signal either way.",
    SELL: "Valuation looks stretched versus book value and sector norms."
  }[verdict];

  const caution = ASSET_LIGHT.has(sector)
    ? `P/B is a weaker yardstick for ${sector} (value sits in brands, people and IP, not assets). Cross-check P/E, ROE and growth.`
    : "P/B ignores earnings quality, debt and growth. Cross-check ROE, P/E and debt levels before acting.";

  return { pb, sector, fairPB, fairValue, upside, verdict, confidence, band: pbBand(pb), summary, reasons, caution };
}

/** Quick label used by lists and the 3D hover card. */
export function signalOf(stock) {
  const a = analyzePB(stock);
  if (!a) return { label: "N/A", className: "hold", advice: "Enter a positive price and book value." };
  return { label: a.verdict, className: a.verdict.toLowerCase(), advice: a.summary, analysis: a };
}

/* =========================================================================
   Illustrative price history (deterministic per stock — NOT real market data)
   ========================================================================= */
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = rnd => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const DAILY_VOL = { Large: 0.011, Mid: 0.016, Small: 0.022 };

function lastWeekday(from) {
  const d = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/**
 * Generates `days` trading days of OHLC candles ending exactly at the stock's current price.
 * Same stock → same history every time.
 */
export function generateHistory(stock, days = 260, today = new Date()) {
  const rnd = mulberry32(hashString(stock.name));
  const vol = DAILY_VOL[stock.tier] ?? DAILY_VOL.Mid;
  const end = Number(stock.price);

  // Random walk of log-returns, then scaled so the last close equals today's price.
  const closes = [1];
  for (let i = 1; i < days; i++) closes.push(closes[i - 1] * Math.exp(gauss(rnd) * vol + 0.0002));
  const k = end / closes[days - 1];
  const scaled = closes.map(c => c * k);

  const dates = [];
  const d = lastWeekday(today);
  for (let i = 0; i < days; i++) {
    dates.push(d.toISOString().slice(0, 10));
    do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  }
  dates.reverse();

  return scaled.map((close, i) => {
    const open = i === 0 ? close * (1 + (rnd() - 0.5) * vol) : scaled[i - 1];
    const wick = () => close * vol * 0.6 * rnd();
    const high = Math.max(open, close) + wick();
    const low = Math.max(Math.min(open, close) - wick(), 0.01);
    return { date: dates[i], open, high, low, close };
  });
}

/** P/B over time = close ÷ book value (book value held constant — it changes only quarterly). */
export function pbSeries(candles, bookValue) {
  return candles.map(c => ({ date: c.date, open: c.open / bookValue, high: c.high / bookValue, low: c.low / bookValue, close: c.close / bookValue }));
}

export const RANGES = { "1M": 21, "3M": 63, "6M": 126, "1Y": 252 };

/** Summary stats for a candle window. */
export function windowStats(candles) {
  const first = candles[0].close, last = candles[candles.length - 1].close;
  return {
    change: last / first - 1,
    high: Math.max(...candles.map(c => c.high)),
    low: Math.min(...candles.map(c => c.low))
  };
}
