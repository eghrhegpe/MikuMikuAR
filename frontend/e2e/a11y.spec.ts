/**
 * ADR-153 Phase 3: E2E 无障碍 axe-core 扫描
 *
 * 扫描主界面的 a11y 违规，输出到控制台。
 * 首次运行基线偏高：先仅 critical 阻断 CI，serious 输出 warning，后续逐步收紧。
 * 注：当前仅覆盖主界面；子页面扫描留待后续扩展。
 */
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './wails-fixture';

test.describe('A11y — axe-core scan (@dom)', { tag: ['@dom'] }, () => {
    test('main page has no critical a11y violations', async ({ vitePage: page }) => {
        await page.waitForSelector('#renderCanvas', { timeout: 5000 });

        // vitePage fixture 的 overlay 守卫只移除 .mmd-dialog-visible，不会把 opacity:0
        // 的残留弹窗从可访问性树中隐藏；axe 会把它们当可见节点扫出虚假的 serious 违规。
        // 这里仅隐藏「非可见」弹窗，避免主界面扫描被隐藏弹窗污染。
        await page.evaluate(() => {
            for (const id of ['mmd-dialog-overlay', 'mmd-dialog-overlay-2']) {
                const overlay = document.getElementById(id);
                if (overlay && !overlay.classList.contains('mmd-dialog-visible')) {
                    overlay.style.visibility = 'hidden';
                }
            }
        });

        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
            .analyze();

        // critical 阻断 CI；serious 先 warn 不阻断，后续逐步收紧
        const violations = results.violations.filter(
            (v) => v.impact === 'critical' || v.impact === 'serious'
        );
        if (violations.length > 0) {
            console.warn(
                `[a11y] ${violations.length} critical/serious violation(s) found:\n` +
                violations.map((v) => `  - ${v.id}: ${v.help} (${v.nodes.length} nodes)`).join('\n')
            );
        }
        // 渐进式：先 expect 0 错误，基线建立后收紧
        expect(violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
    });
});