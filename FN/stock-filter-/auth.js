/**
 * auth.js — sign-up / log-in with User ID + password, then SMS OTP, then session.
 * Validation rules mirror netlify/functions/_shared.js (the server is the authority).
 */
const $ = id => document.getElementById(id);
const el = {
  screen: $("loginScreen"), stepCreds: $("stepCreds"), stepOtp: $("stepOtp"),
  tabLogin: $("tabLogin"), tabSignup: $("tabSignup"),
  credForm: $("credForm"), signupFields: $("signupFields"),
  name: $("authName"), mobile: $("authMobile"), userId: $("authUserId"), password: $("authPassword"),
  userIdHint: $("userIdHint"), pwHint: $("pwHint"), pwMeter: $("pwMeter"), togglePw: $("togglePw"),
  credSubmit: $("credSubmit"), otpForm: $("otpForm"), otpCode: $("otpCode"), otpSubmit: $("otpSubmit"),
  otpTarget: $("otpTarget"), resend: $("resendBtn"), back: $("backBtn"), error: $("loginError"),
  userMenu: $("userMenu"), userChip: $("userChip"), profilePop: $("profilePop"), logout: $("logoutButton")
};

const TOKEN_KEY = "stockfilter_session";
const RESEND_SECONDS = 30;
let mode = "login";
let ticket = null;
let resendTimer = null;

const store = {
  get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(TOKEN_KEY, v); } catch { /* storage blocked: session lasts until reload */ } },
  clear() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }
};

/* ---------- validation (mirrors the server) ---------- */
const rules = {
  userId: v => /^[a-z0-9_.]{4,20}$/.test(v) || "User ID must be 4–20 characters: letters, numbers, dot or underscore.",
  name: v => (v.trim().length >= 2 && v.trim().length <= 50) || "Enter your full name (2–50 characters).",
  mobile: v => /^[6-9]\d{9}$/.test(cleanMobile(v)) || "Enter a valid 10-digit Indian mobile number.",
  password: v => (v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v)) || "Password must be 8+ characters and include a letter and a number."
};
function cleanMobile(v) {
  let d = v.replace(/[\s()-]/g, "").replace(/^\+/, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}
function passwordScore(p) {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return /[A-Za-z]/.test(p) && /\d/.test(p) ? Math.max(s, 1) : Math.min(s, 1);
}

/* ---------- helpers ---------- */
function message(text, ok = false) {
  el.error.textContent = text;
  el.error.style.color = ok ? "#43e0c4" : "#e0625f";
}
function markInvalid(input, bad) { input.setAttribute("aria-invalid", bad ? "true" : "false"); }
async function api(name, body) {
  let res;
  try {
    res = await fetch(`/.netlify/functions/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Can't reach the server. Check your internet connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404 && !data.error) throw new Error("Server functions not found. Start the app with RUN_PROJECT.bat (Netlify dev) or deploy to Netlify — a plain static server can't send OTPs.");
    throw new Error(data.error || "Request failed. Please try again.");
  }
  return data;
}
function busy(button, on, idle) {
  button.disabled = on;
  button.textContent = on ? "Please wait…" : idle;
}

/* ---------- mode switch ---------- */
function setMode(next) {
  mode = next;
  const signup = mode === "signup";
  el.tabLogin.classList.toggle("on", !signup); el.tabLogin.setAttribute("aria-selected", String(!signup));
  el.tabSignup.classList.toggle("on", signup); el.tabSignup.setAttribute("aria-selected", String(signup));
  el.signupFields.hidden = !signup;
  el.userIdHint.hidden = !signup; el.pwHint.hidden = !signup; el.pwMeter.hidden = !signup;
  el.password.autocomplete = signup ? "new-password" : "current-password";
  el.password.placeholder = signup ? "Create a password" : "Your password";
  el.credSubmit.textContent = signup ? "Create account →" : "Log in →";
  [el.name, el.mobile, el.userId, el.password].forEach(i => markInvalid(i, false));
  message("");
}
el.tabLogin.addEventListener("click", () => setMode("login"));
el.tabSignup.addEventListener("click", () => setMode("signup"));

el.togglePw.addEventListener("click", () => {
  const show = el.password.type === "password";
  el.password.type = show ? "text" : "password";
  el.togglePw.textContent = show ? "Hide" : "Show";
  el.togglePw.setAttribute("aria-label", show ? "Hide password" : "Show password");
});
el.password.addEventListener("input", () => { el.pwMeter.dataset.score = passwordScore(el.password.value); });
el.userId.addEventListener("input", () => { el.userId.value = el.userId.value.toLowerCase().replace(/\s/g, ""); });
el.mobile.addEventListener("input", () => { el.mobile.value = el.mobile.value.replace(/[^\d+\s-]/g, ""); });
el.otpCode.addEventListener("input", () => { el.otpCode.value = el.otpCode.value.replace(/\D/g, ""); });

/* ---------- steps ---------- */
function showCreds() {
  clearInterval(resendTimer);
  ticket = null;
  el.stepOtp.hidden = true;
  el.stepCreds.hidden = false;
  el.otpCode.value = "";
  message("");
  (mode === "signup" ? el.name : el.userId).focus();
}
function showDevOtp(code) {
  const box = $("devOtpBox");
  box.hidden = !code;
  if (code) $("devOtpValue").textContent = code;
}
function showOtp(maskedMobile, devOtp) {
  showDevOtp(devOtp);
  el.stepCreds.hidden = true;
  el.stepOtp.hidden = false;
  el.otpTarget.textContent = maskedMobile;
  el.otpCode.value = "";
  el.otpCode.focus();
  startResendCountdown();
}
function startResendCountdown() {
  clearInterval(resendTimer);
  let left = RESEND_SECONDS;
  const tick = () => {
    el.resend.disabled = left > 0;
    el.resend.textContent = left > 0 ? `Resend code in ${left}s` : "Resend code";
    if (left-- <= 0) clearInterval(resendTimer);
  };
  tick();
  resendTimer = setInterval(tick, 1000);
}

el.credForm.addEventListener("submit", async event => {
  event.preventDefault();
  message("");
  const userId = el.userId.value.trim().toLowerCase();
  const password = el.password.value;
  const checks = mode === "signup"
    ? [[el.name, rules.name(el.name.value)], [el.mobile, rules.mobile(el.mobile.value)], [el.userId, rules.userId(userId)], [el.password, rules.password(password)]]
    : [[el.userId, userId ? true : "Enter your User ID."], [el.password, password ? true : "Enter your password."]];
  let firstError = null;
  checks.forEach(([input, r]) => { markInvalid(input, r !== true); if (r !== true && !firstError) { firstError = r; input.focus(); } });
  if (firstError) return message(firstError);

  const idle = el.credSubmit.textContent;
  busy(el.credSubmit, true, idle);
  try {
    const body = mode === "signup"
      ? { userId, password, name: el.name.value.trim(), mobile: cleanMobile(el.mobile.value) }
      : { userId, password };
    const data = await api(mode === "signup" ? "register" : "login", body);
    if (data.token) {                       // direct sign-in (OTP switched off)
      store.set(data.token);
      el.password.value = "";
      message(data.created ? "Account created. Welcome!" : "Welcome back!", true);
      setTimeout(() => showApp(data.profile), 250);
      return;
    }
    ticket = data.ticket;
    showOtp(data.maskedMobile, data.devOtp);
  } catch (e) {
    message(e.message);
  } finally {
    busy(el.credSubmit, false, idle);
  }
});

el.otpForm.addEventListener("submit", async event => {
  event.preventDefault();
  message("");
  const otp = el.otpCode.value.trim();
  if (!/^\d{4,8}$/.test(otp)) return message("Enter the code from your SMS.");
  const idle = "Verify & continue →";
  busy(el.otpSubmit, true, idle);
  try {
    const { token, profile, created } = await api("verify-otp", { ticket, otp });
    store.set(token);
    el.password.value = "";
    message(created ? "Account created. Welcome!" : "Verified. Opening Stock Filter…", true);
    setTimeout(() => showApp(profile), 350);
  } catch (e) {
    message(e.message);
    el.otpCode.select();
  } finally {
    busy(el.otpSubmit, false, idle);
  }
});

el.resend.addEventListener("click", async () => {
  el.resend.disabled = true;
  message("");
  try {
    const data = await api("resend-otp", { ticket });
    ticket = data.ticket;
    showDevOtp(data.devOtp);
    message("A new code has been sent.", true);
    startResendCountdown();
    el.otpCode.focus();
  } catch (e) {
    message(e.message);
    startResendCountdown();
  }
});
el.back.addEventListener("click", showCreds);

/* ---------- signed-in state & profile ---------- */
const initials = name => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "U";
function showApp(profile) {
  el.screen.hidden = true;
  el.userMenu.hidden = false;
  $("userAvatar").textContent = $("popAvatar").textContent = initials(profile.name);
  $("userChipName").textContent = profile.name.split(" ")[0];
  $("popName").textContent = profile.name;
  $("popUserId").textContent = "@" + profile.userId;
  $("popMobile").textContent = profile.mobile.replace(/^(\+91)(\d{5})(\d{5})$/, "$1 $2 $3");
  $("popSince").textContent = profile.createdAt ? new Date(profile.createdAt).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "—";
  document.dispatchEvent(new CustomEvent("auth:login", { detail: profile }));
}
function showLogin() {
  el.screen.hidden = false;
  el.userMenu.hidden = true;
  closePop();
  el.credForm.reset();
  setMode("login");
  showCreds();
}
function closePop() { el.profilePop.hidden = true; el.userChip.setAttribute("aria-expanded", "false"); }
el.userChip.addEventListener("click", () => {
  el.profilePop.hidden = !el.profilePop.hidden;
  el.userChip.setAttribute("aria-expanded", String(!el.profilePop.hidden));
});
document.addEventListener("pointerdown", e => { if (!el.userMenu.contains(e.target)) closePop(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closePop(); });
el.logout.addEventListener("click", () => {
  store.clear();
  document.dispatchEvent(new CustomEvent("auth:logout"));
  showLogin();
});

/* ---------- restore session ---------- */
(async () => {
  const token = store.get();
  if (!token) return showLogin();
  try {
    const { profile } = await api("session", { token });
    showApp(profile);
  } catch (e) {
    store.clear();
    showLogin();
  }
})();
