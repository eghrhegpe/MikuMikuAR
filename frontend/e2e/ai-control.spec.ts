import { test, expect } from "./wails-fixture";
import { openSettingsPanel } from "./helpers";

test.describe("AI 控制模式 (@dom)", { tag: ["@dom", "@overlay"] }, () => {
    test.beforeEach(async ({ vitePage: page }) => {
        await openSettingsPanel(page);
        await page.getByTestId("folder:settings:diagnostic").click();
    });

    test("诊断面板: 模式切换 tab 可见", async ({ vitePage: page }) => {
        await expect(page.getByTestId("diagnostic:mode-switch")).toBeVisible();
        await expect(page.getByRole("tab", { name: /诊断/i })).toHaveAttribute(
            "aria-selected",
            "true"
        );
    });

    test("控制模式: 切换到控制模式后显示待执行操作区", async ({ vitePage: page }) => {
        await expect(page.getByTestId("diagnostic:mode-switch")).toBeVisible();
        await page.getByRole("tab", { name: /控制/i }).click();
        // Pending action area exists in DOM (hidden until an action is parsed)
        await expect(page.getByTestId("ai:control:pending-action")).toBeAttached();
    });

    test("控制模式: 输入非法动作后提示暂不支持", async ({ vitePage: page }) => {
        await page.getByRole("tab", { name: /控制/i }).click();

        const textarea = page.locator("textarea");
        await expect(textarea).toBeVisible();
        await textarea.fill("删除所有文件");
        await page.getByRole("button", { name: /发送/i }).click();

        await expect(page.getByText(/暂不支持/i)).toBeVisible({ timeout: 15000 });
    });
});
