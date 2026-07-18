/**
 * E2E DOM-only test for the Environment → Cloud (体积云) panel.
 *
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 * Cloud panel is a flat level (no sub-folders) with section-title dividers
 * and slider controls for volumetric cloud parameters (Ray-Marching).
 *
 * @see env-feature-levels.ts — buildCloudLevel()
 */
import { test, expect } from "./wails-fixture";
import { openEnvPanel } from "./helpers";

test.describe("Environment — Cloud Panel (vitePage, @dom)", { tag: ["@dom"] }, () => {
    test.beforeEach(async ({ vitePage: page }) => {
        await openEnvPanel(page);
        // Navigate into the 云 sub-level (folder in env root)
        await page.getByTestId("folder:env:cloud").click();
    });

    test("体积云面板: 核心参数滑块渲染", async ({ vitePage: page }) => {
        // 核心控制滑块（稳定 data-testid，env-feature-levels.ts buildCloudLevel）
        await expect(page.getByTestId("env:cloud:cover")).toBeVisible();
        await expect(page.getByTestId("env:cloud:gap")).toBeVisible();
        await expect(page.getByTestId("env:cloud:height")).toBeVisible();
        await expect(page.getByTestId("env:cloud:scale")).toBeVisible();
        await expect(page.getByTestId("env:cloud:thickness")).toBeVisible();
        await expect(page.getByTestId("env:cloud:visibility")).toBeVisible();
    });

    test("体积云面板: 区段标题与光照参数", async ({ vitePage: page }) => {
        // 区段标题行（sectionTitle，非可交互控件）
        await expect(page.getByTestId("env:cloud:sectionDetail")).toBeVisible();
        await expect(page.getByTestId("env:cloud:sectionLighting")).toBeVisible();

        // 光照区段滑块（env:cloud:backlight / env:cloud:powder）
        await expect(page.getByTestId("env:cloud:erosion")).toBeVisible();
        await expect(page.getByTestId("env:cloud:weather")).toBeVisible();
        await expect(page.getByTestId("env:cloud:backlight")).toBeVisible();
        await expect(page.getByTestId("env:cloud:powder")).toBeVisible();
    });
});
