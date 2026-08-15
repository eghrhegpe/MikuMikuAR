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
    // 用元素身份去重，而不是 testid 字符串：相同 testid 的多个 DOM 节点
    // 都必须进入 nodes，唯一性断言才能真正发现重复。
    const seenElements = new Set<HTMLElement>();
    const nodes: MenuNodeSnapshot[] = [];

    // 基于 CSS class 名 + testid 前缀的复合分类器
    function classifyNode(el: HTMLElement, testid: string): string {
        const cls = el.className || "";
        // 语义优先级：声明式 folder id > CSS 外观类。
        // .slide-item 是通用菜单行（folder/action/选择项），不是 tab。
        if (testid.startsWith("folder:")) return "folder";
        if (cls.includes("collapsible-wrapper")) return "folder";
        if (cls.includes("schema-custom")) return "custom";
        if (cls.includes("type-row")) {
            // 真正的 tab 栏（diagnostic）按钮带 role=tab；modeRow 的 .mode-btn 不带。
            if (el.querySelector('[role="tab"]')) return "tab";
            return "modeRow";
        }
        if (cls.includes("slide-item")) return "nav";
        if (cls.includes("vec3-block")) return "vec3";
        if (cls.includes("clr-block")) return "colorSlider";
        if (cls.includes("cs-row")) {
            // modeSlider 的 cs-top 带 role=slider；普通 slider 的 role 在 cs-bar 上。
            if (el.querySelector('.cs-top[role="slider"]')) return "modeSlider";
            return "slider";
        }
        if (cls.includes("toggle-row") || cls.includes("tr-row")) return "toggle";
        if (cls.includes("diag-control-undo-row")) return "action";
        if (cls.includes("diag-pending-card")) return "card";
        // 后备：testid 前缀匹配（PopupRow 自动推导的 rowKey）
        if (testid.startsWith("slider:")) return "slider";
        if (testid.startsWith("toggle:")) return "toggle";
        if (testid.startsWith("color:")) return "colorSlider";
        if (testid.startsWith("action:")) return "action";
        if (testid.startsWith("tab:")) return "tab";
        return "unknown";
    }

    function findDirectChildren(element: HTMLElement): HTMLElement[] {
        const allDescendants = Array.from(
            element.querySelectorAll<HTMLElement>("[data-testid]")
        );
        const result: HTMLElement[] = [];
        for (const child of allDescendants) {
            // 向上找最近的 testid 祖先
            let ancestor: HTMLElement | null = child.parentElement;
            let isDirect = true;
            while (ancestor && ancestor !== element) {
                if (ancestor.hasAttribute("data-testid")) {
                    isDirect = false;
                    break;
                }
                ancestor = ancestor.parentElement;
            }
            if (isDirect) {
                result.push(child);
            }
        }
        return result;
    }

    function walk(element: HTMLElement, depth: number, path: string) {
        // 不提前剪枝：depth>5 的节点也必须记录，否则“深度 ≤5”断言永远查不到越深节点。
        const testid = element.getAttribute("data-testid");
        if (!testid) return;
        if (seenElements.has(element)) return;
        seenElements.add(element);

        const kind = classifyNode(element, testid);
        const rect = element.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0;
        const hasInput = !!element.querySelector(
            'input[type="range"], input[type="checkbox"], input[type="color"]'
        );
        const hasIcon = !!element.querySelector("i, svg, .icon");
        const text = (element.textContent || "").trim().substring(0, 50);

        const childEls = findDirectChildren(element);
        const childIds = childEls.map((c) => c.getAttribute("data-testid") || "");

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

        for (const childEl of childEls) {
            walk(childEl, depth + 1, path + " > " + testid);
        }
    }

    // 只扫描当前可见 overlay/wrapper 内的 testid：隐藏 wrapper（display:none）
    // 里可能残留其它面板的节点，同一 testid 在不同面板重复但同一时刻只开一个时不应算冲突。
    const allEls = Array.from(
        document.querySelectorAll<HTMLElement>("#sceneOverlay [data-testid]")
    ).filter((el) => {
        const wrapper = el.closest<HTMLElement>(".menu-wrapper");
        return !wrapper || wrapper.style.display !== "none";
    });
    const topLevelEls = allEls.filter((el) => {
        let ancestor = el.parentElement;
        while (ancestor && ancestor.id !== "sceneOverlay") {
            if (ancestor.hasAttribute("data-testid")) return false;
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
        // 等菜单树挂载完成（≥8 个 testid 节点），替代固定 sleep——慢 CI 上也稳定
        await page.waitForFunction(
            () => document.querySelectorAll("#sceneOverlay [data-testid]").length >= 8,
            { timeout: 5000 }
        );
        return (await page.evaluate(scanMenuTree)).nodes;
    }

    test("设置面板扫描：捕获 ≥8 个节点，结构契约完整（唯一 id / 深度 ≤5）", async ({ vitePage: page }) => {
        const menuTree = await scanSettingsMenu(page);

        // 基本断言
        expect(menuTree.length, "应捕获到 ≥8 个菜单节点").toBeGreaterThanOrEqual(8);

        // 分类应覆盖 settings 根层 folder 类型（旧 .slide-item 不再是“tab”）
        const kinds = new Set(menuTree.map((n) => n.kind));
        expect(kinds.has("folder"), "应至少存在 folder 类型节点").toBe(true);

        // 结构契约：所有节点 testid 唯一（扫描器按元素去重，重复 testid 不会被吞掉）
        const ids = menuTree.map((n) => n.testid);
        expect(new Set(ids).size).toBe(ids.length);

        // 结构契约：嵌套深度 ≤ 5（扫描器不再提前剪枝，越深节点也会被记录）
        const maxDepth = menuTree.reduce((m, n) => Math.max(m, n.depth), 0);
        expect(maxDepth).toBeLessThanOrEqual(5);

        // 结构契约：若存在真实 tab 栏（diagnostic 的 role=tab），它应是叶子导航项
        const tabs = menuTree.filter((n) => n.kind === "tab");
        for (const tab of tabs) {
            expect(tab.childCount, `Tab ${tab.testid} 不应包含子节点`).toBe(0);
        }

        // 打印报告
        console.log("\n📊 菜单扫描报告（Folder 层）:");
        menuTree.forEach((n) => {
            console.log(`  [${n.kind}] ${n.testid} class="${n.className.substring(0, 40)}" children=${n.childCount}`);
        });
    });

    test("设置子页导航：点击导航项后页面不崩溃，新内容加载", async ({ vitePage: page }) => {
        const menuTree = await scanSettingsMenu(page);
        const navItems = menuTree.filter((n) => n.kind === "folder" || n.kind === "nav");
        expect(navItems.length, "应存在可点击导航项").toBeGreaterThan(0);

        const firstNav = navItems[0];
        // 记录当前 URL
        const urlBefore = page.url();

        // 点击导航项（真实 locator.click）
        await page.getByTestId(firstNav.testid).click();

        // 验证点击后内容切换：等待 overlay 内 data-testid 集合发生变化。
        // 不假设“数量一定增加”——有的子页 testid 数量可能少于根层（如外观页），
        // 有的可能刚好相等；集合变化仍能证明根层已被替换/新内容已挂载。
        const testidSetBefore = await page.evaluate(() =>
            Array.from(document.querySelectorAll("#sceneOverlay [data-testid]"))
                .map((el) => el.getAttribute("data-testid") || "")
                .sort()
                .join("|")
        );
        await page.waitForFunction(
            (before) => {
                const now = Array.from(document.querySelectorAll("#sceneOverlay [data-testid]"))
                    .map((el) => el.getAttribute("data-testid") || "")
                    .sort()
                    .join("|");
                return now !== before;
            },
            testidSetBefore,
            { timeout: 5000 }
        );

        // 可选：检查 URL 是否变化（SPA 路由）
        const urlAfter = page.url();
        console.log(`  Nav ${firstNav.testid}: URL ${urlBefore} → ${urlAfter}`);
    });
});
