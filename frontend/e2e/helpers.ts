/**
 * E2E test helpers — shared utilities for connecting to Wails WebView2
 * via Chrome DevTools Protocol.
 *
 * Prerequisites:
 *   1. 注入调试端口(见 start-e2e.ps1):
 *        $env:MMCAR_DEBUG_PORT=9222  → 由 main.go 写入 application.Options.Windows.AdditionalBrowserArgs
 *        ⚠️ Wails v3 会忽略 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS env var(已源码实锤),必须用 MMCAR_DEBUG_PORT。
 *   2. 启动: `wails3 dev`(v3 CLI,非 `wails dev` v2)
 *   3. 跑测: `npx playwright test --grep "@webgl"`
 */
import { expect, Page } from "@playwright/test";
import { chromium } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";

export const CDP_ENDPOINT = "http://127.0.0.1:9222";

/** Connect to the already-running Wails WebView2 via CDP.
 *  Uses 30s timeout to prevent hanging on Windows runner when
 *  connectOverCDP gets ECONNREFUSED (e.g. 9222 not yet open). */
export async function connectToWails(): Promise<{ page: Page; close: () => Promise<void> }> {
    const browser = await chromium.connectOverCDP(CDP_ENDPOINT, { timeout: 30000 });
    const contexts = browser.contexts();
    // The first/default context has the Wails WebView2 page(s)
    const context = contexts[0] || await browser.newContext();
    const pages = context.pages();
    const page = pages[0] || await context.newPage();
    return {
        page,
        close: async () => { await browser.close(); },
    };
}

/** Take a Babylon screenshot via the exposed __capture helper. */
export async function captureScreenshot(page: Page): Promise<string> {
    return await page.evaluate(async () => {
        const f = (window as any).__capture;
        if (!f) throw new Error("__capture not found on window — ensure main.ts exposes it");
        return await f();
    });
}

/** Click the bottom-nav "环境" button to open the environment panel. */
export async function openEnvPanel(page: Page): Promise<void> {
    await page.click("#btnEnv");
    // Wait for the overlay to appear
    await page.waitForSelector("#sceneOverlay.visible", { timeout: 3000 });
}

/** Navigate into a sub-level of the environment menu by clicking its folder row. */
export async function clickEnvSubLevel(page: Page, label: string): Promise<void> {
    // Environment sub-menus (天空, 照明, 地面, etc.) use text content in menu-item divs
    await page.getByText(label, { exact: true }).click();
}

/** Wait until the E2E scene hook is mounted (DEV only). */
export async function waitForSceneHook(page: Page): Promise<void> {
    await page.waitForFunction(() => !!(window as any).__scene, { timeout: 10000 });
}

/** Open the model library popup (#btnMainAction) and load the first available model entry.
 *  Prereq: a model library with >=1 model must be configured (resource_root scanned).
 *  NOTE: the first .slide-item may be a folder row; callers should seed a known model or
 *  use loadModelByName() for deterministic selection. */
export async function loadFirstModel(page: Page): Promise<void> {
    await page.click("#btnMainAction");
    await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
    await page.waitForSelector("#sceneOverlay .slide-item", { timeout: 5000 });
    await page.locator("#sceneOverlay .slide-item").first().click();
    await page.waitForFunction(() => (window as any).__scene?.meshCount > 10, { timeout: 20000 });
}

/** Open the model library popup and load a model by its visible label. */
export async function loadModelByName(page: Page, name: string): Promise<void> {
    await page.click("#btnMainAction");
    await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
    await page.locator("#sceneOverlay .slide-item", { hasText: name }).first().click();
    await page.waitForFunction(() => (window as any).__scene?.meshCount > 10, { timeout: 20000 });
}

/** Open the motion/animation popup (#btnMotionPopup). */
export async function openMotionPopup(page: Page): Promise<void> {
    await page.click("#btnMotionPopup");
    await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
}

/** Open the library/popup overlay (#btnMainAction). */
export async function openLibraryPanel(page: Page): Promise<void> {
    await page.click("#btnMainAction");
    await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
}

/** Open the scene overlay (#btnScene). */
export async function openScenePanel(page: Page): Promise<void> {
    await page.click("#btnScene");
    await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
}

/** Open the settings overlay (#btnSettings). */
export async function openSettingsPanel(page: Page): Promise<void> {
    await page.click("#btnSettings");
    // [doc:e2e] 设置面板使用统一的 #sceneOverlay（非独立 #settingsOverlay）
    await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
}

/** Navigate into a sub-level of any overlay by clicking its text label. */
export async function clickOverlaySubLevel(page: Page, label: string): Promise<void> {
    await page.getByText(label, { exact: true }).click();
}

// ======== CI Seed Model Helpers (ADR-060 Phase 3b) ========

/**
 * Load a programmatic Babylon mesh via the `__scene` DEV hook so @webgl E2E tests
 * can assert a real 3D scene without a PMX file on disk. Only works in DEV mode.
 * @returns the meshCount after creation
 */
export async function loadSeedModel(page: Page): Promise<number> {
    await waitForSceneHook(page);
    await page.evaluate(async () => {
        await (window as any).__scene.createTestMesh();
    });
    return await page.evaluate(() => (window as any).__scene.meshCount);
}

/** Clear all seed/e2e test meshes from the scene. */
export async function clearSeedModel(page: Page): Promise<void> {
    await page.evaluate(() => (window as any).__scene.clearTestMeshes());
}

// ======== Screenshot baseline (Phase 2, ADR-060) ========

// Anchored to the e2e dir under the frontend package root (npm run test:e2e cwd).
const BASELINE_DIR = path.resolve(process.cwd(), "e2e", "__baselines__");

/** Schema version for the fingerprint algorithm. Bump when hash format changes. */
const FINGERPRINT_VERSION = 1;

/** Hamming distance ratio (0..1) between two equal-length bit strings. */
export function hammingRatio(a: string, b: string): number {
    if (!a || !b || a.length !== b.length) return 1;
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    return diff / a.length;
}

export interface BaselineResult {
    match: boolean;
    created: boolean; // true when the baseline was auto-generated on first run
    diff: number; // hamming ratio between baseline and current fingerprint
}

/**
 * Compare a 16x16 luminance fingerprint against a stored baseline.
 * Requires BASELINE_GEN=1 env to auto-create a new baseline (prevents
 * unintended cross-platform drift when CI ubuntu generates baselines
 * that differ from Windows rendering). Delete the .json under
 * __baselines__ to regenerate after an intended visual change.
 *
 * @param name      logical name, e.g. "env-sky-solid-white"
 * @param hash      fingerprint string from window.__scene.fingerprint()
 * @param tolerance max hamming ratio still counting as a match (default 0.08)
 */
export async function compareToBaseline(
    name: string,
    hash: string,
    tolerance = 0.08
): Promise<BaselineResult> {
    const file = path.join(BASELINE_DIR, `${name}.json`);
    try {
        const raw = await fs.readFile(file, "utf-8");
        const data = JSON.parse(raw);
        // Version mismatch → regenerate baseline
        if (data.version !== FINGERPRINT_VERSION) throw new Error("version mismatch");
        const diff = hammingRatio(data.hash as string, hash);
        return { match: diff <= tolerance, created: false, diff };
    } catch {
        // Guard: baseline auto-creation requires explicit BASELINE_GEN env.
        // Without it, missing baseline is a hard error — prevents accidental
        // cross-platform drift (ubuntu rendering != Windows WebView2).
        if (!process.env.BASELINE_GEN) {
            throw new Error(
                `Baseline "${name}" not found and BASELINE_GEN not set. ` +
                `Seed baselines on the intended platform with BASELINE_GEN=1.`
            );
        }
        await fs.mkdir(BASELINE_DIR, { recursive: true });
        await fs.writeFile(
            file,
            JSON.stringify({ version: FINGERPRINT_VERSION, hash, updatedAt: new Date().toISOString() }, null, 2)
        );
        return { match: true, created: true, diff: 0 };
    }
}

/** Capture a coarse luminance fingerprint of the current frame via window.__scene. */
export async function captureFingerprint(page: Page): Promise<string> {
    return page.evaluate(async () => (window as any).__scene?.fingerprint?.() ?? "");
}
