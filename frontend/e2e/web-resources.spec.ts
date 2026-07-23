/**
 * [doc:adr-177] Phase 4 — Web 入口资源加载测试
 *
 * 验证 PMX/ZIP/VMD 三类资源在浏览器侧的加载闭环：
 *   fetch 字节 → IndexedDB 注入 → loadManager.load() → 渲染
 *
 * 策略：用 page.route() 拦截 /fixtures/* 请求注入本地文件字节（避免打进 bundle），
 *       然后在 page.evaluate 中模拟 drop-import.ts 的浏览器分支逻辑：
 *       读 arrayBuffer → idbSet('models','file:<name>') → loadManager.load({path})
 *
 * 运行：npx playwright test --grep "@web" web-resources
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const WEB_URL = process.env.WEB_URL || "http://localhost:4174/MikuMikuAR/";
const FIXTURES_DIR = path.resolve(__dirname, "fixtures");

/**
 * 拦截 /fixtures/* 请求，注入本地 fixture 文件字节。
 * 使 page.evaluate 中的 fetch('/fixtures/sample.pmx') 能拿到真实文件。
 */
async function setupFixtureRoute(page: Page): Promise<void> {
    await page.route("**/fixtures/**", async (route) => {
        const url = route.request().url();
        const fileName = path.basename(new URL(url).pathname);
        const filePath = path.join(FIXTURES_DIR, fileName);
        if (fs.existsSync(filePath)) {
            const body = fs.readFileSync(filePath);
            await route.fulfill({
                status: 200,
                contentType: "application/octet-stream",
                body,
            });
        } else {
            await route.continue();
        }
    });
}

/**
 * 导航到 web 入口并等待 init() 完成（复用 web-smoke 的守卫逻辑）。
 */
async function gotoWebEntry(page: Page): Promise<void> {
    await page.goto(WEB_URL, { waitUntil: "commit", timeout: 30000 });
    await page.waitForSelector("#btnMainAction", { timeout: 20000 });
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
            }, 20000);
        });
    });
    await page.evaluate(() => {
        const loading = document.getElementById("loading");
        if (!loading) return;
        const forcePassthrough = () => {
            if (loading.style.pointerEvents !== "none") {
                loading.style.pointerEvents = "none";
            }
        };
        forcePassthrough();
        new MutationObserver(forcePassthrough).observe(loading, {
            attributes: true,
            attributeFilter: ["style"],
        });
    });
}

test.describe("Web Resources — PMX/ZIP/VMD 加载 (@web)", { tag: ["@web"] }, () => {
    test.beforeEach(async ({ page }) => {
        await setupFixtureRoute(page);
        await gotoWebEntry(page);
    });

    test("PMX 加载：fetch → IndexedDB → loadManager → 模型出现", async ({ page }) => {
        // 1. fetch fixture 字节
        // 2. 写入 IndexedDB 'models' store, key 'file:sample'
        // 3. 调用 loadManager.load({ kind:'actor', path:'sample.pmx' })
        // 4. 验证 modelManager 有模型
        const result = await page.evaluate(async () => {
            // fetch PMX 字节
            const resp = await fetch("/MikuMikuAR/fixtures/sample.pmx");
            if (!resp.ok) throw new Error(`fetch pmx failed: ${resp.status}`);
            const bytes = new Uint8Array(await resp.arrayBuffer());

            // 写入 IndexedDB（复用 idb.ts 的 idbSet 逻辑）
            const dbReq = indexedDB.open("mikumikuar-web");
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                dbReq.onsuccess = () => resolve(dbReq.result);
                dbReq.onerror = () => reject(dbReq.error);
            });
            const tx = db.transaction("models", "readwrite");
            await new Promise<void>((resolve, reject) => {
                const req = tx.objectStore("models").put(bytes, "file:sample");
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });

            // 触发 loadManager（走 window.__scene 或动态 import）
            const loadManager = await import("/src/core/load-manager.ts");
            try {
                await loadManager.loadManager.load({ kind: "actor", path: "sample.pmx" });
                return { ok: true, error: null };
            } catch (e) {
                return { ok: false, error: String(e) };
            }
        });

        expect(result.error).toBeNull();
        expect(result.ok).toBe(true);

        // 验证模型已加载（modelManager 非空 或 scene 有 actor）
        const hasModel = await page.evaluate(() => {
            // window.__scene 是测试钩子（ADR-060），含 modelManager
            const scene = (window as unknown as { __scene?: { modelManager?: { size: number } } }).__scene;
            return (scene?.modelManager?.size ?? 0) > 0;
        });
        expect(hasModel).toBe(true);
    });

    test("VMD 加载：fetch → IndexedDB → loadManager → 动作绑定", async ({ page }) => {
        const result = await page.evaluate(async () => {
            const resp = await fetch("/MikuMikuAR/fixtures/sample.vmd");
            if (!resp.ok) throw new Error(`fetch vmd failed: ${resp.status}`);
            const bytes = new Uint8Array(await resp.arrayBuffer());

            const dbReq = indexedDB.open("mikumikuar-web");
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                dbReq.onsuccess = () => resolve(dbReq.result);
                dbReq.onerror = () => reject(dbReq.error);
            });
            const tx = db.transaction("models", "readwrite");
            await new Promise<void>((resolve, reject) => {
                const req = tx.objectStore("models").put(bytes, "file:sample");
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });

            const loadManager = await import("/src/core/load-manager.ts");
            try {
                await loadManager.loadManager.load({ kind: "vmd", path: "sample.vmd" });
                return { ok: true, error: null };
            } catch (e) {
                return { ok: false, error: String(e) };
            }
        });

        expect(result.error).toBeNull();
        expect(result.ok).toBe(true);
    });

    test("ZIP 加载：fetch → IndexedDB → ExtractZip → PMX 提取", async ({ page }) => {
        const result = await page.evaluate(async () => {
            const resp = await fetch("/MikuMikuAR/fixtures/sample.zip");
            if (!resp.ok) throw new Error(`fetch zip failed: ${resp.status}`);
            const bytes = new Uint8Array(await resp.arrayBuffer());

            // 写入 entry + file（同 drop-import.ts 浏览器分支）
            const dbReq = indexedDB.open("mikumikuar-web");
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                dbReq.onsuccess = () => resolve(dbReq.result);
                dbReq.onerror = () => reject(dbReq.error);
            });
            const tx = db.transaction("models", "readwrite");
            await new Promise<void>((resolve, reject) => {
                const req = tx.objectStore("models").put(bytes, "file:sample");
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });

            // 调用 ExtractZip（走 wails-bindings → resolveBackend → browserAdapter）
            const wailsBindings = await import("/src/core/wails-bindings.ts");
            try {
                const extractResult = await wailsBindings.ExtractZip("sample.zip", "");
                return {
                    ok: true,
                    error: null,
                    filePath: extractResult?.file_path ?? null,
                };
            } catch (e) {
                return { ok: false, error: String(e), filePath: null };
            }
        });

        expect(result.error).toBeNull();
        expect(result.ok).toBe(true);
        // ExtractZip 应返回主 PMX 路径
        expect(result.filePath).toBeTruthy();
        expect(result.filePath).toMatch(/\.pmx$/);
    });

    test("IndexedDB 读写：写入后可读回相同字节", async ({ page }) => {
        // 验证 IndexedDB 基础 CRUD（models store）
        const result = await page.evaluate(async () => {
            const testBytes = new Uint8Array([1, 2, 3, 4, 5]);
            const dbReq = indexedDB.open("mikumikuar-web");
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                dbReq.onsuccess = () => resolve(dbReq.result);
                dbReq.onerror = () => reject(dbReq.error);
            });

            // 写
            const txWrite = db.transaction("models", "readwrite");
            await new Promise<void>((resolve, reject) => {
                const req = txWrite.objectStore("models").put(testBytes, "file:idbtest");
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });

            // 读
            const txRead = db.transaction("models", "readonly");
            const readBytes = await new Promise<Uint8Array>((resolve, reject) => {
                const req = txRead.objectStore("models").get("file:idbtest");
                req.onsuccess = () => resolve(req.result as Uint8Array);
                req.onerror = () => reject(req.error);
            });

            return {
                length: readBytes?.length ?? 0,
                matches: readBytes?.length === 5 &&
                    readBytes[0] === 1 && readBytes[4] === 5,
            };
        });

        expect(result.length).toBe(5);
        expect(result.matches).toBe(true);
    });
});
