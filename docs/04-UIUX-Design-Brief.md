# Webnox OS — UI/UX Design Brief

**Product:** Webnox OS · **Owner and Master:** Haseeb Gul
**Version:** 2.0 · **Date:** 11 October 2026

Everything visual, written so a developer can build it without a Figma file. This file wins on anything visual.

---

## 1. Principles

1. **Two worlds, one codebase.** A business workspace is white and quiet. The Master world is blue and gradient. They never mix.
2. **The tenant's brand, not ours.** Inside a workspace the business sees its own name and logo. "Webnox OS" shows only on the login, set-password and Billing screens.
3. **Numbers first, decoration last.** A page answers its question in its first screenful.
4. **Fully responsive, not mobile-tolerated.** Designed at 390, 768, 1024 and 1440. No page scrolls sideways at any width.
5. **Every list has an empty state. Every action has a toast or an inline error.**
6. **Motion with a purpose, and an off switch.** CSS and SVG only, transform and opacity only, and everything stops under `prefers-reduced-motion`.
7. **Real data only.** No fake stats, no placeholder avatars, no demo accounts in production.

---

## 2. Business theme (white) — `app.css`

### 2.1 Colour

| Token | Value | Use |
|---|---|---|
| `--bg` | `#FFFFFF` | Cards, drawers, modals |
| `--canvas` | `#F8FAFC` | Page background |
| `--section` | `#F1F5F9` | Section bands, table headers |
| `--ink` | `#0F172A` | Primary text |
| `--ink-2` | `#334155` | Secondary text |
| `--muted` | `#64748B` | Labels, captions, placeholders |
| `--line` | `#E2E8F0` | Borders, dividers |
| `--accent` | `#4F46E5` | Primary buttons, active nav, focus ring |
| `--accent-bg` | `#EEF2FF` | Accent chips, selected rows |
| `--success` | `#16A34A` · `--warning` | `#D97706` · `--error` `#DC2626` | Status |

### 2.2 Role colours
Sales Representative `#4F46E5` · Lead Generation `#0891B2` · Cold Caller `#EA580C` · Finance `#16A34A` · Manager `#9333EA` · Project Manager `#DB2777`.

### 2.3 Tracking colours, everywhere without exception
Active = indigo · Idle = pale indigo · Task timer = green.

### 2.4 Billing status chips

| Status | Colour | Chip |
|---|---|---|
| Trial | `--accent` | Trial · N days left |
| Active | `--success` | Active |
| Due soon | `--warning` | Due in N days |
| Due today | `--warning` | Due today |
| Overdue | `--error` | Overdue by N days |
| Suspended | `--error`, filled | Suspended |
| Internal | `--muted` | Internal — no rent |

### 2.5 Type, shape, space
Geist, fallback Inter and system. Page title 20/600 · section heading 16/600 · body 14/400 · label 12/500 · number display 24/600 tabular. Line height 1.45, never below 12px.
Spacing 4 · 8 · 12 · 16 · 24 · 32 · 48. Radius 8 for cards, inputs and buttons, 999 for chips. Borders 1px `--line`. One soft shadow for drawers and modals only. **No gradients in the business theme.**

---

## 3. Master theme (blue) — `master.css`

Loaded only when `document.body.dataset.world === 'master'`. It overrides the same custom properties, so every shared component simply changes colour.

### 3.1 Colour

| Token | Value | Use |
|---|---|---|
| `--m-navy` | `#0B1F3A` | Deepest blue, headings on light, gradient start |
| `--m-blue` | `#1E3A8A` | Gradient middle |
| `--m-accent` | `#2563EB` | Primary action, active nav |
| `--m-cyan` | `#0EA5E9` | Gradient end, highlights |
| `--m-sky` | `#E0F2FE` | Soft fills |
| `--m-canvas` | `#F5F8FF` | Page background |
| `--m-card` | `#FFFFFF` | Cards |
| `--m-line` | `#DBE6FA` | Borders |
| `--m-ink` | `#0B1F3A` | Text |
| `--m-muted` | `#5B7299` | Secondary text |

### 3.2 Gradients (define once, reuse)

```css
--grad-hero:  linear-gradient(135deg, #0B1F3A 0%, #1E3A8A 45%, #0EA5E9 100%);
--grad-card:  linear-gradient(135deg, #2563EB 0%, #0EA5E9 100%);
--grad-soft:  linear-gradient(135deg, #EFF6FF 0%, #E0F2FE 100%);
--grad-line:  linear-gradient(90deg, #2563EB 0%, #0EA5E9 100%);
```

Rules: a gradient is used on the login background, the sidebar header, the four hero stat cards and a 3px top line on the Master shell. **Never** behind body text, never on a table, never on more than four cards on one page.

### 3.3 Master shell
- Sidebar: `--m-navy` background, white text, the Webnox OS mark at the top with a small **Master** pill in `--m-cyan` at 20% on navy. Active item: `--grad-line` as a 3px left bar plus a 10% white fill.
- Top bar: white, a 3px `--grad-line` strip above it.
- Cards: white on `--m-canvas`, 1px `--m-line`, radius 12, a soft blue shadow `0 8px 24px rgba(37,99,235,.08)`.
- The **four hero stat cards** on Master Home use `--grad-card` with white text; every other card is plain white.
- While viewing a workspace, a full-width bar under the top bar reads *"Viewing <name> as Master — read only"* in `--grad-soft` with an **Exit** button. With full access on, that bar turns `--warning` and reads *"Full access on — the Admin has been notified."*

---

## 4. Login screens

### 4.1 Business login — `/login.html`

**White. Split layout.** Left 55%: the animation. Right 45%: the form, vertically centred, max width 380.

**Left panel — "Why Webnox OS", animated.**
A looping sequence of four scenes, about 5 seconds each, built from inline SVG and CSS keyframes. Each scene has a short headline and a one-line caption that cross-fade with it. Scenes:

1. **One place for your team** — avatars arrange themselves into a team list; role chips fly in and settle.
2. **Work that tracks itself** — a task card moves To do → In progress → Done while a timer ring fills.
3. **Leads become clients** — a lead card slides along a pipeline and turns into a client card with a BUID chip.
4. **Money, always clear** — bars grow into a small revenue chart and an invoice slides up with a PAID stamp.

Rules for the animation: no library, no video, no image files — inline SVG plus CSS only. Transform and opacity only. Total CSS and JS for it under 25 KB. A subtle `--grad-soft` wash behind the scenes is allowed; the page itself stays white. Dots under the scenes show progress and can be clicked. It pauses when the tab is hidden, and the whole thing freezes on the first scene under `prefers-reduced-motion`.

**Right panel — the form.**
- When the workspace is known: that business's **logo** (48px, or its initials in a circle) and **"Sign in to Webnoxos"** as the heading, with "Webnox OS" as a small line under the form.
- When it is not: the Webnox OS mark and "Sign in".
- Fields: email, password, **Sign in**. In two-step mode: email → **Continue** → the brand appears → password → **Sign in**.
- **Forgot password?** opens the sentence *"Ask your admin for a new password link. They can send it to you on WhatsApp."*
- Under the form, in 12/400 muted, the tracking notice: what is recorded (sign-in times, active and idle time, task timers) and what is not (keystrokes, screenshots, camera, other apps).
- **No sign-up link, no "create your workspace", no mention of a Master.** A small **Not your business?** link clears the remembered workspace.

**Responsive:** below 900px the left panel is replaced by a 96px header band carrying the business logo, name and one rotating caption; the form fills the width with a 20px gutter. At 390 the heading drops to 18/600 and the tracking notice to 11/400.

### 4.2 Master login — `/master-login`

**Full-screen `--grad-hero`.** Behind it, two or three large blurred blobs drift slowly (40–60s loops, `filter: blur(60px)`, opacity 0.35) and a faint dot grid sits on top at 6% white. No text about businesses, no logos, no links.

Centre: a glass card — `rgba(255,255,255,.08)`, `backdrop-filter: blur(16px)`, 1px `rgba(255,255,255,.18)`, radius 16, width 380, padding 32. Inside: the Webnox OS mark in white, the word **Master** in 12/600 letter-spaced `--m-cyan`, email, password, and a **Sign in** button filled with `--grad-card`.

No forgot-password link, no sign-up, no footer links. `<meta name="robots" content="noindex, nofollow">`.

**Responsive:** the card goes to `calc(100% - 32px)` below 480; the blobs keep moving but drop to two; under `prefers-reduced-motion` the background is a static gradient.

### 4.3 Set password
Matches the business login: same white page, same left animation if there is room, the business brand above the form when the link carries a slug. **Continue** first, then the two password fields.

---

## 5. Layout

### 5.1 Shell (both worlds)
- **Left sidebar**, collapsible: 240px open, 64px collapsed. Brand at the top, nav in the middle, "My roles" below, version at the foot.
- **Top bar**: page title left; running **timer pill**, **bell** and **avatar menu** right.
- **Avatar menu**: Edit profile · Settings (Admin) · Permissions (Admin) · Billing (Admin) · My activity · Sign out.
- **Drawers** slide from the right for record details. **Modals** centre for forms and confirms.

### 5.2 Responsive rules (apply everywhere)

| Width | Behaviour |
|---|---|
| **≥ 1440** | Full layout, sidebar open, 3–4 cards per row, drawer 480 |
| **1024–1439** | Sidebar open or collapsed by preference, 2–3 cards per row |
| **768–1023** | Sidebar collapses to icons, 2 cards per row, drawer 400, tables begin to scroll inside their wrapper |
| **< 768** | Sidebar becomes a ☰ overlay drawer, 1 card per row, drawers and modals go full screen, the timer pill shrinks to icon + time |
| **390** | 16px page gutter, stat strips 2-up then 1-up, filter chips scroll horizontally in their own strip, tap targets ≥ 44px |

Never: a horizontal scrollbar on `body`; a table wider than its wrapper without `.table-wrap`; a fixed pixel width on a container; a modal taller than the viewport without internal scroll.

---

## 6. Components

| Component | Spec |
|---|---|
| **Button** | Primary: accent fill (`--grad-card` in the Master world), white text. Secondary: white with a `--line` border. Ghost: text only. Danger: `--error` text and border, filled only inside a confirm dialog. Height 36 (44 on touch), radius 8, 14/500 |
| **Input / select** | Height 36, radius 8, `--line` border, accent focus ring. Label above in 12/500 muted, error below in 12/500 error |
| **Chip** | 24 high, radius 999, 12/500. Role chips: the role colour at 12% fill with the colour as text |
| **Card** | White, 1px border, radius 8 (12 in the Master world), padding 16 or 24 |
| **Stat strip** | Label 12/500 muted, number 24/600, change line 12/400 with an arrow, green or red |
| **Hero stat card** (Master only) | `--grad-card`, white text, radius 12, the number at 28/600 |
| **Table** | Header `--section`, 12/600. Rows 48 high, hover `--canvas`, sticky header on long tables, inline selects for stage and assignee. Always inside `.table-wrap` |
| **Drawer** | 480 desktop, 400 tablet, full screen below 768. Title, tabs, body, sticky footer of actions |
| **Modal** | 520 wide, Escape closes, focus trapped, body scrolls inside |
| **Confirm dialog** | A plain sentence of what will happen, a named action button, Cancel. Destructive ones spell out what is kept |
| **Toast** | Bottom right (bottom centre below 768), 3 seconds, one line |
| **Empty state** | Icon, one sentence, one primary action |
| **Day ribbon** | A 24-hour strip per member: active indigo, idle pale indigo, timer green, nothing grey |
| **Bar chart** | Flat bars, value on hover, axis labels 11/400 muted. No 3D, no gradient fills in the business theme |
| **Attachment box** | Drop zone plus a file list with name, size and remove. A 📎 count in lists opens the files |

---

## 7. Key screens

### 7.1 Master Home
A `--grad-hero` strip at the top carrying the greeting and the date. Under it four **hero stat cards**: workspaces live · due this week · overdue amount · collected this month. Then a white card listing workspaces needing attention (overdue, due in 3 days, trial ending), then recent platform activity. Primary button top right: **Create workspace**.

At 390 the hero strip shrinks to 96px, the stat cards stack 2-up then 1-up, and the attention list becomes rows of name + status chip + days left.

### 7.2 Master Workspaces
Filter chips with counts, search, then a table: Workspace · Type · Members · Plan · Next due · **Days left** · Status · ⋯. Days left is the column the eye should land on: bold, red once negative. Below 768 each row becomes a card: name and status chip on the first line, plan and days left on the second, the menu on the right.

### 7.3 Create workspace
One scrolling page, five numbered sections, with a sticky summary card on the right at ≥ 1024 and a sticky bottom bar below that. The preview line under the plan section updates live. **Create workspace** shows a spinner and cannot be double-submitted.

### 7.4 Master Finance
Tabs: Dashboard · Subscriptions · Payments · Reports.
Dashboard: expected, collected, outstanding, overdue, counts by status, renewals in the next 30 days, and collected per month for 12 months.
Subscriptions: the control-panel table from `03-AppFlow.md`.
Payments: workspace, amount, currency, date, reference, receipt.
Reports: by month and by workspace, print to PDF and CSV.

### 7.5 Workspace Billing (Admin only)
A card at the top: plan, status chip, next due with days left, amount. Then the Master's bank details with a copy button on each field, then rent invoices with Download PDF, then payment history.

When suspended this is the only page: centred, no sidebar, white, with the calm line *"Access returns as soon as your payment is recorded."* No red shouting, no lock icons.

### 7.6 Workspace dashboards
**Admin / Manager:** greeting and date, revenue block, team today with day ribbons, task stats, review queue, deadlines, recent activity. A billing banner appears only in the last three days, on the due date, or while overdue.
**Member:** running timer or next task with **Start timer**, "Your day" ribbon, task counts, tracked and active today, deadlines, recent activity.

---

## 8. Copy and tone

- **UI in English**, sentence case, plain verbs: "Add team member", not "Member Addition".
- Buttons say what happens: **Create invoice**, **Record payment**, **Suspend workspace**.
- Errors say what to do next: "This email already has an account. Use another email."
- The cross-login refusal is exactly: **"These details don't work here."** Nothing more.
- Numbers always carry their unit or currency. Dates in the workspace timezone, written `11 Oct 2026`.
- Never "Oops", never exclamation marks, never jokes in error states.
- **Owner documentation and handover steps are in Hinglish.** The product UI is not.

---

## 9. Accessibility

Contrast at least 4.5:1, including white text on the blue gradients — check the lightest stop. A visible focus ring on every interactive element, including on the gradient card. Full keyboard path through forms, modals and drawers; Escape closes. Icons that carry meaning have a label or `aria-label`. Status is never carried by colour alone — a word sits beside every chip. The login animation is decorative: `aria-hidden="true"`, with the headline text available as real text. All motion respects `prefers-reduced-motion`.

---

## 10. What not to do

- No React, no component library, no CSS framework. Hand-written CSS with the tokens above.
- No animation library, no Lottie, no video on the login pages.
- No dark mode in v2.
- No gradients inside a business workspace.
- No icon-only buttons for destructive actions.
- No fake data to fill a screen. An empty workspace must look calm and correct when empty.
- No link to `/master-login` anywhere, in any menu, footer, sitemap or error message.
- No "Webnox OS" branding inside a tenant's workspace beyond the login, set-password and Billing screens.
