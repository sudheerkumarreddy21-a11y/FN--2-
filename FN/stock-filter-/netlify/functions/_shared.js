/**
 * Shared helpers for all serverless functions:
 *  - JSON responses, body parsing
 *  - AES-256-GCM sealed tokens (confidential + tamper-proof) for OTP tickets and sessions
 *  - scrypt password hashing
 *  - input validation (mirrors the browser-side rules in auth.js)
 *  - OTP delivery through 2Factor (or an explicit local-only dev mode)
 */
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body)
});
const parse = event => {
  try { return JSON.parse(event.body || "{}"); } catch { return {}; }
};
const httpError = (status, message) => Object.assign(new Error(message), { status });

/* ---------- sealed tokens ---------- */
function sealKey() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw httpError(500, "Server is not configured: set SESSION_SECRET (16+ characters).");
  return crypto.createHash("sha256").update("stockfilter-seal:" + s).digest();
}
function seal(payload) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", sealKey(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(payload), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}
function unseal(token) {
  if (typeof token !== "string" || token.length < 40) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", sealKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const p = JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8"));
    return p && p.exp && Date.now() <= p.exp ? p : null;
  } catch (e) {
    if (e.status) throw e; // misconfiguration, not a bad token
    return null;
  }
}

/* ---------- passwords ---------- */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}
async function checkPassword(password, stored) {
  try {
    const [, saltB64, hashB64] = String(stored).split("$");
    const expected = Buffer.from(hashB64, "base64");
    const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}
// Burns comparable CPU when the user does not exist, so timing doesn't reveal valid IDs.
const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

/* ---------- validation ---------- */
function validUserId(v) { return /^[a-z0-9_.]{4,20}$/.test(v); }
function validName(v) { return typeof v === "string" && v.trim().length >= 2 && v.trim().length <= 50; }
function validPassword(v) {
  return typeof v === "string" && v.length >= 8 && v.length <= 128 && /[A-Za-z]/.test(v) && /\d/.test(v);
}
/** Accepts 9876543210, 919876543210, +91 98765 43210, 09876543210 → "+919876543210" (Indian mobiles). */
function normalizeMobile(v) {
  let d = String(v || "").replace(/[\s()-]/g, "").replace(/^\+/, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? "+91" + d : null;
}
const maskMobile = m => `${m.slice(0, 3)} ${"•".repeat(6)}${m.slice(-4)}`;
const cleanUserId = v => String(v || "").trim().toLowerCase();

/* ---------- OTP delivery ---------- */
const devMode = () => process.env.OTP_DEV_MODE === "true" && process.env.CONTEXT !== "production";

/** LOCAL TESTING ONLY: also return the OTP to the browser (needs OTP_DEV_MODE=true and OTP_DEV_SHOW=true; never in production). */
const devShowOtp = (ticket) => (devMode() && process.env.OTP_DEV_SHOW === "true" && ticket.devOtp) ? { devOtp: ticket.devOtp } : {};

/** Sends an OTP. Returns { sid, devOtp? }. devOtp only exists in explicit local dev mode and never leaves the server. */
async function sendOtp(mobile) {
  if (devMode()) {
    const otp = String(crypto.randomInt(100000, 1000000));
    console.log(`[DEV OTP] ${mobile} -> ${otp}   (OTP_DEV_MODE is on; no SMS was sent)`);
    return { sid: "dev-" + crypto.randomBytes(8).toString("hex"), devOtp: otp };
  }
  const key = process.env.TWOFACTOR_API_KEY;
  if (!key) throw httpError(500, "Server is not configured: set TWOFACTOR_API_KEY.");
  const res = await fetch(`https://2factor.in/API/V1/${encodeURIComponent(key)}/SMS/${mobile.slice(1)}/AUTOGEN`);
  const data = await res.json().catch(() => ({}));
  if (data.Status !== "Success") throw httpError(502, data.Details || "Could not send the OTP. Please try again shortly.");
  return { sid: data.Details };
}
async function checkOtp(ticket, otp) {
  if (String(ticket.sid).startsWith("dev-")) {
    if (!devMode() || !ticket.devOtp) return false;
    const a = Buffer.from(String(otp)), b = Buffer.from(ticket.devOtp);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const key = process.env.TWOFACTOR_API_KEY;
  if (!key) throw httpError(500, "Server is not configured: set TWOFACTOR_API_KEY.");
  const res = await fetch(`https://2factor.in/API/V1/${encodeURIComponent(key)}/SMS/VERIFY/${encodeURIComponent(ticket.sid)}/${encodeURIComponent(otp)}`);
  const data = await res.json().catch(() => ({}));
  return data.Status === "Success";
}

/** OTP verification is OFF unless REQUIRE_OTP=true. */
const requireOtp = () => process.env.REQUIRE_OTP === "true";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const issueSession = userId => seal({ typ: "session", uid: userId, exp: Date.now() + SESSION_MS });
const profileOf = u => ({ userId: u.userId, name: u.name, mobile: u.mobile, maskedMobile: maskMobile(u.mobile), createdAt: u.createdAt });

/** Wraps a handler: method check, uniform error output. */
const route = fn => async event => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  try { return await fn(parse(event), event); }
  catch (e) {
    if (!e.status) console.error(e);
    // Outside production, show the real error to make local setup problems obvious.
    const detail = process.env.CONTEXT !== "production" ? ` (${e.message})` : "";
    return json(e.status || 500, { error: e.status ? e.message : "Something went wrong. Please try again." + detail });
  }
};

module.exports = {
  json, parse, httpError, route, seal, unseal, hashPassword, checkPassword, DUMMY_HASH,
  validUserId, validName, validPassword, normalizeMobile, maskMobile, cleanUserId,
  sendOtp, checkOtp, devMode, devShowOtp, requireOtp, issueSession, profileOf
};
