/** Step 1 of login: check User ID + password, then text an OTP to the mobile registered on that profile. */
const S = require("./_shared");
const { getStore } = require("./_store");

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const OTP_COOLDOWN_MS = 30 * 1000;
const BAD_CREDENTIALS = "Invalid User ID or password.";

exports.handler = S.route(async body => {
  const userId = S.cleanUserId(body.userId);
  const password = typeof body.password === "string" ? body.password : "";
  if (!userId || !password) throw S.httpError(400, "Enter your User ID and password.");

  const store = await getStore();
  const user = S.validUserId(userId) ? await store.get("u:" + userId) : null;

  if (user && user.lockedUntil && Date.now() < user.lockedUntil) {
    const mins = Math.ceil((user.lockedUntil - Date.now()) / 60000);
    throw S.httpError(429, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
  }

  const ok = await S.checkPassword(password, user ? user.passwordHash : S.DUMMY_HASH);
  if (!user || !ok) {
    if (user) {
      user.fails = (user.fails || 0) + 1;
      if (user.fails >= MAX_FAILS) { user.lockedUntil = Date.now() + LOCK_MS; user.fails = 0; }
      await store.set("u:" + userId, user);
    }
    throw S.httpError(401, BAD_CREDENTIALS);
  }

  // Direct login (default): password is enough.
  if (!S.requireOtp()) {
    if (user.fails || user.lockedUntil) { user.fails = 0; delete user.lockedUntil; await store.set("u:" + userId, user); }
    return S.json(200, { token: S.issueSession(userId), profile: S.profileOf(user), created: false });
  }

  const last = await store.get("cool:" + user.mobile);
  if (last && Date.now() - last < OTP_COOLDOWN_MS) throw S.httpError(429, "Please wait a few seconds before requesting another OTP.");

  const { sid, devOtp } = await S.sendOtp(user.mobile);
  await store.set("cool:" + user.mobile, Date.now());
  if (user.fails || user.lockedUntil) { user.fails = 0; delete user.lockedUntil; await store.set("u:" + userId, user); }

  const ticket = S.seal({
    purpose: "login", sid, devOtp, mobile: user.mobile, userId, resends: 0,
    exp: Date.now() + 10 * 60 * 1000
  });
  return S.json(200, { ticket, maskedMobile: S.maskMobile(user.mobile), ...S.devShowOtp({ devOtp }) });
});
