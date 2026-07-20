// plaza-thumbnail.ts — 模型广场：纯 UI 辅助函数
// 从 plaza-browser.ts 拆出

// ======== 按钮工厂 ========

export function _plazaBtn(html: string, onClick: () => void, className = 'plaza-btn', title?: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = className;
    btn.innerHTML = html;
    btn.onclick = onClick;
    if (title) btn.title = title;
    return btn;
}

// ======== 节头部 ========

export function _plazaSectionHeader(titleHtml: string, ...actions: HTMLElement[]): HTMLDivElement {
    const header = document.createElement('div');
    header.className = 'plaza-section-header';
    const title = document.createElement('div');
    title.className = 'plaza-section-title';
    title.innerHTML = titleHtml;
    header.appendChild(title);
    if (actions.length > 0) {
        const actionBar = document.createElement('div');
        actionBar.className = 'plaza-section-actions';
        for (const a of actions) actionBar.appendChild(a);
        header.appendChild(actionBar);
    }
    return header;
}
