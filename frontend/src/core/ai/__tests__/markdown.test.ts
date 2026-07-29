// markdown 渲染器测试 —— 解析正确性 + XSS 安全（纯 DOM 构建，无 innerHTML）。

import { describe, it, expect, beforeEach } from 'vitest';
import { renderMarkdownInto } from '../markdown';

describe('renderMarkdownInto', () => {
    let container: HTMLElement;
    beforeEach(() => {
        container = document.createElement('div');
    });

    it('裁剪首尾空行，段落渲染为 p', () => {
        renderMarkdownInto(container, '\n\n你好\n\n');
        const ps = container.querySelectorAll('p.md-paragraph');
        expect(ps.length).toBe(1);
        expect(ps[0].textContent).toBe('你好');
    });

    it('加粗/斜体/行内代码', () => {
        renderMarkdownInto(container, '这是 **粗** 和 *斜* 和 `code`');
        expect(container.querySelector('strong')?.textContent).toBe('粗');
        expect(container.querySelector('em')?.textContent).toBe('斜');
        expect(container.querySelector('code.md-code-inline')?.textContent).toBe('code');
    });

    it('标题按级别渲染 h1-h6', () => {
        renderMarkdownInto(container, '# 一级\n### 三级');
        expect(container.querySelector('h1.md-heading')?.textContent).toBe('一级');
        expect(container.querySelector('h3.md-heading')?.textContent).toBe('三级');
    });

    it('无序列表', () => {
        renderMarkdownInto(container, '- a\n- b\n- c');
        const items = container.querySelectorAll('ul.md-list > li');
        expect(items.length).toBe(3);
        expect(items[1].textContent).toBe('b');
    });

    it('有序列表', () => {
        renderMarkdownInto(container, '1. 第一\n2. 第二');
        const ol = container.querySelector('ol.md-list');
        expect(ol?.querySelectorAll('li').length).toBe(2);
    });

    it('代码块', () => {
        renderMarkdownInto(container, '```\nconst x = 1;\n```');
        const pre = container.querySelector('pre.md-code-block code');
        expect(pre?.textContent).toBe('const x = 1;');
    });

    it('XSS 安全：script/标签作为纯文本，不生成脚本节点', () => {
        renderMarkdownInto(container, '正常 <script>alert(1)</script> 文本 <img src=x onerror=alert(1)>');
        // 纯 DOM 构建 + textContent：不会解析出 script/img 元素
        expect(container.querySelector('script')).toBeNull();
        expect(container.querySelector('img')).toBeNull();
        // 原文本保留可见
        expect(container.textContent).toContain('<script>alert(1)</script>');
    });

    it('列表后接段落正确闭合', () => {
        renderMarkdownInto(container, '- item\n\n后续段落');
        expect(container.querySelector('ul.md-list')).not.toBeNull();
        const ps = container.querySelectorAll('p.md-paragraph');
        expect(ps.length).toBe(1);
        expect(ps[0].textContent).toBe('后续段落');
    });
});
