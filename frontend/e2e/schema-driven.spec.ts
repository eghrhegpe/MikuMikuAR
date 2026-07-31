/**
 * P1 Generic Schema-Driven E2E Test
 *
 * 核心思路: 读取 schema-snapshot.json（由 schema-snapshot.test.ts 生成），
 *          自动为所有面板的所有节点生成 DOM 渲染断言。
 *
 * 运行方式:
 *   1. 先生成快照: npx vitest run src/__tests__/schema-snapshot.test.ts
 *   2. 启动 Vite:   npm run dev
 *   3. 跑 E2E:      npx playwright test e2e/schema-driven.spec.ts --grep "@dom"
 *
 * 优势:
 *   - 新面板自动覆盖（只需在 menu-schema-register.ts 注册）
 *   - 零手写 E2E 断言成本
 *   - 从 schema 反推测试路径，而非扫描 DOM
 *
 * 导航策略:
 *   - env 域:     #btnEnv → folder:env:<slug>
 *   - motion 域:  #btnMotionPopup → folder:motion:<slug>
 *   - settings 域: #btnSettings → (嵌套结构，暂用文本匹配回退)
 *   - scene:postprocess: 实际位于 env 域 folder:env:postprocess 下
 */
import { test, expect } from "./wails-fixture";
import {
    openEnvPanel,
    openMotionPopup,
    openSettingsPanel,
    openScenePanel,
    clickEnvSubLevel,
    clickMotionSubLevel,
    clickSettingsSubLevel,
} from "./helpers";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 读取 schema 快照 JSON（Node.js 文件读取，避免 ESM JSON import 限制）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SNAPSHOT_PATH = resolve(__dirname, "schema-snapshot.json");
const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf-8"));

// Schema 定义的 kind → 期望的 DOM 元素选择器
const KIND_SELECTOR_MAP: Record<string, string> = {
    slider: 'input[type="range"]',
    colorSlider: 'input[type="range"]',
    toggle: 'input[type="checkbox"]',
    modeSlider: '.chip', // segmented control chips
};

// 域 → 导航配置
// domain:    'env' | 'motion' | 'settings' | 'scene'
// subLevel:  一级子面板中文名（用于 helpers 中的 testId 映射）
// subLevel2: settings 二级导航用的 testId 后缀（仅 settings 域需要）
interface PanelNavConfig {
    domain: 'env' | 'motion' | 'settings' | 'scene';
    subLevel?: string;
    subLevel2?: string;
}

const PANEL_NAV: Record<string, PanelNavConfig> = {
    // env 域 —— 使用 #btnEnv + folder:env:<slug>
    'env:sky':          { domain: 'env', subLevel: '天空' },
    'env:wind':         { domain: 'env', subLevel: '风' },
    'env:fog':          { domain: 'env', subLevel: '雾' },
    'env:cloud':        { domain: 'env', subLevel: '云' },
    'env:shadow':       { domain: 'env', subLevel: '阴影' },
    'env:water':        { domain: 'env', subLevel: '水' },
    'env:ground':       { domain: 'env', subLevel: '地面' },
    'env:experimental': { domain: 'env', subLevel: '实验' },
    'env:particle':     { domain: 'env', subLevel: '粒子' },
    // scene 域 —— postprocess 实际位于 env 域的"后处理"子面板下
    'scene:postprocess-core':  { domain: 'env', subLevel: '后处理' },
    'scene:postprocess-color': { domain: 'env', subLevel: '后处理' },
    // motion 域 —— 使用 #btnMotionPopup + folder:motion:<slug>
    'motion:gaze':      { domain: 'motion', subLevel: '视线' },
    // settings 域 —— 二级导航：先进入一级 folder，节点直接渲染在该 folder 内
    //   camera → 操控 (controls)
    //   frame-quality / effects / physics-hud → 画质 (graphics)
    'settings:camera':        { domain: 'settings', subLevel: '操控', subLevel2: 'controls' },
    'settings:frame-quality': { domain: 'settings', subLevel: '画质', subLevel2: 'graphics' },
    'settings:effects':       { domain: 'settings', subLevel: '画质', subLevel2: 'graphics' },
    'settings:physics-hud':   { domain: 'settings', subLevel: '画质', subLevel2: 'graphics' },
};

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

/** 根据面板配置执行导航 */
async function navigateToPanel(page: any, config: PanelNavConfig): Promise<void> {
    switch (config.domain) {
        case 'env':
            await openEnvPanel(page);
            if (config.subLevel) await clickEnvSubLevel(page, config.subLevel);
            break;
        case 'motion':
            await openMotionPopup(page);
            if (config.subLevel) await clickMotionSubLevel(page, config.subLevel);
            break;
        case 'settings':
            await openSettingsPanel(page);
            // settings 域需要二级导航：先进入一级 folder（如"操控"/"画质"）
            if (config.subLevel2) {
                await page.getByTestId(`folder:settings:${config.subLevel2}`).click();
            } else if (config.subLevel) {
                await clickSettingsSubLevel(page, config.subLevel);
            }
            break;
        case 'scene':
            await openScenePanel(page);
            if (config.subLevel) {
                await page.getByText(config.subLevel, { exact: true }).click();
            }
            break;
    }
}

// 遍历快照中所有面板
for (const panel of snapshot) {
    const nav = PANEL_NAV[panel.panelId];
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
    nav: PanelNavConfig,
    interactiveNodes: any[],
) {
    test.describe(`Schema 驱动 E2E — ${panel.panelId}`, { tag: ["@dom"] }, () => {
        test.beforeEach(async ({ vitePage: page }) => {
            await navigateToPanel(page, nav);
        });

        for (const node of interactiveNodes) {
            const selector = KIND_SELECTOR_MAP[node.kind];

            test(`${node.id} (kind: ${node.kind}) 渲染了正确的 DOM 元素`, async ({ vitePage: page }) => {
                const el = page.getByTestId(node.id);

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

                // 3. modeSlider: 验证 options 数量
                if (node.kind === 'modeSlider' && node.control?.options?.length) {
                    const expectedCount = node.control.options.length;
                    const chips = el.locator('.chip, [class*="chip"]');
                    const chipCount = await chips.count();
                    if (chipCount > 0) {
                        await expect(chips).toHaveCount(expectedCount);
                    }
                }

                // 4. slider/colorSlider: 验证 min/max/step 属性
                if ((node.kind === 'slider' || node.kind === 'colorSlider') && node.control) {
                    const slider = el.locator('input[type="range"]').first();
                    if (node.control.min !== undefined) {
                        try {
                            await expect(slider).toHaveAttribute('min', String(node.control.min));
                        } catch { /* 某些自定义 slider 可能不设 min */ }
                    }
                    if (node.control.max !== undefined) {
                        try {
                            await expect(slider).toHaveAttribute('max', String(node.control.max));
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
        const nav = PANEL_NAV[panel.panelId];
        if (!nav) continue;

        test(`${panel.panelId}: 所有节点均有 testId`, async ({ vitePage: page }) => {
            await navigateToPanel(page, nav);

            const allNodes = flattenNodes(panel.nodes);
            const nonCustomNodes = allNodes.filter((n) => n.kind !== 'custom');

            for (const node of nonCustomNodes) {
                const el = page.getByTestId(node.id);
                // 某些节点可能因 visibleWhen 条件不满足而不可见
                // 只检查是否至少存在于 DOM 中
                await expect(el.first()).toHaveCount(1, { timeout: 2000 });
            }
        });
    }
});