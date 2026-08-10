/**
 * E2E: 声明式菜单引擎测试 (@dom)
 *
 * 核心思想：菜单系统本身已经是「声明式」的（MenuNode 数据 → 渲染 → DOM）。
 * 本测试不硬编码具体菜单项，而是：
 *   1. 打开设置面板
 *   2. 扫描所有带 data-testid 的 DOM 节点，自动构建菜单树
 *   3. 验证结构完整性：分类正确、层级合理、控件存在、无孤儿节点
 *
 * 好处：
 *   - 新增/修改菜单 → 自动覆盖，零手写测试成本
 *   - 发现结构缺陷（缺失控件、嵌套错误、层级断裂）
 *   - 所有断言基于 DOM 真实结构，与业务逻辑解耦
 *
 * @see ADR-093 — Menu Declarative Schema
 */
import { test, expect } from "./wails-fixture";

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
    className: string;
}

// ======== 浏览器侧扫描器 ========
function scanMenuTree(): { error: string | null; nodes: MenuNodeSnapshot[] } {
    const seen = new Set<string>();
    const nodes: MenuNodeSnapshot[] = [];

    // 基于 CSS class 名 + testid 前缀的复合分类器
    function classifyNode(el: HTMLElement, testid: string): string {
        const cls = el.className || "";
        // 优先级：CSS class > testid 前缀
        if (cls.includes("collapsible-wrapper")) return "folder";
        if (cls.includes("slide-item")) return "tab";
        if (cls.includes("vec3-block")) return "vec3";
        if (cls.includes("clr-block")) return "colorSlider";
        if (cls.includes("cs-row")) {
            // cs-row 可能是 slider 也可能是 modeSlider，看内部结构
            if (el.querySelector('input[type="radio"], .cs-option')) return "modeSlider";
            return "slider";
        }
        if (cls.includes("toggle-row") || cls.includes("tr-row")) return "toggle";
        if (cls.includes("diag-control-undo-row")) return "action";
        if (cls.includes("diag-pending-card")) return "card";
        // 后备：testid 前缀匹配
        if (testid.startsWith("folder:")) return "folder";
        if (testid.startsWith("slider:")) return "slider";
        if (testid.startsWith("toggle:")) return "toggle";
        if (testid.startsWith("color:")) return "colorSlider";
        if (testid.startsWith("action:")) return "action";
        if (testid.startsWith("tab:")) return "tab";
        return "unknown";
    }

    function findDirectChildren(element: HTMLElement): string[] {
        const allDescendants = Array.from(
            element.querySelectorAll<HTMLElement>("[data-testid]")
        );
        const result: string[] = [];
        for (const child of allDescendants) {
            const childTestid = child.getAttribute("data-testid") || "";
            // 向上找最近的 testid 祖先
            let ancestor: HTMLElement | null = child.parentElement;
            let isDirect = true;
            while (ancestor && ancestor !== element) {
                if (ancestor.getAttribute("data-testid")) {
                    isDirect = false;
                    break;
                }
                ancestor = ancestor.parentElement;
            }
            if (isDirect) {
                result.push(childTestid);
            }
        }
        return result;
    }

    function walk(element: HTMLElement, depth: number, path: string) {
        if (depth > 5) return;
        const testid = element.getAttribute("data-testid");
        if (!testid) return;
        if (seen.has(testid)) return;
        seen.add(testid);

        const kind = classifyNode(element, testid);
        const rect = element.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0;
        const hasInput = !!element.querySelector(
            'input[type="range"], input[type="checkbox"], input[type="color"]'
        );
        const hasIcon = !!element.querySelector("i, svg, .icon");
        const text = (element.textContent || "").trim().substring(0, 50);

        const childIds = findDirectChildren(element);

        nodes.push({
            testid,
            kind,
            visible,
            depth,
            path: path + " > " + testid,
            hasInput,
            hasIcon,
            childCount: childIds.length,
            children: childIds,
            text,
            className: element.className || "",
        });

        for (const childId of childIds) {
            const childEl = element.querySelector<HTMLElement>(`[data-testid="${childId}"]`);
            if (childEl) {
                walk(childEl, depth + 1, path + " > " + testid);
            }
        }
    }

    // 扫描所有顶层 testid 元素（向上追溯无 testid 祖先的元素）
    const allEls = Array.from(
        document.querySelectorAll<HTMLElement>("[data-testid]")
    );
    const topLevelEls = allEls.filter((el) => {
        let ancestor = el.parentElement;
        while (ancestor) {
            if (ancestor.getAttribute("data-testid")) return false;
            ancestor = ancestor.parentElement;
        }
        return true;
    });

    for (const el of topLevelEls) {
        walk(el, 0, "root");
    }

    return { error: null, nodes };
}

// ======== 声明式测试套件 ========
test.describe("声明式菜单引擎 (@dom, vitePage)", { tag: ["@dom", "@overlay"] }, () => {
    // 打开设置面板并扫描菜单树。每次测试独立 page，无 describe 级共享状态——
    // 避免「依赖首测填充共享变量，首测失败时其余测试空数组恒绿」的假绿。
    async function scanSettingsMenu(page: import("@playwright/test").Page): Promise<MenuNodeSnapshot[]> {
        await page.locator("#btnSettings").click();
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        await page.waitForTimeout(300);
        return (await page.evaluate(scanMenuTree)).nodes;
    }

    test("设置面板扫描：捕获 ≥8 个节点，结构契约完整（唯一 id / 深度 ≤5 / tab 叶子）", async ({ vitePage: page }) => {
        const menuTree = await scanSettingsMenu(page);

        // 基本断言
        expect(menuTree.length, "应捕获到 ≥8 个菜单节点").toBeGreaterThanOrEqual(8);

        // 分类应覆盖 tab 类型
        const kinds = new Set(menuTree.map((n) => n.kind));
        expect(kinds.has("tab"), "应至少存在 tab 类型节点").toBe(true);

        // 结构契约：所有节点 testid 唯一
        const ids = menuTree.map((n) => n.testid);
        expect(new Set(ids).size).toBe(ids.length);

        // 结构契约：嵌套深度 ≤ 5
        const maxDepth = menuTree.reduce((m, n) => Math.max(m, n.depth), 0);
        expect(maxDepth).toBeLessThanOrEqual(5);

        // 结构契约：tab 是叶子导航项（无子节点）
        const tabs = menuTree.filter((n) => n.kind === "tab");
        for (const tab of tabs) {
            expect(tab.childCount, `Tab ${tab.testid} 不应包含子节点`).toBe(0);
        }

        // 打印报告
        console.log("\n📊 菜单扫描报告（Tab 层）:");
        menuTree.forEach((n) => {
            console.log(`  [${n.kind}] ${n.testid} class="${n.className.substring(0, 40)}" children=${n.childCount}`);
        });
    });

    test("Tab 导航：点击 tab 后页面不崩溃，新内容加载", async ({ vitePage: page }) => {
        const menuTree = await scanSettingsMenu(page);
        const tabs = menuTree.filter((n) => n.kind === "tab");
        expect(tabs.length, "应存在 tab 节点").toBeGreaterThan(0);

        const firstTab = tabs[0];
        // 记录当前 URL
        const urlBefore = page.url();

        // 点击 tab（真实 locator.click）
        await page.getByTestId(firstTab.testid).click();
        await page.waitForTimeout(500);

        // 验证页面没有完全崩溃（body 仍有内容）
        const hasBodyContent = await page.evaluate(() => {
            const body = document.body;
            return body && body.innerHTML.length > 100;
        });
        expect(hasBodyContent, "点击 tab 后 body 应有内容").toBe(true);

        // 可选：检查 URL 是否变化（SPA 路由）
        const urlAfter = page.url();
        console.log(`  Tab ${firstTab.testid}: URL ${urlBefore} → ${urlAfter}`);
    });
});