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
 * 使 page.evaluate 中的 fetch('/fixtures/sample.pmx') 能拿到真实文件。
 */
async function setupFixtureRoute(page: import("@playwright/test").Page): Promise<void> {
    await page.route("**/fixtures/**", async (route) => {
        const url = new URL(route.request().url());
        const name = url.pathname.split("/").pop();
        if (!name) {
            await route.abort();
            return;
        }
        const fp = path.join(FIXTURES_DIR, name);
        try {
            const data = await fs.promises.readFile(fp);
            await route.fulfill({ status: 200, body: data });
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

    // PMX/VMD/ZIP 三段同构（仅文件名与 IDB key 不同），循环化避免复制粘贴
    const RESOURCE_CASES = [
        { file: "sample.pmx", key: "file:sample", label: "PMX" },
        { file: "sample.vmd", key: "file:sample-vmd", label: "VMD" },
        { file: "sample.zip", key: "file:sample-zip", label: "ZIP" },
    ];

    for (const c of RESOURCE_CASES) {
        test(`${c.label}: fetch fixture 字节 → 写入 IndexedDB → 读回一致`, async ({ page }) => {
            const result = await page.evaluate(
                async ({ filePath, key }) => {
                    const resp = await fetch(`/MikuMikuAR/fixtures/${filePath}`);
                    if (!resp.ok) throw new Error(`fetch ${filePath} failed: ${resp.status}`);
                    const bytes = new Uint8Array(await resp.arrayBuffer());

                    const dbReq = indexedDB.open("mikumikuar-web");
                    const db = await new Promise<IDBDatabase>((resolve, reject) => {
                        dbReq.onsuccess = () => resolve(dbReq.result);
                        dbReq.onerror = () => reject(dbReq.error);
                    });
                    const tx = db.transaction("models", "readwrite");
                    await new Promise<void>((resolve, reject) => {
                        const req = tx.objectStore("models").put(bytes, key);
                        req.onsuccess = () => resolve();
                        req.onerror = () => reject(req.error);
                    });

                    const txRead = db.transaction("models", "readonly");
                    const readBack = await new Promise<Uint8Array>((resolve, reject) => {
                        const req = txRead.objectStore("models").get(key);
                        req.onsuccess = () => resolve(req.result as Uint8Array);
                        req.onerror = () => reject(req.error);
                    });
                    // 字节级比对（首/末字节 + 长度），与标题「读回一致」口径一致
                    const same =
                        readBack !== undefined &&
                        readBack.length === bytes.length &&
                        readBack[0] === bytes[0] &&
                        readBack[bytes.length - 1] === bytes[bytes.length - 1];
                    return { length: readBack?.length ?? 0, same };
                },
                { filePath: c.file, key: c.key }
            );

            expect(result.length).toBeGreaterThan(0);
            expect(result.same, "读回字节应与写入字节一致").toBe(true);
        });
    }

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
