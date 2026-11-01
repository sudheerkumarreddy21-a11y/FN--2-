import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const file = path.join(os.tmpdir(), `sf-test-${process.pid}.json`);
fs.rmSync(file, { force: true });
Object.assign(process.env, { SESSION_SECRET: "test-secret-0123456789abcdef", USER_STORE: "file", USER_STORE_FILE: file, OTP_DEV_MODE: "true", REQUIRE_OTP: "true" });
delete process.env.CONTEXT;

const require = createRequire(import.meta.url);
const fn = n => require(`../netlify/functions/${n}.js`).handler;
const [register, login, verify, resend, session] = ["register", "login", "verify-otp", "resend-otp", "session"].map(fn);
const call = async (h, body, method = "POST") => {
  const r = await h({ httpMethod: method, body: JSON.stringify(body) });
  return { status: r.statusCode, ...JSON.parse(r.body) };
};
// Capture the OTP that dev mode prints to the *server* console (it is never in an HTTP response).
let lastOtp = null;
const origLog = console.log;
console.log = (...a) => { const m = /\[DEV OTP\] \S+ -> (\d{6})/.exec(String(a[0])); if (m) lastOtp = m[1]; else origLog(...a); };
const clearCooldowns = () => {
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  Object.keys(d).filter(k => k.startsWith("cool:")).forEach(k => delete d[k]);
  fs.writeFileSync(file, JSON.stringify(d));
};

const user = { userId: "Vishnu46", name: "Vishnu  Reddy", mobile: "+91 98765 43210", password: "Secret123" };

test("sign-up validation", async () => {
  assert.equal((await call(register, { ...user, userId: "ab" })).status, 400);
  assert.equal((await call(register, { ...user, name: "" })).status, 400);
  assert.equal((await call(register, { ...user, mobile: "12345" })).status, 400);
  assert.equal((await call(register, { ...user, mobile: "5876543210" })).status, 400); // must start 6-9
  assert.equal((await call(register, { ...user, password: "short1" })).status, 400);
  assert.equal((await call(register, { ...user, password: "alllettersonly" })).status, 400);
  assert.equal((await call(register, user, "GET")).status, 405);
});

let ticket, token;
test("sign-up needs OTP before account exists", async () => {
  const r = await call(register, user);
  assert.equal(r.status, 200);
  assert.match(r.maskedMobile, /^\+91 •{6}3210$/);
  assert.equal(JSON.stringify(r).includes(lastOtp), false, "OTP must never be returned to the client");
  assert.equal(JSON.stringify(r).includes("Secret123"), false);
  // Not logged in yet: login must fail because account is not created
  clearCooldowns();
  assert.equal((await call(login, { userId: "vishnu46", password: "Secret123" })).status, 401);
  ticket = r.ticket;
});

test("wrong OTP rejected, tampered ticket rejected, right OTP creates account + session", async () => {
  clearCooldowns();
  const r = await call(register, user); ticket = r.ticket; const good = lastOtp;
  const wrong = good === "111111" ? "222222" : "111111";
  assert.equal((await call(verify, { ticket, otp: wrong })).status, 401);
  assert.equal((await call(verify, { ticket: ticket.slice(0, -4) + "AAAA", otp: good })).status, 400);
  const ok = await call(verify, { ticket, otp: good });
  assert.equal(ok.status, 200);
  assert.equal(ok.created, true);
  assert.deepEqual([ok.profile.userId, ok.profile.name, ok.profile.mobile], ["vishnu46", "Vishnu Reddy", "+919876543210"]);
  token = ok.token;
  // password is hashed in storage
  const raw = fs.readFileSync(file, "utf8");
  assert.ok(!raw.includes("Secret123"));
  assert.match(JSON.parse(raw)["u:vishnu46"].passwordHash, /^scrypt\$/);
  // replay of the same ticket+OTP is refused
  assert.equal((await call(verify, { ticket, otp: good })).status, 400);
});

test("duplicate user ID / mobile refused", async () => {
  clearCooldowns();
  assert.equal((await call(register, user)).status, 409);
  assert.equal((await call(register, { ...user, userId: "someone_else" })).status, 409);
});

test("session token works; garbage and wrong-type tokens do not", async () => {
  const s = await call(session, { token });
  assert.equal(s.status, 200);
  assert.equal(s.profile.userId, "vishnu46");
  assert.equal((await call(session, { token: "nope" })).status, 401);
  assert.equal((await call(session, { token: ticket })).status, 401); // an OTP ticket is not a session
});

test("login: wrong password is generic; correct password sends OTP; OTP completes login", async () => {
  clearCooldowns();
  const bad = await call(login, { userId: "vishnu46", password: "Wrong1234" });
  const ghost = await call(login, { userId: "nobody123", password: "Wrong1234" });
  assert.equal(bad.status, 401);
  assert.equal(bad.error, ghost.error, "no user enumeration");
  const r = await call(login, { userId: "VISHNU46", password: "Secret123" });
  assert.equal(r.status, 200);
  assert.equal((await call(verify, { ticket: r.ticket, otp: "000000" })).status, 401);
  const ok = await call(verify, { ticket: r.ticket, otp: lastOtp });
  assert.equal(ok.status, 200);
  assert.equal(ok.created, false);
  assert.equal(ok.profile.name, "Vishnu Reddy");
});

test("OTP attempts are capped at 5", async () => {
  clearCooldowns();
  const r = await call(login, { userId: "vishnu46", password: "Secret123" });
  const good = lastOtp, wrong = good === "123456" ? "654321" : "123456";
  for (let i = 0; i < 5; i++) assert.equal((await call(verify, { ticket: r.ticket, otp: wrong })).status, 401);
  assert.equal((await call(verify, { ticket: r.ticket, otp: good })).status, 429);
});

test("resend: cooldown enforced, then new OTP works and old one doesn't", async () => {
  clearCooldowns();
  const r = await call(login, { userId: "vishnu46", password: "Secret123" });
  const oldOtp = lastOtp;
  assert.equal((await call(resend, { ticket: r.ticket })).status, 429);
  clearCooldowns();
  const r2 = await call(resend, { ticket: r.ticket });
  assert.equal(r2.status, 200);
  const newOtp = lastOtp;
  if (newOtp !== oldOtp) assert.equal((await call(verify, { ticket: r2.ticket, otp: oldOtp })).status, 401);
  assert.equal((await call(verify, { ticket: r2.ticket, otp: newOtp })).status, 200);
});

test("5 wrong passwords lock the account, even for the right password", async () => {
  clearCooldowns();
  for (let i = 0; i < 5; i++) assert.equal((await call(login, { userId: "vishnu46", password: "Wrong1234" })).status, 401);
  const r = await call(login, { userId: "vishnu46", password: "Secret123" });
  assert.equal(r.status, 429);
  assert.match(r.error, /Try again in/);
});

test("dev OTP mode is refused in production; real mode needs TWOFACTOR_API_KEY", async () => {
  clearCooldowns();
  process.env.CONTEXT = "production";
  delete process.env.TWOFACTOR_API_KEY;
  const r = await call(register, { ...user, userId: "prod_user", mobile: "9000000001" });
  assert.equal(r.status, 500);
  assert.match(r.error, /TWOFACTOR_API_KEY/);
  delete process.env.CONTEXT;
});

test("missing SESSION_SECRET is a clear server error", async () => {
  const keep = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  clearCooldowns();
  const r = await call(session, { token: "x".repeat(60) });
  assert.equal(r.status, 500);
  assert.match(r.error, /SESSION_SECRET/);
  process.env.SESSION_SECRET = keep;
});

test.after(() => fs.rmSync(file, { force: true }));

test("OTP is shown to the client only with OTP_DEV_SHOW=true in dev mode", async () => {
  clearCooldowns();
  process.env.OTP_DEV_SHOW = "true";
  const r = await call(login, { userId: "vishnu46", password: "Secret123" }).catch(e => e);
  delete process.env.OTP_DEV_SHOW;
  // account may be locked by an earlier test; use a fresh sign-up instead
  clearCooldowns();
  process.env.OTP_DEV_SHOW = "true";
  const s = await call(register, { ...user, userId: "show_otp1", mobile: "9000000002" });
  assert.equal(s.devOtp, lastOtp);
  process.env.OTP_DEV_SHOW = "true"; process.env.CONTEXT = "production";
  clearCooldowns();
  const p = await call(register, { ...user, userId: "show_otp2", mobile: "9000000003" });
  assert.equal(p.devOtp, undefined);
  delete process.env.CONTEXT; delete process.env.OTP_DEV_SHOW;
});

test("direct mode (REQUIRE_OTP off): sign-up and login need no OTP", async () => {
  delete process.env.REQUIRE_OTP;
  clearCooldowns();
  const r = await call(register, { userId: "direct_user", name: "Direct User", mobile: "9111111111", password: "Passw0rdX" });
  assert.equal(r.status, 200);
  assert.ok(r.token && r.profile.userId === "direct_user" && r.created === true);
  assert.equal((await call(session, { token: r.token })).status, 200);
  assert.equal((await call(login, { userId: "direct_user", password: "bad" })).status, 401);
  const l = await call(login, { userId: "direct_user", password: "Passw0rdX" });
  assert.equal(l.status, 200);
  assert.ok(l.token && !l.ticket);
  assert.equal((await call(register, { userId: "direct_user", name: "X Y", mobile: "9222222222", password: "Passw0rdX" })).status, 409);
  process.env.REQUIRE_OTP = "true";
});
