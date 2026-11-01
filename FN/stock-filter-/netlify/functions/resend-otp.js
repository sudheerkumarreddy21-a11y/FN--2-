/** Re-sends the OTP for a pending sign-up / login (30s cooldown, max 3 resends). */
const S = require("./_shared");
const { getStore } = require("./_store");

const OTP_COOLDOWN_MS = 30 * 1000;
const MAX_RESENDS = 3;

exports.handler = S.route(async body => {
  const t = S.unseal(body.ticket);
  if (!t || !t.mobile) throw S.httpError(400, "This request has expired. Please start again.");
  if ((t.resends || 0) >= MAX_RESENDS) throw S.httpError(429, "Resend limit reached. Please start again.");

  const store = await getStore();
  const last = await store.get("cool:" + t.mobile);
  if (last && Date.now() - last < OTP_COOLDOWN_MS) {
    const wait = Math.ceil((OTP_COOLDOWN_MS - (Date.now() - last)) / 1000);
    throw S.httpError(429, `Please wait ${wait}s before requesting another OTP.`);
  }

  const { sid, devOtp } = await S.sendOtp(t.mobile);
  await store.set("cool:" + t.mobile, Date.now());
  const ticket = S.seal({ ...t, sid, devOtp, resends: (t.resends || 0) + 1, exp: Date.now() + 10 * 60 * 1000 });
  return S.json(200, { ticket, maskedMobile: S.maskMobile(t.mobile), ...S.devShowOtp({ devOtp }) });
});
