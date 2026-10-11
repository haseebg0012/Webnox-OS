const scenes = [
  [
    "One place for your team",
    "People, roles and the work ahead. Together in one space.",
    `<rect x="55" y="42" width="380" height="248" rx="16" fill="white" stroke="#e2e8f0"/><text x="82" y="80" class="svg-title">Your team, connected</text>${[0, 1, 2].map((n) => `<g class="${n === 1 ? "float" : "slide"}"><rect x="76" y="${100 + n * 54}" width="337" height="44" rx="8" fill="#f8fafc"/><circle cx="102" cy="${122 + n * 54}" r="14" fill="${["#eef2ff", "#f3e8ff", "#dcfce7"][n]}"/><path d="M96 ${125 + n * 54}q6-9 12 0" stroke="#64748b" fill="none"/><circle cx="102" cy="${117 + n * 54}" r="3" fill="#64748b"/><rect x="128" y="${113 + n * 54}" width="88" height="6" rx="3" fill="#cbd5e1"/><rect x="128" y="${125 + n * 54}" width="54" height="4" rx="2" fill="#e2e8f0"/><rect x="295" y="${111 + n * 54}" width="98" height="22" rx="11" fill="#eef2ff"/><text x="344" y="${126 + n * 54}" text-anchor="middle" class="svg-small">${["Sales", "Manager", "Finance"][n]}</text></g>`).join("")}`,
  ],
  [
    "Work that tracks itself",
    "From the first step to the finishing touch.",
    `<rect x="35" y="62" width="420" height="212" rx="16" fill="white" stroke="#e2e8f0"/>${["To do", "In progress", "Done"].map((x, n) => `<text x="${58 + n * 132}" y="96" class="svg-small">${x}</text><rect x="${53 + n * 132}" y="113" width="120" height="135" rx="8" fill="#f8fafc"/>`).join("")}<g class="slide"><rect x="186" y="124" width="116" height="86" rx="9" fill="#eef2ff" stroke="#c7d2fe"/><text x="197" y="146" class="svg-small">Website launch</text><rect x="197" y="157" width="68" height="5" rx="2" fill="#c7d2fe"/><circle cx="205" cy="188" r="9" fill="#4f46e5"/><path d="m201 188 3 3 5-6" fill="none" stroke="white" stroke-width="2"/></g><g class="float"><rect x="289" y="225" width="142" height="46" rx="12" fill="white" stroke="#bbf7d0"/><circle cx="315" cy="248" r="12" fill="#f0fdf4" stroke="#15803d"/><path d="M315 241v7l4 3" stroke="#15803d" fill="none"/><text x="337" y="253" class="svg-title">00:24:18</text></g>`,
  ],
  [
    "Leads become clients",
    "A clear path from first hello to your next project.",
    `<path d="M65 164h360" stroke="#e2e8f0" stroke-width="4"/>${[85, 245, 405].map((x, n) => `<circle cx="${x}" cy="164" r="14" fill="${n === 2 ? "#dcfce7" : "#eef2ff"}" stroke="${n === 2 ? "#15803d" : "#4f46e5"}"/><text x="${x}" y="205" text-anchor="middle" class="svg-small">${["New lead", "Conversation", "Client"][n]}</text>`).join("")}<g class="float"><rect x="52" y="55" width="168" height="80" rx="12" fill="white" stroke="#e2e8f0"/><text x="70" y="82" class="svg-title">A new possibility</text><rect x="70" y="96" width="112" height="6" rx="3" fill="#e2e8f0"/></g><g class="slide"><rect x="268" y="225" width="180" height="64" rx="12" fill="white" stroke="#bbf7d0"/><text x="286" y="250" class="svg-title">Welcome aboard</text><text x="286" y="271" class="svg-small">BUID 1001 · Client</text></g>`,
  ],
  [
    "Money, always clear",
    "Follow every invoice, payment and next step.",
    `<rect x="45" y="67" width="330" height="220" rx="16" fill="white" stroke="#e2e8f0"/><text x="68" y="100" class="svg-title">A clearer picture</text><path d="M72 244h260" stroke="#e2e8f0"/>${[60, 94, 74, 125, 150].map((h, n) => `<rect class="rise" x="${78 + n * 47}" y="${244 - h}" width="28" height="${h}" rx="4" fill="${n === 4 ? "#4f46e5" : "#c7d2fe"}"/>`).join("")}<g class="float"><rect x="284" y="42" width="154" height="157" rx="12" fill="white" stroke="#e2e8f0"/><text x="305" y="73" class="svg-title">Invoice</text><rect x="305" y="87" width="105" height="5" rx="2" fill="#e2e8f0"/><rect x="305" y="101" width="76" height="5" rx="2" fill="#e2e8f0"/><rect x="305" y="131" width="82" height="34" rx="7" fill="#dcfce7"/><text x="346" y="153" text-anchor="middle" fill="#166534" style="font-size:13px;font-weight:600">PAID</text></g>`,
  ],
];
export function mountArt(el) {
  if (!el) return;
  el.innerHTML = `<div class="art-brand"><span class="mark">W</span>Webnox OS</div><div class="art-stage" aria-hidden="true">${scenes.map((s, n) => `<div class="art-scene ${n ? "" : "current"}"><svg viewBox="0 0 490 330" xmlns="http://www.w3.org/2000/svg"><style>.svg-title{font:600 14px Geist,system-ui;fill:#334155}.svg-small{font:12px Geist,system-ui;fill:#475569}</style>${s[2]}</svg></div>`).join("")}</div><div class="art-caption"><h2></h2><p></p></div><div class="art-dots" aria-label="Explore Webnox OS">${scenes.map((s, n) => `<button type="button" aria-label="${s[0]}" aria-pressed="${!n}"></button>`).join("")}</div><p class="auth-mobile-caption"></p>`;
  let index = 0,
    timer;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const show = (n) => {
    index = n;
    el.querySelectorAll(".art-scene").forEach((x, i) =>
      x.classList.toggle("current", i === n),
    );
    el.querySelectorAll(".art-dots button").forEach((x, i) =>
      x.setAttribute("aria-pressed", String(i === n)),
    );
    el.querySelector("h2").textContent = scenes[n][0];
    el.querySelector(".art-caption p").textContent = scenes[n][1];
    el.querySelector(".auth-mobile-caption").textContent = scenes[n][0];
  };
  const start = () => {
    clearInterval(timer);
    el.classList.toggle("art-paused", document.hidden || motion.matches);
    if (motion.matches) show(0);
    else if (!document.hidden)
      timer = setInterval(() => show((index + 1) % 4), 5000);
  };
  el.querySelectorAll(".art-dots button").forEach(
    (b, n) =>
      (b.onclick = () => {
        if (!motion.matches) {
          show(n);
          start();
        }
      }),
  );
  document.addEventListener("visibilitychange", start);
  motion.addEventListener("change", start);
  show(0);
  start();
}
