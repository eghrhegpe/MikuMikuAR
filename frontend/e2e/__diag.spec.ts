import { test } from "./wails-fixture";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const snapshot = JSON.parse(readFileSync(resolve(__dirname, "schema-snapshot.json"), "utf-8"));
const KIND_SELECTOR_MAP = {
    slider: '[role="slider"]',
    colorSlider: '[role="slider"]',
    toggle: '[role="switch"], input[type="checkbox"]',
    modeSlider: '[role="listbox"]',
};

test("diag water full spec logic", { tag: ["@diag"] }, async ({ vitePage: page }) => {
    test.setTimeout(120_000);
    const nav = snapshot.find((p) => p.panelId === "env:water").nav;
    await page.evaluate((id) => document.getElementById(id)?.click(), nav.entryTestId);
    await page.waitForSelector("#sceneOverlay.visible", { timeout: 3000 });
    await page.evaluate((id) => document.querySelector(`[data-testid="${id}"]`)?.click(), nav.subLevelTestId);
    await page.waitForTimeout(250);
    await page.evaluate(() => {
        document.querySelectorAll(".collapsible-header:not(.open)").forEach((h) => h.click());
    });
    const flat = (ns) => { const r = []; for (const n of ns) { r.push(n); if (n.children) r.push(...flat(n.children)); } return r; };
    const nodes = flat(snapshot.find((p) => p.panelId === "env:water").nodes).filter((n) => n.kind !== "custom" && !(n.kind === "folder" && n.children?.length));
    const problems = [];
    for (const node of nodes) {
        const el = page.getByTestId(node.id);
        const cnt = await el.count();
        if (cnt === 0) { problems.push(`MISSING:${node.id}`); continue; }
        const vis = await el.isVisible().catch(() => false);
        if (!vis) { problems.push(`HIDDEN:${node.id}`); continue; }
        const selector = KIND_SELECTOR_MAP[node.kind];
        if (selector) {
            const control = el.locator(selector).first();
            const c = await control.count();
            if (c === 0) problems.push(`NO_CTRL(${selector}):${node.id}`);
            else {
                const cv = await control.isVisible().catch(() => false);
                if (!cv) problems.push(`CTRL_HIDDEN(${selector}):${node.id}`);
            }
        }
        if (node.kind === "slider" && node.control) {
            const s = el.locator('input[type="range"]').first();
            if (await s.count() === 0) problems.push(`NO_RANGE:${node.id}`);
        }
    }
    console.log("PROBLEMS=" + JSON.stringify(problems));
    // 额外：统计执行时间
    console.log("DONE_LOOP");
});
