const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const base = process.env.TEST_URL || "http://localhost:3000";
  let checks = 0;
  try {
    for (const width of [390, 768, 1024, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      await page.route("**/api/public/form?token=fixture", (route) =>
        route.fulfill({ json: { name: "Fixture business", slug: "fixture" } }),
      );
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      for (const route of [
        "/login.html",
        "/master-login",
        "/set-password.html",
        "/lead.html?token=fixture",
        "/",
      ]) {
        errors.length = 0;
        await page.goto(base + route, { waitUntil: "networkidle" });
        await page.locator("h1").waitFor();
        const result = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          hiddenLinks: document.querySelectorAll('a[href*="master-login"]')
            .length,
        }));
        assert.equal(result.overflow, false, `${route} at ${width}`);
        assert.equal(result.hiddenLinks, 0);
        assert.deepEqual(errors, []);
        checks++;
        if ([390, 1440].includes(width) && route !== "/")
          await page.screenshot({
            path: `tmp/${route.split("?")[0].slice(1).replace(".html", "")}-${width}.png`,
            fullPage: true,
          });
      }
      await page.goto(base + "/login.html");
      await page.getByRole("button", { name: "Forgot password?" }).click();
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
      await page.locator("dialog").waitFor({ state: "detached" });
      if (width >= 1024) {
        await page.getByRole("button", { name: "Money, always clear" }).click();
        assert.equal(
          await page.locator(".art-caption h2").textContent(),
          "Money, always clear",
        );
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page
          .locator(".art-caption h2")
          .filter({ hasText: "One place for your team" })
          .waitFor();
        assert.equal(
          await page.locator(".art-caption h2").textContent(),
          "One place for your team",
        );
      }
      await page.close();
    }
    fs.writeFileSync(
      "tmp/browser-results.json",
      JSON.stringify(
        { checks, widths: [390, 768, 1024, 1440], errors: 0 },
        null,
        2,
      ),
    );
    console.log(
      `${checks} responsive route checks passed; dialogs and reduced motion passed.`,
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
