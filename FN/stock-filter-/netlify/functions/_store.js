/**
 * Tiny key/value store used for user accounts, rate limits and OTP attempt counters.
 *  - Netlify (production): Netlify Blobs -> persistent, no database to set up.
 *  - Local dev: if Blobs isn't available, falls back automatically to a JSON file (.data/store.json).
 *  - USER_STORE=file forces the file store (tests / offline).
 *
 * Keys:  u:<userId> user record   m:<mobile> -> userId   otp:<sid> attempts   cool:<mobile> last send   used:<sid>
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

function fileStore() {
  let file = process.env.USER_STORE_FILE;
  if (!file) {
    try {
      const dir = path.join(process.cwd(), ".data");
      fs.mkdirSync(dir, { recursive: true });
      file = path.join(dir, "store.json");
    } catch { file = path.join(os.tmpdir(), "stockfilter-store.json"); }
  }
  const read = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } };
  const write = d => fs.writeFileSync(file, JSON.stringify(d));
  return {
    async get(k) { return read()[k] ?? null; },
    async set(k, v) { const d = read(); d[k] = v; write(d); },
    async del(k) { const d = read(); delete d[k]; write(d); }
  };
}

async function blobsStore() {
  const { getStore: blobs } = await import("@netlify/blobs");
  const s = blobs({ name: "stockfilter", consistency: "strong" });
  await s.get("__probe", { type: "json" }); // throws right away if Blobs isn't configured here
  return {
    async get(k) { return (await s.get(k, { type: "json" })) ?? null; },
    async set(k, v) { await s.setJSON(k, v); },
    async del(k) { await s.delete(k); }
  };
}

let cached;
async function getStore() {
  if (cached) return cached;
  if (process.env.USER_STORE === "file") return (cached = fileStore());
  try {
    return (cached = await blobsStore());
  } catch (e) {
    if (process.env.CONTEXT === "production") throw e;
    console.warn(`[store] Netlify Blobs unavailable (${e.message}). Using local file store .data/store.json instead.`);
    return (cached = fileStore());
  }
}
module.exports = { getStore };
