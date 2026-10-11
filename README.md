# Webnox OS

Har business ka apna workspace. Platform owner: **Haseeb Gul**. Pehla business **Webnoxos** hai: ecommerce, business growth aur web development agency.

## Abhi kya ready hai

Express deployment, white business login, separate blue Master login, password setup, workspace isolation, workspace creation aur Team account management implement ho chuke hain. Tasks, tracking, leads, projects, finance, invoices aur complete billing lifecycle par implementation continue hai. Abhi isay complete operational release na samjhein.

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

Supabase → Authentication → URL Configuration mein live URL Site URL aur `<live URL>/set-password.html` allowed redirect configured hain. Public sign-up disabled hai. Requested email OTP expiry 86400 seconds ka verification pending hai.

Naye project ke liye Supabase → SQL Editor mein poora `supabase/schema.sql` paste karke Run karo; dobara chalana safe hai. Current project mein schema installed hai. Owner account provision karne ke liye `node --env-file=.env scripts/bootstrap-owner.mjs --create` run karo. Private password link ignored `Files/Owner-Setup.html` mein save hoga; email send nahi hoti. Owner apna password khud set karega.

`/master-login` private-entry path hai; public navigation mein iska link nahi hai. Business users `/login.html` use karte hain. Dono cross-login attempts neutral error ke saath refuse hote hain.

## Checks

```powershell
npm test
npm run check
```

Tests public-config whitelist, private paths, API guards aur brand lookup check karte hain. PGlite schema twice run karta hai aur cross-workspace isolation, role deactivation, last Admin/Manager protection aur atomic provisioning verify karta hai. Headless tests `tests/browser.cjs` aur `tests/authenticated-browser.cjs` mein hain; local Playwright module aur Chrome chahiye. Authenticated fixtures sirf tests ke andar hain. Pages 390, 768, 1024 aur 1440 par checked hain.

## Git handover

Project root mein:

```powershell
git add .
git commit -m "Set up Webnox OS foundation"
git push -u origin main
```

Commit/push pehle ho chuka ho to same command dobara karne ki zaroorat nahi. `.env` aur `Files/` ignored rehne chahiye. Owner ki latest instruction ke mutabiq phase checks ke saath implementation continue hogi; routine review ke liye pause nahi hoga.

## Specifications

`docs/00-README.md` se reading start karo. `docs/08-Owner-Decisions.md` latest corrections aur unresolved conflicts record karta hai. Original supplied files `Files/` mein unchanged hain; normalized docs ke andar product aur first-business names user ke corrections ke mutabiq hain.
