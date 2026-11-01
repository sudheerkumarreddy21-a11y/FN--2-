/** Final step for both sign-up and login: verify the SMS OTP, then create the account (sign-up) and issue a session. */
const S = require("./_shared");
const { getStore } = require("./_store");

const MAX_OTP_TRIES = 5;
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

const profileOf = u => ({ userId: u.userId, name: u.name, mobile: u.mobile, maskedMobile: S.maskMobile(u.mobile), createdAt: u.createdAt });

exports.handler = S.route(async body => {
  const t = S.unseal(body.ticket);
  if (!t || !t.sid) throw S.httpError(400, "This OTP request has expired. Please start again.");
  const otp = String(body.otp || "").trim();
  if (!/^\d{4,8}$/.test(otp)) throw S.httpError(400, "Enter the numeric OTP from your SMS.");

  const store = await getStore();
  if (await store.get("used:" + t.sid)) throw S.httpError(400, "This OTP has already been used. Please start again.");

  const tries = (await store.get("otp:" + t.sid)) || 0;
  if (tries >= MAX_OTP_TRIES) throw S.httpError(429, "Too many incorrect OTP attempts. Please request a new OTP.");
  await store.set("otp:" + t.sid, tries + 1);

  if (!(await S.checkOtp(t, otp))) throw S.httpError(401, "That OTP is incorrect or has expired.");
  await store.set("used:" + t.sid, Date.now());

  let user;
  if (t.purpose === "signup") {
    const u = t.user;
    if (await store.get("u:" + u.userId)) throw S.httpError(409, "That User ID is already taken.");
    if (await store.get("m:" + u.mobile)) throw S.httpError(409, "That mobile number is already registered.");
    user = { ...u, createdAt: new Date().toISOString() };
    await store.set("u:" + user.userId, user);
    await store.set("m:" + user.mobile, user.userId);
  } else if (t.purpose === "login") {
    user = await store.get("u:" + t.userId);
    if (!user) throw S.httpError(401, "Account not found.");
  } else {
    throw S.httpError(400, "Invalid request.");
  }

  const token = S.seal({ typ: "session", uid: user.userId, exp: Date.now() + SESSION_MS });
  return S.json(200, { token, profile: profileOf(user), created: t.purpose === "signup" });
});
