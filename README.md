# Webnox OS

Har business ka apna workspace. Platform owner: **Haseeb Gul**. Pehla business **Webnoxos** hai: ecommerce, business growth aur web development agency.

## Abhi kya ready hai

Phase **M0** ka basic Express server, safe public configuration endpoint, initial holding pages aur Vercel setup. Abhi sign-in, business modules aur database schema implement nahi hue. Full login design M1 mein aur tenancy M2 mein aayegi.

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

Local `SITE_URL` ke liye `http://localhost:3000` use karo. Vercel par actual deployment domain with `https://` use hoga. Supabase project URL aur publishable key Connect dialog se, secret key Settings → API Keys se milti hai. Secret key kabhi chat, frontend ya GitHub par paste mat karo. `.env` aur original `Files/` folder Git aur deployment uploads se excluded hain.

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

Supabase → Authentication → URL Configuration mein live URL ko Site URL aur `<live URL>/set-password.html` ko allowed redirect set karo. Email OTP expiry documentation ke mutabiq 86400 seconds hai; auth phase mein current project settings verify hongi. Public user sign-up disabled rehna chahiye. Abhi koi SQL run karne ki zaroorat nahi; tenancy schema M2 mein banega, Master setup M3 mein.

`/master-login` private-entry path hai, public navigation mein link nahi hoga. M0 mein route sirf holding page serve karta hai; actual sign-in baad ke phase mein aayega.

## Checks

```powershell
npm test
npm run check
```

M0 tests public config ki field whitelist, secret-key misconfiguration, private files ka protection, missing-config behavior aur entry routing check karte hain. Database isolation tests M2 se aayenge. Har phase ke pages 390, 768, 1024 aur 1440 par verify karne hain.

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
