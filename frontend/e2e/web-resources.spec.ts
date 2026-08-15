/**
 * [doc:adr-177] Phase 4 — Web 入口资源数据链路测试
 *
 * 生产构建（vite preview）下无法 import 源码模块（/src/ 路径不存在），
 * 也无法经 window.__scene（dev-hooks 不注入生产构建）验证渲染结果。
 * 故 @web 侧聚焦浏览器可直验的数据准备链路：
 *   fetch 字节 → IndexedDB 写入 → 读回一致
 *
 * 真实「PMX/VMD/ZIP 加载 → 渲染」闭环由 @webgl 的 model-load.spec.ts /
 * model-lifecycle-webgl.spec.ts（wailsPage，真实 Wails runtime）覆盖。
 *
 * 运行：npx playwright test --grep "@web" web-resources
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { gotoWebEntry } from "./helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "fixtures");

/**
 * 拦截 /fixtures/* 请求，注入本地 fixture 文件字节。
 *
 * 必须使用跨源 fixture 地址（127.0.0.1:4175）而非同源 /MikuMikuAR/fixtures/*：
 * gotoWebEntry 等待 SW 接管后，同源 fetch 会被 Service Worker 的 fetch 事件接管，
 * Playwright page.route 不再拦截（实测 404），而 SW 对跨源请求直接放行，
 * page.route 可以稳定命中并返回真实 fixture 字节。
 */
const FIXTURE_ORIGIN = "http://127.0.0.1:4175";
async function setupFixtureRoute(page: import("@playwright/test").Page): Promise<void> {
    await page.route("http://127.0.0.1:4175/fixtures/**", async (route) => {
        const url = new URL(route.request().url());
        const name = url.pathname.split("/").pop();
        if (!name) {
            await route.abort();
            return;
        }
        const fp = path.join(FIXTURES_DIR, name);
        try {
            const data = await fs.promises.readFile(fp);
            await route.fulfill({
                status: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Cross-Origin-Resource-Policy": "cross-origin",
                },
                body: data,
            });
        } catch {
            await route.abort();
        }
    });
}

test.describe("Web Resources — PMX/ZIP/VMD 数据链路 (@web)", { tag: ["@web"] }, () => {
    test.beforeEach(async ({ page }) => {
        await setupFixtureRoute(page);
        await gotoWebEntry(page);
    });

    // PMX/VMD/ZIP 三段同构（IDB key 对齐 drop-import/browser-adapter 的 file:<stem> 规约）。
    // 三个 fixture 的 stem 都是 sample，因此生产键都是 file:sample：PMX/VMD 经
    // drop-import.ts 去扩展名写入，ZIP 经 idb.ts saveModel 去 .zip 写入。
    const RESOURCE_CASES = [
        { file: "sample.pmx", key: "file:sample", label: "PMX" },
        { file: "sample.vmd", key: "file:sample", label: "VMD" },
        { file: "sample.zip", key: "file:sample", label: "ZIP" },
    ];

    for (const c of RESOURCE_CASES) {
        test(`${c.label}: fetch fixture 字节 → 写入 IndexedDB → 读回一致`, async ({ page }) => {
            const result = await page.evaluate(
                async ({ filePath, key, fixtureOrigin }) => {
                    // 跨源地址绕过 SW 接管，使 Playwright page.route 能稳定命中 fixture。
                    const resp = await fetch(`${fixtureOrigin}/fixtures/${filePath}`);
                    if (!resp.ok) throw new Error(`fetch ${filePath} failed: ${resp.status}`);
                    const bytes = new Uint8Array(await resp.arrayBuffer());

                    // 显式 version=2 对齐 idb.ts DB_VERSION，并补建缺失 store，
                    // 避免依赖 app 是否已先建库（page.route 与 SW 时序解耦）。
                    const db = await new Promise<IDBDatabase>((resolve, reject) => {
                        const dbReq = indexedDB.open("mikumikuar-web", 2);
                        dbReq.onupgradeneeded = () => {
                            const d = dbReq.result;
                            if (!d.objectStoreNames.contains("models")) {
                                d.createObjectStore("models");
                            }
                        };
                        dbReq.onsuccess = () => resolve(dbReq.result);
                        dbReq.onerror = () => reject(dbReq.error);
                    });

                    // 写：等事务 complete（而非 put request success），与 idb.ts idbSet 语义一致。
                    await new Promise<void>((resolve, reject) => {
                        const tx = db.transaction("models", "readwrite");
                        tx.objectStore("models").put(bytes, key);
                        tx.oncomplete = () => resolve();
                        tx.onerror = () => reject(tx.error);
                        tx.onabort = () => reject(tx.error);
                    });

                    // 读：返回 undefined 时 same=false，交由 Playwright 断言暴露。
                    const readBack = await new Promise<Uint8Array | undefined>((resolve, reject) => {
                        const tx = db.transaction("models", "readonly");
                        const req = tx.objectStore("models").get(key);
                        req.onsuccess = () => resolve(req.result as Uint8Array | undefined);
                        req.onerror = () => reject(req.error);
                    });
                    db.close();

                    // 全字节比对（长度 + 每个字节），避免只查首尾字节导致中间损坏假绿。
                    const same =
                        readBack !== undefined &&
                        readBack.length === bytes.length &&
                        readBack.every((v, i) => v === bytes[i]);
                    return { length: readBack?.length ?? 0, same };
                },
                { filePath: c.file, key: c.key, fixtureOrigin: FIXTURE_ORIGIN }
            );

            expect(result.length).toBeGreaterThan(0);
            expect(result.same, "读回字节应与写入字节一致").toBe(true);
        });
    }

    test("IndexedDB 读写：写入后可读回相同字节", async ({ page }) => {
        // 验证 IndexedDB 基础 CRUD（models store）
        const result = await page.evaluate(async () => {
            const testBytes = new Uint8Array([1, 2, 3, 4, 5]);
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const dbReq = indexedDB.open("mikumikuar-web", 2);
                dbReq.onupgradeneeded = () => {
                    const d = dbReq.result;
                    if (!d.objectStoreNames.contains("models")) {
                        d.createObjectStore("models");
                    }
                };
                dbReq.onsuccess = () => resolve(dbReq.result);
                dbReq.onerror = () => reject(dbReq.error);
            });

            // 写：等事务 complete，避免 put request success 后立即读的竞态。
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction("models", "readwrite");
                tx.objectStore("models").put(testBytes, "file:idbtest");
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });

            // 读
            const readBytes = await new Promise<Uint8Array | undefined>((resolve, reject) => {
                const tx = db.transaction("models", "readonly");
                const req = tx.objectStore("models").get("file:idbtest");
                req.onsuccess = () => resolve(req.result as Uint8Array | undefined);
                req.onerror = () => reject(req.error);
            });
            db.close();

            return {
                length: readBytes?.length ?? 0,
                matches:
                    readBytes !== undefined &&
                    readBytes.length === testBytes.length &&
                    readBytes.every((v, i) => v === testBytes[i]),
            };
        });

        expect(result.length).toBe(5);
        expect(result.matches).toBe(true);
    });
});
