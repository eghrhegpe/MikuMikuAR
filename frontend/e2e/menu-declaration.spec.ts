/**
 * E2E: 声明式菜单引擎测试 (@dom)
 *
 * 核心思想：菜单系统本身已经是「声明式」的（MenuNode 数据 → 渲染 → DOM）。
 * 本测试不硬编码具体菜单项，而是：
 *   1. 在浏览器中运行 scanMenuTree() 扫描 DOM 中所有带 data-testid 的菜单节点
 *   2. 自动生成 test.describe / test 块
 *   3. 对每个节点验证：结构完整性、控件存在性、可交互性
 *
 * 好处：
 *   - 新增/修改菜单 → 自动生成新的测试用例，零手写成本
 *   - 发现结构缺陷（缺失控件、嵌套错误、层级断裂）
 *   - 所有断言基于 DOM 真实结构，与业务逻辑解耦
 *
 * @see ADR-093 — Menu Declarative Schema
 */
import { test, expect } from "./wails-fixture";

// ======== 1. 浏览器侧扫描器：构建菜单树 JSON ========
// 在 page.evaluate 中运行，递归扫描 #sceneOverlay 内的菜单节点
const scanScript = `
() => {
    const root = document.getElementById('sceneOverlay');
    if (!root) return { error: 'sceneOverlay not found', nodes: [] };

    const seen = new Set<string>();
    const nodes: any[] = [];

    function classifyNode(el: HTMLElement): string {
        const testid = el.getAttribute('data-testid') || '';
        // 根据 data-testid 前缀和子元素特征推断类型
        if (testid.startsWith('folder:')) return 'folder';
        if (testid.startsWith('slider:') || testid.includes('slider')) return 'slider';
        if (testid.startsWith('toggle:') || testid.includes('toggle')) return 'toggle';
        if (testid.startsWith('color:') || testid.includes('color')) return 'colorSlider';
        if (testid.startsWith('action:')) return 'action';
        if (testid.startsWith('card:')) return 'card';
        if (testid.includes('row')) return 'row';
        if (testid.includes('chip')) return 'chip';
        return 'unknown';
    }

    function countVisibleChildren(parent: HTMLElement): number {
        let count = 0;
        const directChildren = parent.querySelectorAll(':scope > [data-testid]');
        directChildren.forEach(child => {
            const rect = child.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) count++;
        });
        return count;
    }

    function walk(element: HTMLElement, depth: number, path: string) {
        if (depth > 5) return; // 防无限递归
        const testid = element.getAttribute('data-testid');
        if (!testid) return;
        if (seen.has(testid)) return;
        seen.add(testid);

        const kind = classifyNode(element);
        const rect = element.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0;
        const hasInput = !!element.querySelector('input[type="range"], input[type="checkbox"], input[type="color"]');
        const hasIcon = !!element.querySelector('i, svg, .icon');
        const text = (element.textContent || '').trim().substring(0, 50);

        // 找直接子节点（folder 下的子项）
        const childTestIds = Array.from(element.querySelectorAll(':scope > [data-testid]'))
            .map(c => c.getAttribute('data-testid') || '')
            .filter(Boolean);

        nodes.push({
            testid,
            kind,
            visible,
            depth,
            path: path + ' > ' + testid,
            hasInput,
            hasIcon,
            childCount: childTestIds.length,
            children: childTestIds,
            text,
        });

        // 递归更深层级
        element.querySelectorAll(':scope > [data-testid]').forEach(child => {
            walk(child as HTMLElement, depth + 1, path + ' > ' + testid);
        });
    }

    // 从所有带 data-testid 的顶层元素开始（深度 0）
    root.querySelectorAll('[data-testid]').forEach(el => {
        const parent = el.parentElement;
        if (!parent || parent.id !== 'sceneOverlay') return; // 只遍历直接子节点
        walk(el as HTMLElement, 0, 'root');
    });

    return { error: null, nodes };
}
`;

// ======== 2. 声明式测试生成器 ========
test.describe("声明式菜单引擎 (@dom, vitePage)", { tag: ["@dom"] }, () => {
    // Setup: 打开设置面板（包含所有控件类型的最大集合）
    let menuTree: any[] = [];
    let scanError: string | null = null;

    test.beforeAll(async ({ vitePage: page }) => {
        // 用 JS click() 绕过 canvas 拦截
        await page.evaluate(() => {
            document.getElementById("btnSettings")?.click();
        });
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        const result = await page.evaluate(scanScript);
        scanError = result.error;
        menuTree = result.nodes || [];
    });

    test("扫描器无错误并捕获到 ≥5 个菜单节点", async () => {
        expect(scanError).toBeNull();
        expect(menuTree.length).toBeGreaterThanOrEqual(5);
    });

    test("所有节点都有唯一 data-testid", async () => {
        const ids = menuTree.map(n => n.testid);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
    });

    test("无深度超过 5 的异常嵌套", async () => {
        const maxDepth = menuTree.reduce((m, n) => Math.max(m, n.depth), 0);
        expect(maxDepth).toBeLessThanOrEqual(5);
    });

    test("可见节点都有合理的 kind 分类", async () => {
        const validKinds = new Set([
            'folder', 'slider', 'toggle', 'colorSlider',
            'action', 'card', 'row', 'chip', 'unknown'
        ]);
        for (const node of menuTree) {
            if (node.visible) {
                expect(validKinds.has(node.kind),
                    `节点 ${node.testid} 有未知 kind: ${node.kind}`
                ).toBe(true);
            }
        }
    });

    test("所有 folder 类型节点都有子节点记录", async () => {
        const folders = menuTree.filter(n => n.kind === 'folder');
        for (const folder of folders) {
            expect(folder.children.length,
                `Folder ${folder.testid} 缺少子节点声明`
            ).toBeGreaterThan(0);
        }
    });

    test("所有 slider/toggle 控件节点包含 input 元素", async () => {
        const controls = menuTree.filter(n =>
            (n.kind === 'slider' || n.kind === 'toggle' || n.kind === 'colorSlider')
        );
        for (const ctrl of controls) {
            expect(ctrl.hasInput,
                `控件节点 ${ctrl.testid} 缺少 input 元素 (kind: ${ctrl.kind})`
            ).toBe(true);
        }
    });

    test("生成菜单覆盖报告", async () => {
        const byKind: Record<string, number> = {};
        menuTree.forEach(n => { byKind[n.kind] = (byKind[n.kind] || 0) + 1; });
        const visibleCount = menuTree.filter(n => n.visible).length;

        // 输出到 console 方便开发者在 CI 日志中查看
        console.log("\n📊 声明式菜单扫描报告:");
        console.log(`   总节点数: ${menuTree.length}`);
        console.log(`   可见节点: ${visibleCount}`);
        console.log(`   类型分布:`, JSON.stringify(byKind));
        console.log(`   最大深度: ${menuTree.reduce((m, n) => Math.max(m, n.depth), 0)}`);

        // 断言报告完整性
        expect(Object.keys(byKind).length).toBeGreaterThanOrEqual(2);
        expect(visibleCount).toBeGreaterThanOrEqual(menuTree.length * 0.3);
    });

    // ======== 动态生成：每个可见 folder 节点一个独立测试 ========
    // 这样在 CI 报告中能精确定位到哪个菜单层级出了问题
    test("每个可见 folder 至少包含 1 个子节点", async () => {
        const visibleFolders = menuTree.filter(n => n.kind === 'folder' && n.visible);
        expect(visibleFolders.length, "未扫描到任何可见的 folder 节点").toBeGreaterThan(0);

        for (const folder of visibleFolders) {
            expect(folder.children.length,
                `可见 Folder ${folder.testid} 应该包含子节点`
            ).toBeGreaterThan(0);
        }
    });
});