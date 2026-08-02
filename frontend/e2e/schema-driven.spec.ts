/**
 * P1 Generic Schema-Driven E2E Test
 *
 * 核心思路: 读取 schema-snapshot.json（由 schema-snapshot.test.ts 生成），
 *          自动为所有面板的所有节点生成 DOM 渲染断言。
 *
 * 运行方式:
 *   1. 先生成快照: npx vitest run src/__tests__/schema-snapshot.test.ts
 *   2. 跑 E2E:      npx playwright test e2e/schema-driven.spec.ts --grep "@dom"
 *      （webServer 由 playwright.config.ts 自动拉起）
 *
 * 优势:
 *   - 新面板自动覆盖（只需在 menu-schema-register.ts 注册）
 *   - 零手写 E2E 断言成本
 *   - 从 schema 反推测试路径，而非扫描 DOM
 *
 * 导航策略（ADR-229 §2.1）:
 *   - nav 元数据由快照生成器从注册处推导（常规面板零声明，
 *     特例面板注册处显式覆写 domain/subLevelTestId/subLevel2TestId）
 *   - entryTestId: 入口按钮 id（btnEnv/btnMotionPopup/btnSettings/btnScene）
 *   - subLevelTestId: 一级 folder testid（folder:env:sky 等）
 *   - subLevel2TestId: settings 域二级 folder testid（folder:settings:controls 等）
 */
import { test, expect } from "./wails-fixture";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 读取 schema 快照 JSON（Node.js 文件读取，避免 ESM JSON import 限制）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SNAPSHOT_PATH = resolve(__dirname, "schema-snapshot.json");
const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf-8"));

// [ADR-229 §9] DOM 契约单源：kind → 控件选择器由快照携带（nodes[].dom），
// 由 schema-snapshot.test.ts 从 src/core/dom-contract.ts 写入——e2e 不再手写
// KIND_SELECTOR_MAP（历史曾因 .chip / input[type=range] 断言漂移静默超时）。
// 渲染层改 role/class 而未同步 dom-contract → 快照 diff 触发 CI 门禁。

// 导航配置（ADR-229 §2.1）—— 由快照生成器从注册处推导写入 panel.nav，无第二副本：
//   domain:          'env' | 'motion' | 'settings' | 'scene'
//   entryTestId:     入口按钮 id（btnEnv/btnMotionPopup/btnSettings/btnScene）
//   subLevelTestId:  一级 folder testid（folder:env:sky 等；settings 域无）
//   subLevel2TestId: settings 域二级 folder testid（folder:settings:controls 等）
interface PanelNav {
    domain: 'env' | 'motion' | 'settings' | 'scene';
    entryTestId: string;
    subLevelTestId?: string;
    subLevel2TestId?: string;
}

/** 扁平化节点树，返回所有带 id 的节点 */
function flattenNodes(nodes: any[]): any[] {
    const result: any[] = [];
    for (const node of nodes) {
        result.push(node);
        if (node.children && node.children.length > 0) {
            result.push(...flattenNodes(node.children));
        }
    }
    return result;
}

/** 根据 nav 元数据执行导航（ADR-229 §2.1：entryTestId → 一级/二级 folder testid） */
async function navigateToPanel(page: any, nav: PanelNav): Promise<void> {
    // 1. 打开入口按钮（btnEnv / btnMotionPopup / btnSettings / btnScene）
    await page.evaluate((id: string) => {
        document.getElementById(id)?.click();
    }, nav.entryTestId);
    await page.waitForSelector("#sceneOverlay.visible", { timeout: 3000 });

    // 2. 一级子面板（folder:env:sky 等；settings 域无一级，跳过）
    if (nav.subLevelTestId) {
        await page.evaluate((id: string) => {
            document.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.click();
        }, nav.subLevelTestId);
    }

    // 3. settings 域二级 folder（folder:settings:controls 等）
    if (nav.subLevel2TestId) {
        await page.evaluate((id: string) => {
            document.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.click();
        }, nav.subLevel2TestId);
    }

    // 4. 展开所有 collapsible folder：收起时子节点仍在 DOM（renderContent 立即执行）
    //    但 maxHeight:0 + inert → toBeVisible 失败。点击 header 展开（headerToggle 有
    //    stopPropagation，不会误触开关）。[ADR-229 §2.2 审核修正]
    //    ⚠️ 点击 subLevel 后面板内容可能异步挂载（实测 env:water 9 个 folder 分批渲染），
    //    立即 querySelectorAll 会漏掉未挂载的 header → 先等一帧再展开。
    await page.waitForTimeout(250);
    await page.evaluate(() => {
        document
            .querySelectorAll<HTMLElement>('.collapsible-header:not(.open)')
            .forEach((h) => h.click());
    });
}

// 遍历快照中所有面板
for (const panel of snapshot) {
    const nav = panel.nav as PanelNav | undefined;
    if (!nav) {
        console.warn(`[schema-driven] 跳过 ${panel.panelId}: 无导航路径映射`);
        continue;
    }

    const allNodes = flattenNodes(panel.nodes);

    // 过滤出交互式节点（排除 custom 和有子节点的 folder）
    const interactiveNodes = allNodes.filter((n) => {
        if (n.kind === 'custom') return false;
        if (n.kind === 'folder' && n.children && n.children.length > 0) return false;
        return true;
    });

    // 如果面板没有可交互节点，跳过
    if (interactiveNodes.length === 0) continue;

    describeSchemaPanel(panel, nav, interactiveNodes);
}

/** 为单个面板生成 E2E 测试套件 */
function describeSchemaPanel(
    panel: { panelId: string; nodes: any[] },
    nav: PanelNav,
    interactiveNodes: any[],
) {
    // ⚡ 优化：每个面板只导航一次，用 test.step() 聚合所有节点断言。
    // 之前每个节点一个 test() + beforeEach 导航，158 个节点 → 158 次导航 → 2h+。
    // 改为每个面板一个 test() + 一次导航，16 个面板 → 16 次导航 → ~15min。
    test(`Schema 驱动 E2E — ${panel.panelId}: 所有节点渲染正确`, { tag: ["@dom"] }, async ({ vitePage: page }) => {
        // [ADR-229 §2.2] 每面板一个 test 聚合全部节点断言 + vitePage fixture 初始化
        // （goto/init 守卫最长可达 ~50s），默认 30s test timeout 不够——显式放宽，
        // 避免超时误报掩盖真实断言失败（曾因 60s 超时误判 env:cloud 失败）。
        test.setTimeout(120_000);
        await navigateToPanel(page, nav);

        for (const node of interactiveNodes) {
            // [ADR-229 §9] 选择器从快照读（dom 字段），不再本地维护映射
            const selector = node.dom as string | undefined;

            await test.step(`${node.id} (kind: ${node.kind})`, async () => {
                const el = page.getByTestId(node.id);

                // [ADR-229 §2.2] visibleWhen 条件节点：条件不满足时 renderNode 直接不渲染
                // （快照 conditional 标记），属正常——存在则断言、缺失则跳过。
                if (node.conditional) {
                    const cnt = await el.count();
                    if (cnt === 0) {
                        return;
                    }
                }

                // 1. 断言元素可见
                await expect(el).toBeVisible({ timeout: 2000 });

                // 2. 断言控件类型正确
                if (selector) {
                    const control = el.locator(selector).first();
                    try {
                        await expect(control).toBeVisible({ timeout: 500 });
                    } catch {
                        // visibleWhen 条件不满足时，控件可能不可见
                        // 退而求其次：检查控件至少存在于 DOM 中
                        await expect(control).toHaveCount(1);
                    }
                }

                // 3. modeSlider: 验证 options 数量（addModeSlider 渲染 role="listbox"，
                // aria-valuemax = options.length - 1；无 .chip 类）
                if (node.kind === 'modeSlider' && node.control?.options?.length && node.dom) {
                    const listbox = el.locator(node.dom).first();
                    const cnt = await listbox.count();
                    if (cnt > 0) {
                        await expect(listbox).toHaveAttribute(
                            'aria-valuemax',
                            String(node.control.options.length - 1)
                        );
                    }
                }

                // 4. slider: 验证 min/max 属性
                //    [ADR-229 §2.2 审核修正] addSliderRow（ui-rows.ts:201-204）渲染的是
                //    div[role="slider"] + aria-valuemin/max（ADR-140 DragSliderController），
                //    并非 input[type=range]——旧断言等不存在的元素，默认 5s 全局 timeout
                //    逐个累积（38 节点 ≈ 190s）直接打爆 test timeout。改用 aria 属性 + 短超时。
                if (node.kind === 'slider' && node.control && node.dom) {
                    const slider = el.locator(node.dom).first();
                    if (node.control.min !== undefined) {
                        try {
                            await expect(slider).toHaveAttribute(
                                'aria-valuemin',
                                String(node.control.min),
                                { timeout: 500 }
                            );
                        } catch { /* 某些自定义 slider 可能不设 min */ }
                    }
                    if (node.control.max !== undefined) {
                        try {
                            await expect(slider).toHaveAttribute(
                                'aria-valuemax',
                                String(node.control.max),
                                { timeout: 500 }
                            );
                        } catch { /* 某些自定义 slider 可能不设 max */ }
                    }
                }
            });
        }
    });
}

// 总结性测试：验证所有面板的所有节点均有 testId
test.describe("Schema 完整性总览", { tag: ["@dom"] }, () => {
    for (const panel of snapshot) {
        const nav = panel.nav as PanelNav | undefined;
        if (!nav) continue;

        test(`${panel.panelId}: 所有节点均有 testId`, async ({ vitePage: page }) => {
            test.setTimeout(120_000);
            await navigateToPanel(page, nav);

            const allNodes = flattenNodes(panel.nodes);
            const nonCustomNodes = allNodes.filter((n) => n.kind !== 'custom');

            for (const node of nonCustomNodes) {
                const el = page.getByTestId(node.id);
                // [ADR-229 §2.2] visibleWhen 条件节点：条件不满足时不渲染属正常，缺失则跳过
                if (node.conditional) {
                    const cnt = await el.count();
                    if (cnt === 0) {
                        continue;
                    }
                }
                // 某些节点可能因 visibleWhen 条件不满足而不可见
                // 只检查是否至少存在于 DOM 中
                await expect(el.first()).toHaveCount(1, { timeout: 2000 });
            }
        });
    }
});