/** Step 1 of sign-up: validate the profile, then text an OTP to the mobile. The account is only created after OTP verification. */
const S = require("./_shared");
const { getStore } = require("./_store");

const OTP_COOLDOWN_MS = 30 * 1000;

exports.handler = S.route(async body => {
  const userId = S.cleanUserId(body.userId);
  const name = String(body.name || "").trim().replace(/\s+/g, " ");
  const mobile = S.normalizeMobile(body.mobile);
  const password = body.password;

  if (!S.validUserId(userId)) throw S.httpError(400, "User ID must be 4–20 characters: letters, numbers, dot or underscore.");
  if (!S.validName(name)) throw S.httpError(400, "Enter your full name (2–50 characters).");
  if (!mobile) throw S.httpError(400, "Enter a valid 10-digit Indian mobile number.");
  if (!S.validPassword(password)) throw S.httpError(400, "Password must be 8+ characters and include a letter and a number.");

  const store = await getStore();
  if (await store.get("u:" + userId)) throw S.httpError(409, "That User ID is already taken.");
  if (await store.get("m:" + mobile)) throw S.httpError(409, "That mobile number is already registered. Please log in.");

  const passwordHash = await S.hashPassword(password);

  // Direct sign-up (default): create the account and sign the user in immediately.
  if (!S.requireOtp()) {
    const user = { userId, name, mobile, passwordHash, createdAt: new Date().toISOString() };
    await store.set("u:" + userId, user);
    await store.set("m:" + mobile, userId);
    return S.json(200, { token: S.issueSession(userId), profile: S.profileOf(user), created: true });
  }

  const last = await store.get("cool:" + mobile);
  if (last && Date.now() - last < OTP_COOLDOWN_MS) throw S.httpError(429, "Please wait a few seconds before requesting another OTP.");
  const { sid, devOtp } = await S.sendOtp(mobile);
  await store.set("cool:" + mobile, Date.now());

  const ticket = S.seal({
    purpose: "signup", sid, devOtp, mobile, resends: 0,
    user: { userId, name, mobile, passwordHash },
    exp: Date.now() + 10 * 60 * 1000
  });
  return S.json(200, { ticket, maskedMobile: S.maskMobile(mobile), ...S.devShowOtp({ devOtp }) });
});
