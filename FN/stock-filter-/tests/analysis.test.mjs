import test from "node:test";
import assert from "node:assert/strict";
import { analyzePB, signalOf, generateHistory, pbSeries, windowStats, RANGES } from "../analysis.js";
import { STOCKS } from "../filters.js";

test("P/B = price / book value, fair value uses sector norm", () => {
  const a = analyzePB({ price: 150, bookValue: 100, sector: "Financials" });
  assert.equal(a.pb, 1.5);
  assert.equal(a.fairPB, 2.5);
  assert.equal(a.fairValue, 250);
  assert.ok(Math.abs(a.upside - (250 / 150 - 1)) < 1e-12);
});

test("BUY / HOLD / SELL thresholds (±20% vs fair value)", () => {
  // Financials fair P/B 2.5 → BUY ≤ 2.083, SELL ≥ 3.125
  const v = pb => analyzePB({ price: pb * 100, bookValue: 100, sector: "Financials" }).verdict;
  assert.equal(v(0.5), "BUY");
  assert.equal(v(2.0), "BUY");
  assert.equal(v(2.5), "HOLD");
  assert.equal(v(3.0), "HOLD");
  assert.equal(v(3.2), "SELL");
  assert.equal(v(9), "SELL");
});

test("same P/B can mean different things in different sectors", () => {
  const f = s => analyzePB({ price: 400, bookValue: 100, sector: s }).verdict; // P/B 4
  assert.equal(f("Metals"), "SELL");
  assert.equal(f("IT"), "BUY");
});

test("invalid input returns null / N/A", () => {
  assert.equal(analyzePB({ price: 0, bookValue: 10 }), null);
  assert.equal(analyzePB({ price: 10, bookValue: -1 }), null);
  assert.equal(signalOf({ price: "x", bookValue: 1 }).label, "N/A");
});

test("unknown sector falls back to 'Other'", () => {
  assert.equal(analyzePB({ price: 300, bookValue: 100, sector: "Weird" }).fairPB, 3);
});

test("every built-in stock gets a verdict and there is a mix", () => {
  const verdicts = STOCKS.map(s => analyzePB({ ...s, price: s.bookValue * s.pbRatio }).verdict);
  assert.ok(verdicts.every(v => ["BUY", "HOLD", "SELL"].includes(v)));
  assert.ok(new Set(verdicts).size === 3, "dataset should produce all three signals: " + [...new Set(verdicts)]);
});

test("history is deterministic, ends at the current price, has valid candles", () => {
  const stock = { name: "Infosys", tier: "Large", price: 2613, bookValue: 335 };
  const today = new Date("2026-11-01T10:00:00Z"); // a Sunday
  const h1 = generateHistory(stock, 260, today), h2 = generateHistory(stock, 260, today);
  assert.deepEqual(h1, h2);
  assert.equal(h1.length, 260);
  assert.ok(Math.abs(h1.at(-1).close - 2613) < 1e-6);
  assert.equal(h1.at(-1).date, "2026-10-30"); // Friday before Sunday
  h1.forEach((c, i) => {
    assert.ok(c.high >= Math.max(c.open, c.close) - 1e-9 && c.low <= Math.min(c.open, c.close) + 1e-9 && c.low > 0);
    if (i) assert.ok(c.date > h1[i - 1].date);
    assert.ok(![0, 6].includes(new Date(c.date + "T00:00:00Z").getUTCDay()), "weekday only");
  });
});

test("different stocks get different histories; P/B series scales by book value", () => {
  const a = generateHistory({ name: "A", tier: "Mid", price: 100 }), b = generateHistory({ name: "B", tier: "Mid", price: 100 });
  assert.notDeepEqual(a.map(c => c.close), b.map(c => c.close));
  const pb = pbSeries(a, 50);
  assert.ok(Math.abs(pb.at(-1).close - 2) < 1e-9);
  const w = windowStats(a.slice(-RANGES["1M"]));
  assert.ok(w.high >= w.low && Number.isFinite(w.change));
});
