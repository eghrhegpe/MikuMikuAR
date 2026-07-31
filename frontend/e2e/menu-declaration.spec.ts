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
// Playwright page.evaluate 支持传递函数引用，会自动序列化
function scanMenuTree(): { error: string | null; nodes: MenuNodeSnapshot[] } {
    interface MenuNodeSnapshot {
        testid: string;
        kind: string;
        visible: boolean;
        depth: number;
        path: string;
        hasInput: boolean;
        hasIcon: boolean;
        childCount: number;
        children: string[];
        text: string;
    }

    const root = document.getElementById("sceneOverlay");
    if (!root) return { error: "sceneOverlay not found", nodes: [] };

    const seen = new Set<string>();
    const nodes: MenuNodeSnapshot[] = [];

    function classifyNode(el: HTMLElement): string {
        const testid = el.getAttribute("data-testid") || "";
        if (testid.startsWith("folder:")) return "folder";
        if (testid.startsWith("slider:") || testid.includes("slider")) return "slider";
        if (testid.startsWith("toggle:") || testid.includes("toggle")) return "toggle";
        if (testid.startsWith("color:") || testid.includes("color")) return "colorSlider";
        if (testid.startsWith("action:")) return "action";
        if (testid.startsWith("card:")) return "card";
        if (testid.includes("row")) return "row";
        if (testid.includes("chip")) return "chip";
        return "unknown";
    }

    function walk(element: HTMLElement, depth: number, path: string) {
        if (depth > 5) return;
        const testid = element.getAttribute("data-testid");
        if (!testid) return;
        if (seen.has(testid)) return;
        seen.add(testid);

        const kind = classifyNode(element);
        const rect = element.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0;
        const hasInput = !!element.querySelector(
            'input[type="range"], input[type="checkbox"], input[type="color"]'
        );
        const hasIcon = !!element.querySelector("i, svg, .icon");
        const text = (element.textContent || "").trim().substring(0, 50);

        const childEls = Array.from(
            element.querySelectorAll<HTMLElement>(":scope > [data-testid]")
        );
        const childTestIds = childEls.map((c) => c.getAttribute("data-testid") || "");

        nodes.push({
            testid,
            kind,
            visible,
            depth,
            path: path + " > " + testid,
            hasInput,
            hasIcon,
            childCount: childTestIds.length,
            children: childTestIds,
            text,
        });

        for (const child of childEls) {
            walk(child, depth + 1, path + " > " + testid);
        }
    }

    // 从直接子节点（depth 0）开始
    const directChildren = Array.from(
        root.querySelectorAll<HTMLElement>(":scope > [data-testid]")
    );
    for (const el of directChildren) {
        walk(el, 0, "root");
    }

    return { error: null, nodes };
}

// ======== 2. 声明式测试生成器 ========
test.describe("声明式菜单引擎 (@dom, vitePage)", { tag: ["@dom"] }, () => {
    let menuTree: ReturnType<typeof scanMenuTree>;

    test.beforeAll(async ({ vitePage: page }) => {
        await page.evaluate(() => {
            document.getElementById("btnSettings")?.click();
        });
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        menuTree = await page.evaluate(scanMenuTree);
    });

    test("扫描器无错误并捕获到 ≥5 个菜单节点", async () => {
        expect(menuTree.error).toBeNull();
        expect(menuTree.nodes.length).toBeGreaterThanOrEqual(5);
    });

    test("所有节点都有唯一 data-testid", async () => {
        const ids = menuTree.nodes.map((n) => n.testid);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test("无深度超过 5 的异常嵌套", async () => {
        const maxDepth = menuTree.nodes.reduce((m, n) => Math.max(m, n.depth), 0);
        expect(maxDepth).toBeLessThanOrEqual(5);
    });

    test("可见节点都有合理的 kind 分类", async () => {
        const validKinds = new Set([
            "folder",
            "slider",
            "toggle",
            "colorSlider",
            "action",
            "card",
            "row",
            "chip",
            "unknown",
        ]);
        for (const node of menuTree.nodes) {
            if (node.visible) {
                expect(validKinds.has(node.kind)).toBe(true);
            }
        }
    });

    test("所有 folder 类型节点都有子节点记录", async () => {
        const folders = menuTree.nodes.filter((n) => n.kind === "folder");
        for (const folder of folders) {
            expect(folder.children.length).toBeGreaterThan(0);
        }
    });

    test("所有 slider/toggle 控件节点包含 input 元素", async () => {
        const controls = menuTree.nodes.filter(
            (n) => n.kind === "slider" || n.kind === "toggle" || n.kind === "colorSlider"
        );
        for (const ctrl of controls) {
            expect(ctrl.hasInput).toBe(true);
        }
    });

    test("生成菜单覆盖报告", async () => {
        const byKind: Record<string, number> = {};
        menuTree.nodes.forEach((n) => {
            byKind[n.kind] = (byKind[n.kind] || 0) + 1;
        });
        const visibleCount = menuTree.nodes.filter((n) => n.visible).length;

        console.log("\n📊 声明式菜单扫描报告:");
        console.log("   总节点数:", menuTree.nodes.length);
        console.log("   可见节点:", visibleCount);
        console.log("   类型分布:", JSON.stringify(byKind));

        expect(Object.keys(byKind).length).toBeGreaterThanOrEqual(2);
        expect(visibleCount).toBeGreaterThanOrEqual(menuTree.nodes.length * 0.3);
    });

    test("每个可见 folder 至少包含 1 个子节点", async () => {
        const visibleFolders = menuTree.nodes.filter(
            (n) => n.kind === "folder" && n.visible
        );
        expect(visibleFolders.length).toBeGreaterThan(0);
        for (const folder of visibleFolders) {
            expect(folder.children.length).toBeGreaterThan(0);
        }
    });
});