// 组件隔离渲染截图探针：生成语言包 → 起 vite dev → 逐面板打开
// /harness/index.html?c=<name> → 等 body[data-ready=1] → 截图存 harness/_shots/。
// 用法: node harness/shot.mjs [面板名...]   (无参 = REGISTRY 全量，清单从页面读取)
// 与 e2e 的分工：harness 管「单面板隔离视觉」，e2e 管「全 app 行为回归」（playwright.config.ts）。
import { spawn, spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..'); // frontend/
const PORT = 5299; // 避开 5173(桌面 dev) / 4174(web preview)；5199 系 ysm-model-manager 同名 harness 在用
const OUT = path.join(here, '_shots');

const requested = process.argv.slice(2);
// 清单单源：无参时打开 harness 页读 window.__harnessRegistry__（main.ts 挂载），
// 脚本侧不再抄一份清单，防双源漂移。

// 语言包单一来源：public/locales/*.json 由 ../scripts/generate-locale-json.mjs 生成。
// 缺失时 loadLocale 静默 fail-open（bundles={} → 界面裸奔 i18n key），
// 截图前幂等重跑一遍，失败即拒绝（对空语言包截图是无声假绿）。
const gen = spawnSync('node', ['../scripts/generate-locale-json.mjs'], {
    cwd: root,
    stdio: 'inherit',
});
if (gen.status !== 0) {
    console.error('[locale] generate-locale-json 失败，拒绝对空语言包截图');
    process.exit(1);
}

async function readRegistry(url) {
    const b = await chromium.launch({ headless: true });
    const p = await b.newPage();
    await p.goto(`${url}/harness/index.html`, { waitUntil: 'domcontentloaded' });
    try {
        await p.waitForFunction(() => Array.isArray(window.__harnessRegistry__), null, {
            timeout: 15000,
        });
        return await p.evaluate(() => window.__harnessRegistry__);
    } finally {
        await b.close();
    }
}

async function startVite() {
    let exited = false;
    const proc = spawn(
        'npx',
        ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
        { cwd: root, stdio: 'pipe', shell: true },
    );
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
    // 端口被残留 server 占据时，新 vite 因 --strictPort 立即退出，但 fetch 探测照样
    // 成功 → 全程对着旧代码截图的静默假绿。退出即置位，探测成功但已退出须显式警告复用。
    proc.on('exit', () => {
        exited = true;
    });
    const url = `http://127.0.0.1:${PORT}`;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        try {
            const resp = await fetch(`${url}/harness/index.html`);
            if (resp.ok) {
                // 页面指纹：同机其它仓的同名 harness（路径相同的 vite 残留）也能通过
                // 端口探测，认页面不认端口——指纹不符视为撞车，fail-fast。
                const html = await resp.text();
                if (!html.includes('MikuMikuAR harness')) {
                    throw new Error(
                        `port ${PORT} serves a foreign harness page (another repo's leftover vite?) — change PORT`,
                    );
                }
                if (exited) {
                    console.warn(
                        `[WARN] reusing external server on :${PORT} (spawned vite exited; shots may be STALE code)`,
                    );
                }
                return { url, proc };
            }
        } catch (e) {
            if (e instanceof Error && e.message.includes('foreign harness')) throw e;
            /* server not up yet */
        }
        if (exited) throw new Error('vite exited before becoming reachable (see [vite] stderr above)');
        await new Promise((r) => setTimeout(r, 300));
    }
    proc.kill();
    throw new Error('vite dev server failed to start within 30s');
}

const { url, proc } = await startVite();
const names = requested.length > 0 ? requested : await readRegistry(url);
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
    headless: true,
    // harness 不建 WebGL 上下文（无引擎），无需 e2e 的 swiftshader 组；
    // --disable-dev-shm-usage 沿用 e2e 教训（低内存 renderer 崩溃）。
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (err) => console.error(`[pageerror:${page.url()}] ${err.message}`));

let failed = 0;
for (const name of names) {
    await page.goto(`${url}/harness/index.html?c=${name}`, { waitUntil: 'domcontentloaded' });
    try {
        // 首个面板含 vite 冷 transform，放宽到 20s
        await page.waitForSelector('body[data-ready="1"]', { timeout: 20000 });
    } catch {
        console.error(`FAIL ${name}: data-ready never set (panel hung on open?)`);
        failed += 1;
        continue;
    }
    const err = await page.getAttribute('body', 'data-error');
    if (err !== null) {
        console.error(`FAIL ${name}: ${err}`);
        failed += 1;
        continue;
    }
    // 等一拍菜单过渡动画/图标网络加载，避免截到入场中间帧。
    await page.waitForTimeout(600);
    const shot = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    console.log(`SHOT ${name} -> ${shot}`);
}

await browser.close();
// shell:true 下 proc.kill 只杀 shell，孙进程 vite 会残留占端口。
// Windows 走 taskkill /T /F 树杀，且必须同步等完再 exit（fire-and-forget 会被
// process.exit 抢跑，残留竞速）。
if (process.platform === 'win32') {
    const pid = proc.pid;
    if (pid !== undefined) {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
    }
} else {
    proc.kill('SIGTERM');
}
process.exit(failed > 0 ? 1 : 0);
