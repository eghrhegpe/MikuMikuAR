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

/** Web 入口 preview 根 URL（与 playwright.config.ts webServer url 保持一致）。 */
export const WEB_ENTRY_URL =
    process.env.WEB_URL || "http://localhost:4174/MikuMikuAR/app/";

/**
 * 导航到 Web 入口并等待 init() 完成（@web spec 共用，替代 5 个 spec 的重复副本）。
 *
 * init() 完成信号：#loading display:none（成功）或 background 有色（失败）。
 * web 入口走 browser-adapter，GetConfig 等返回默认值，init 应成功。
 *
 * [doc:adr-099] SW 首次接管会 reload 一次（补 COOP/COEP 头解锁跨源隔离），
 * reload 会销毁旧 execution context——必须在后续 page.evaluate 前等 SW 接管完成，
 * 否则报 "Execution context was destroyed, most likely because of a navigation"
 * （run 31324758315 @web smoke 7/7 失败根因）。SW 不可用（如 sw.js 404）时
 * controller 恒为 null，短超时兜底不阻塞测试。
 */
export async function gotoWebEntry(page: Page): Promise<void> {
    await page.goto(WEB_ENTRY_URL, { waitUntil: "commit", timeout: 30000 });

    // 等 SW 首次接管后的 reload 完成（controller 非 null = 新文档已由 SW 控制）
    await page
        .waitForFunction(
            () => navigator.serviceWorker?.controller != null,
            null,
            { timeout: 15000 }
        )
        .catch(() => { /* SW 未接管（本地 preview 未注册）时跳过，不影响测试 */ });

    await page.waitForSelector("#btnMainAction", { timeout: 20000 });

    // [doc:adr-183] web 入口 init 会弹 FSA「授权模型根目录」引导对话框（browser-adapter
    // 有 FSA API 时触发），全屏拦截后续所有点击——installOverlayGuards 常驻移除。

    // 等 init() 完成（同 vitePage fixture 的守卫逻辑）
    await waitForInitComplete(page);

    // 常驻守卫：任何时刻出现的全屏拦截层（#loading / app-booting / mmd-dialog）都强制放行
    await installOverlayGuards(page);
}

/**
 * 常驻 overlay 守卫（vitePage / wailsPage / gotoWebEntry 三处共用）。
 *
 * 问题根因（2026-08-10 probe 实锤）：init 失败后 app **异步**创建全屏
 * #mmd-dialog-overlay（z-index:10000, pointer-events:auto）并加 mmd-dialog-visible；
 * 旧守卫「等元素存在再挂 MutationObserver」在 dialog 尚未创建时 if(!dialog) return
 * 直接退出——之后 app 才创建 dialog，守卫没在监听 → 全屏拦截层常驻，真实点击全被吞，
 * 而 page.evaluate 合成 click 恰好绕过命中测试，掩盖了该 bug（run 实测 3 failed）。
 *
 * 修复（2026-08-10 二版）：observer **逐个挂到目标节点**（body / #loading / dialog），
 * 不用 subtree+childList 全量监听——axe-core 扫描会大量增删改 DOM，全量监听导致
 * guard 被高频触发、axe analyze 超时（probe11 实证：无守卫 axe 通过，全量守卫 axe 崩）。
 * 三节点各自只监听自己的 class/style 变化，axe 扫描期间静默。
 */
export async function installOverlayGuards(page: Page): Promise<void> {
    await page.evaluate(() => {
        // 1) body.app-booting → 移除（仅监听 body 自身 class）
        const body = document.body;
        const removeBooting = () => {
            if (body.classList.contains("app-booting")) body.classList.remove("app-booting");
        };
        removeBooting();
        new MutationObserver(removeBooting).observe(body, {
            attributes: true,
            attributeFilter: ["class"],
        });

        // 2) #loading pointer-events → 强制 none（仅监听 loading 自身 style）
        const loading = document.getElementById("loading");
        if (loading) {
            const forcePassthrough = () => {
                if (loading.style.pointerEvents !== "none") loading.style.pointerEvents = "none";
            };
            forcePassthrough();
            new MutationObserver(forcePassthrough).observe(loading, {
                attributes: true,
                attributeFilter: ["style"],
            });
        }

        // 3) #mmd-dialog-overlay → 移除 mmd-dialog-visible。
        //    若 dialog 尚未创建（init 失败异步弹窗），用一次性 childList 监听等待创建；
        //    创建后立即转成对该 dialog 的 class 监听，childList observer 即 disconnect，
        //    避免常驻全量 childList 干扰 axe 等扫描。
        const ensureDialogGuard = () => {
            const dialog = document.getElementById("mmd-dialog-overlay");
            if (!dialog) return false;
            const forceHidden = () => {
                if (dialog.classList.contains("mmd-dialog-visible")) {
                    dialog.classList.remove("mmd-dialog-visible");
                }
            };
            forceHidden();
            new MutationObserver(forceHidden).observe(dialog, {
                attributes: true,
                attributeFilter: ["class"],
            });
            return true;
        };
        if (!ensureDialogGuard()) {
            const watch = new MutationObserver(() => {
                if (ensureDialogGuard()) watch.disconnect();
            });
            watch.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
        }
    });
}

/** 等 init() 完成：#loading display:none（成功）或 background 有色（失败）。
 *  vitePage / wailsPage / gotoWebEntry 三处共用，消除守卫逻辑三副本。
 *  兜底 12s < test timeout 15s：先于 Playwright 超时生效（原 20s 兜底永不触发）。 */
export async function waitForInitComplete(page: Page): Promise<void> {
    await page.evaluate(() => {
        return new Promise<void>((resolve) => {
            const loading = document.getElementById("loading");
            if (!loading) return resolve();
            const done = () => resolve();
            if (loading.style.display === "none" || loading.style.background) {
                return done();
            }
            const obs = new MutationObserver(() => {
                if (loading.style.display === "none" || loading.style.background) {
                    obs.disconnect();
                    done();
                }
            });
            obs.observe(loading, { attributes: true, attributeFilter: ["style"] });
            setTimeout(() => {
                obs.disconnect();
                done();
            }, 12000);
        });
    });
}

/** Take a Babylon screenshot via the exposed __capture helper. */
export async function captureScreenshot(page: Page): Promise<string> {
    return await page.evaluate(async () => {
        const f = (window as any).__capture;
        if (!f) throw new Error("__capture not found on window — ensure core/dev-hooks.ts setupE2ECapture ran (DEV or VITE_E2E_MODE)");
        return await f();
    });
}

/** Click the bottom-nav "环境" button to open the environment panel.
 *  真实 locator.click（带命中测试）：pointer-events 被拦截时失败并暴露 app bug。 */
export async function openEnvPanel(page: Page): Promise<void> {
    await page.locator("#btnEnv").click({ timeout: 3000 });
    // Wait for the overlay to appear
    await page.waitForSelector("#sceneOverlay.visible", { timeout: 3000 });
}

/** Navigate into a sub-level of the environment menu by clicking its folder row. */
export async function clickEnvSubLevel(page: Page, label: string): Promise<void> {
    // Environment sub-menus (天空, 云, 地面, etc.) emit a stable data-testid
    // (= `folder:env:<slug>`) via the PopupRow rowKey contract.
    const ENV_SUB_TESTID: Record<string, string> = {
        天空: "folder:env:sky",
        云: "folder:env:cloud",
        粒子: "folder:env:particle",
        风: "folder:env:wind",
        雾: "folder:env:fog",
        阴影: "folder:env:shadow",
        水: "folder:env:water",
        地面: "folder:env:ground",
        实验: "folder:env:experimental",
        后处理: "folder:env:postprocess",
        预设: "folder:env:presets",
    };
    const testId = ENV_SUB_TESTID[label];
    if (testId) {
        await page.getByTestId(testId).click();
    } else {
        // 未知标签回退到文本（保持稳定契约前兼容）
        await page.getByText(label, { exact: true }).click();
    }
}

/** Navigate into a sub-level of the motion popup by clicking its folder row. */
export async function clickMotionSubLevel(page: Page, label: string): Promise<void> {
    const MOTION_SUB_TESTID: Record<string, string> = {
        相机: "folder:motion:camera",
        视线: "folder:motion:gaze",
        程序化: "folder:motion:procmotion",
        姿势库: "folder:motion:pose",
    };
    const testId = MOTION_SUB_TESTID[label];
    if (testId) {
        await page.getByTestId(testId).click();
    } else {
        await page.getByText(label, { exact: true }).click();
    }
}

/** Navigate into a sub-level of the settings panel by clicking its folder row. */
export async function clickSettingsSubLevel(page: Page, label: string): Promise<void> {
    const SETTINGS_SUB_TESTID: Record<string, string> = {
        外观: "folder:settings:appearance",
        库: "folder:settings:library",
        性能: "folder:settings:performance",
        渲染: "folder:settings:rendering",
        路径: "folder:settings:paths",
        音频: "folder:settings:audio",
        快捷键: "folder:settings:shortcuts",
        相机: "folder:settings:camera",
        画质: "folder:settings:frame-quality",
        特效: "folder:settings:effects",
        物理: "folder:settings:physics-hud",
    };
    const testId = SETTINGS_SUB_TESTID[label];
    if (testId) {
        await page.getByTestId(testId).click();
    } else {
        await page.getByText(label, { exact: true }).click();
    }
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
    // Only Escape if an overlay is actually visible — an extra Escape when no
    // overlay exists can confuse the app's state machine (it might toggle or
    // intercept the subsequent nav click). The fixture already Escapes on setup,
    // so this is purely a guard for leftover overlays from a prior test.
    const overlayOpen = await page.evaluate(() =>
        document.getElementById("sceneOverlay")?.classList.contains("visible") ?? false
    );
    if (overlayOpen) {
        await page.keyboard.press("Escape");
        // Small wait for close animation to settle
        await page.waitForTimeout(200);
    }
    await page.locator("#btnMainAction").click();
    await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
    await page.waitForSelector('[data-testid^="actor:model"]', { timeout: 5000 });
    await page.locator('[data-testid^="actor:model"]').first().click();
    await page.waitForFunction(() => (window as any).__scene?.meshCount > 10, { timeout: 20000 });
}

/** Open the model library popup and load a model by its visible label. */
export async function loadModelByName(page: Page, name: string): Promise<void> {
    const overlayOpen = await page.evaluate(() =>
        document.getElementById("sceneOverlay")?.classList.contains("visible") ?? false
    );
    if (overlayOpen) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
    }
    await page.locator("#btnMainAction").click();
    await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
    await page.locator('[data-testid^="actor:model"]', { hasText: name }).first().click();
    await page.waitForFunction(() => (window as any).__scene?.meshCount > 10, { timeout: 20000 });
}

/** Open the motion/animation popup (#btnMotionPopup).
 *  真实 locator.click（带命中测试）。 */
export async function openMotionPopup(page: Page): Promise<void> {
    await page.locator("#btnMotionPopup").click();
    await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
}

/** Open the library/popup overlay (#btnMainAction). */
export async function openLibraryPanel(page: Page): Promise<void> {
    await page.locator("#btnMainAction").click();
    await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
}

/** Open the scene overlay (#btnScene). */
export async function openScenePanel(page: Page): Promise<void> {
    await page.locator("#btnScene").click();
    await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
}

/** Open the settings overlay (#btnSettings). */
export async function openSettingsPanel(page: Page): Promise<void> {
    await page.locator("#btnSettings").click();
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
        await (window as any).__scene.driver.createTestMesh();
    });
    return await page.evaluate(() => (window as any).__scene.meshCount);
}

/** Clear all seed/e2e test meshes from the scene. */
export async function clearSeedModel(page: Page): Promise<void> {
    await page.evaluate(() => (window as any).__scene.driver.clearTestMeshes());
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
