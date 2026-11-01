/** Validates a session token and returns the user's profile. */
const S = require("./_shared");
const { getStore } = require("./_store");

exports.handler = S.route(async body => {
  const t = S.unseal(body.token);
  if (!t || t.typ !== "session") throw S.httpError(401, "Session expired. Please log in again.");
  const user = await (await getStore()).get("u:" + t.uid);
  if (!user) throw S.httpError(401, "Account not found.");
  return S.json(200, {
    profile: { userId: user.userId, name: user.name, mobile: user.mobile, maskedMobile: S.maskMobile(user.mobile), createdAt: user.createdAt }
  });
});
