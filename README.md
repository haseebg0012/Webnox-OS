# Webnox OS

Har business ka apna workspace. Platform owner: **Haseeb Gul**. Pehla business **Webnoxos** hai: ecommerce, business growth aur web development agency.

## Abhi kya ready hai

Workspace creation, branded sign-in, Team aur permissions ke saath tasks/review, timers, work reports, CRM leads, clients, projects, private files, notifications, finance, invoices aur Master rent/billing lifecycle implement hain. Updated Supabase schema aur Vercel release live hain. Production source/config/branding checks, public pages aur real Master dashboard/finance verified hain. Owner password setup complete hai.

Pehla workspace **Webnoxos** normal internal workspace hai, rent nahi lagta. Master: Haseeb Gul; Admin: Webnox Hub; Manager: Haseeb. Country Pakistan hai. Production mein demo accounts ya dummy business records nahi hain.

Recipients apna password khud choose karenge. Private local files `Files/Owner-Setup.html` aur `Files/Webnoxos-Team-Setup.html` mein setup links hain; in files ko GitHub par upload ya publicly share mat karo. Link expire ho to Admin member ka link regenerate kar sakta hai; owner recovery ke liye private setup workflow use karo.

Actual bank details, business address/logo aur original A4 reference abhi supplied nahi hain. Settings mein asli details add karo; koi fabricated bank information nahi dali gayi. Invoice print written specification ke mutabiq A4 hai; exact reference matching verify nahi ho sakti jab tak original template na mile.

## Roz ka workflow

1. Admin → Team se member banao, active roles assign karo aur private setup link relevant recipient ko do.
2. Leads mein lead add/import karo ya Public form link copy karo. Won lead ko client mein convert karke project banao.
3. Project mein designation ke mutabiq people add karo; approval history preserve hoti hai. Tasks assign karo, timer chalao, review submit aur approve karo.
4. Finance mein currency pehle select karo, phir amount. Daily reference FX rate edit ho sakta hai; totals database calculate karta hai. Salary details sirf Admin/Manager dekhte hain.
5. Invoice create karke Print / save PDF use karo. Actual payment receive hone par Mark paid karo. Expenses/bills par receipts attach ho sakti hain.
6. Master rented workspace ka plan/payment manage karta hai. Suspension mein Admin ko sirf Billing milta hai; history delete nahi hoti. Internal workspaces rent lifecycle se excluded hain.

Reminder/suspension sweeps page load ke baad chalte hain aur missed dates catch up karte hain; background scheduler ya email/WhatsApp sending is release ka hissa nahi. Live rate unavailable ho to manual rate enter karo. Invoices PDF browser print dialog se save hoti hain.

## Local setup

Node.js 24 install hona chahiye. Project root mein:

```powershell
npm ci
Copy-Item .env.example .env
```

Agar `.env` pehle se hai to use overwrite mat karo. `.env` mein apne values bharo:

```dotenv
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
SITE_URL=
```

`SITE_URL=https://webnoxos.vercel.app` rakho; generated password links production par khulenge. Supabase project URL aur publishable key Connect dialog se, secret key Settings → API Keys se milti hai. Secret key kabhi chat, frontend ya GitHub par paste mat karo. `.env` aur original `Files/` folder Git aur deployment uploads se excluded hain.

```powershell
npm run dev
```

Browser mein `http://localhost:3000` kholo. `/api/config` 200 aane par public config ready hai; iska response secret key nahi deta. Missing ya invalid public config par 503 milta hai. Ye endpoint database connection ya sign-in ke kaam karne ka proof nahi hai.

## Vercel setup

1. Apni team mein project `webnoxos` ko GitHub repo `haseebg0012/Webnox-OS` se link karo; production branch `main`.
2. Framework **Express**, Node **24.x**, root repository root. Build/output overrides empty/default rakho; frontend build step nahi hai.
3. Project → Settings → Environment Variables mein upar ke four variables add karo. Filled `.env` ko source code ke saath upload mat karo. Production aur Preview settings sahi scope mein rakho; real customer database ko test previews mein reuse mat karo.
4. `SITE_URL` = Vercel ka actual app URL. Ismein guessed domain nahi lagana.
5. Naya Git commit push karne se naya deployment aayega. `/`, `/api/config` aur hidden platform entry verify karo.

Supabase → Authentication → URL Configuration mein live URL Site URL aur `<live URL>/set-password.html` allowed redirect configured hain. Public sign-up disabled hai. Owner approval ke baad email OTP expiry 86400 seconds save aur fresh page par verify ho chuki hai.

Naye project ke liye Supabase → SQL Editor mein poora `supabase/schema.sql` paste karke Run karo; dobara chalana safe hai. Current project mein schema installed hai. Owner account provision karne ke liye `node --env-file=.env scripts/bootstrap-owner.mjs --create` run karo. Private password link ignored `Files/Owner-Setup.html` mein save hoga; email send nahi hoti. Owner apna password khud set karega.

`/master-login` private-entry path hai; public navigation mein iska link nahi hai. Business users `/login.html` use karte hain. Dono cross-login attempts neutral error ke saath refuse hote hain.

## Checks

```powershell
npm test
npm run check
```

28 database/API checks pass hain: public-config whitelist, private paths, API guards, public forms, salary isolation, invoice counters/totals, recurring bills, rent lifecycle aur cross-workspace access. PGlite schema twice run karta hai. Browser suites mein 20 public aur 200 authenticated page/tab checks 390, 768, 1024 aur 1440 par pass hain. `tests/integration-browser.mjs` actual local UI se PGlite tak poora lead → project → task/review aur invoice → payment workflow verify karta hai. Browser tests ko Playwright aur Chrome chahiye; module path `PLAYWRIGHT_MODULE` se set ho sakta hai. Fixtures sirf tests mein hain.

## Git handover

Project root mein:

```powershell
git add .
git commit -m "Update Webnox OS"
git push -u origin main
```

Commit/push pehle ho chuka ho to same command dobara karne ki zaroorat nahi. `.env` aur `Files/` ignored rehne chahiye. Owner ki latest instruction ke mutabiq phase checks ke saath implementation continue hogi; routine review ke liye pause nahi hoga.

## Specifications

`docs/00-README.md` se reading start karo. `docs/08-Owner-Decisions.md` latest corrections aur unresolved conflicts record karta hai. Original supplied files `Files/` mein unchanged hain; normalized docs ke andar product aur first-business names user ke corrections ke mutabiq hain.
