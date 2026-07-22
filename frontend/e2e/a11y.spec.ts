/**
 * ADR-153 Phase 3: E2E 无障碍 axe-core 扫描
 *
 * 扫描主界面 + 各子页面的 a11y 违规，输出到控制台。
 * 首次运行基线偏高，先设为 warning 级别（不阻断 CI），后续逐步收紧。
 */
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './wails-fixture';

test.describe('A11y — axe-core scan (@dom)', { tag: ['@dom'] }, () => {
    test('main page has no critical a11y violations', async ({ vitePage: page }) => {
        await page.waitForSelector('#renderCanvas', { timeout: 5000 });

        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
            .analyze();

        // 先只报告 critical/serious 违规，不阻断 CI
        const violations = results.violations.filter(
            (v) => v.impact === 'critical' || v.impact === 'serious'
        );
        if (violations.length > 0) {
            console.warn(
                `[a11y] ${violations.length} serious violations found:\n` +
                violations.map((v) => `  - ${v.id}: ${v.help} (${v.nodes.length} nodes)`).join('\n')
            );
        }
        // 渐进式：先 expect 0 错误，基线建立后收紧
        expect(violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
    });
});