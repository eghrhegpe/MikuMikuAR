import { test, expect } from './wails-fixture';
import { openSettingsPanel } from './helpers';

test.describe('AI 控制模式 (@dom)', { tag: ['@dom', '@overlay'] }, () => {
    test.beforeEach(async ({ vitePage: page }) => {
        await openSettingsPanel(page);
        await page.getByTestId('folder:settings:diagnostic').click();
    });

    test('诊断面板: 页签栏可见且默认对话页签选中', async ({ vitePage: page }) => {
        await expect(page.getByTestId('diagnostic:mode-switch')).toBeVisible();
        await expect(page.getByRole('tab', { name: /对话/i })).toHaveAttribute(
            'aria-selected',
            'true'
        );
    });

    test('AI 面板: 待执行操作区挂载在 DOM', async ({ vitePage: page }) => {
        await expect(page.getByTestId('diagnostic:mode-switch')).toBeVisible();
        // 统一 AI 助手模式（ADR-196）下 pending 区始终渲染在 chat schema 中，
        // 隐藏直到有动作解析出来；这里验证稳定 testid 已挂载。
        await expect(page.getByTestId('ai:control:pending-action')).toBeAttached();
    });

    test('AI 面板: 非法动作提示暂不支持（mock SSE）', async ({ vitePage: page }) => {
        // 用 Playwright route 模拟 OpenAI 兼容流式响应：模型返回一个未知工具调用，
        // 避免 e2e 依赖真实 LLM/网络，让“非法动作 → 暂不支持”链路可重复验证。
        await page.route('**/v1/chat/completions', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: [
                    'data: {"choices":[{"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_unknown","function":{"name":"ai:control:delete-all-files","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}',
                    '',
                    'data: [DONE]',
                    '',
                ].join('\n'),
            })
        );

        const textarea = page.locator('textarea');
        await expect(textarea).toBeVisible();
        await textarea.fill('删除所有文件');
        await page.getByRole('button', { name: /发送/i }).click();

        await expect(page.getByText(/暂不支持/i)).toBeVisible({ timeout: 15000 });
    });
});
