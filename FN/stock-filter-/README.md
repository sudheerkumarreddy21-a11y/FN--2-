# Stock Filter — P/B Screener

3D stock field (Book Value × P/B) with **stock charts**, **P/B-based BUY / HOLD / SELL signals**, and a secure
**account system**: User ID + password + SMS OTP, with a profile per user.

## Run locally (Windows)
1. Install Node.js (https://nodejs.org).
2. Double-click **RUN_PROJECT.bat**. First run creates `.env` — fill it in, save, run again.
   - `SESSION_SECRET`: any long random text.
   - `TWOFACTOR_API_KEY`: from https://2factor.in (real SMS), **or** set `OTP_DEV_MODE=true` to test without SMS —
     the OTP is then printed in the terminal window.
3. Open http://localhost:8888 → **Create account** → enter name, mobile, User ID, password → enter the OTP.

## Deploy (Netlify)
Push the folder to Netlify, then set `SESSION_SECRET` and `TWOFACTOR_API_KEY` under
Site settings → Environment variables. Users are stored in Netlify Blobs (no database to set up).
GitHub Pages cannot run the login functions — use Netlify.

## How login works
By default users sign up / log in **directly with User ID + password** (no OTP). To require an SMS OTP as well, set `REQUIRE_OTP=true` in `.env` (plus `TWOFACTOR_API_KEY`, or `OTP_DEV_MODE=true` for testing). The table below describes OTP mode.

| Step | What happens |
|---|---|
| Create account | name + mobile + User ID + password → OTP texted to the mobile → account is created **only after** the OTP is verified |
| Log in | User ID + password → OTP texted to the mobile on the profile → session starts after OTP |
| Profile | Click your name (top right): name, User ID, mobile, member-since, Log out |

Security: passwords are scrypt-hashed with a per-user salt; OTP tickets and sessions are AES-256-GCM sealed;
5 wrong passwords lock the account for 15 minutes; 5 wrong OTPs invalidate the code; OTP resend has a 30 s cooldown (max 3);
login errors never reveal whether a User ID exists.

## Charts & P/B advice
Click any stock in the 3D field (or use **Stock analysis & chart** in the left panel, or any row in *Advice for existing stocks*).

* **P/B** = price ÷ book value per share
* **Fair P/B** = reference P/B for the stock's sector (`SECTOR_FAIR_PB` in `analysis.js` — editable assumptions)
* **Fair value** = book value × fair P/B; **upside** = fair value ÷ price − 1
* **BUY** if upside ≥ +20 %, **SELL** if ≤ −20 %, otherwise **HOLD**

The modal also shows a valuation gauge, the reasoning, a caution for asset-light sectors (where P/B is a weak yardstick) and sector peers.
Charts: line or candlestick, 1M/3M/6M/1Y, plus a P/B-over-time view with the fair-P/B line.

> **Data note:** the stocks, prices and book values are the project's sample data, and the chart history is *simulated*
> (deterministic per stock, ending at the sample price). It is not live market data. This is an educational tool,
> not investment advice.

## Files
`index.html` UI · `app.js` 3D scene & wiring · `analysis.js` P/B engine · `analysis-ui.js` analysis modal · `charts.js` SVG charts ·
`auth.js` login UI · `netlify/functions/` `register`, `login`, `verify-otp`, `resend-otp`, `session` · `tests/` · `npm test` runs 19 tests.
