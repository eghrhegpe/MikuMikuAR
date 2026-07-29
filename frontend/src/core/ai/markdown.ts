// 轻量 Markdown → DOM 渲染器（诊断助手对话专用）。
//
// 设计取舍：
// - 纯 DOM 构建（createElement + textContent），不用 innerHTML 拼字符串，从根上免疫 XSS，
//   无需引入 marked/dompurify 等重依赖与供应链面。
// - 只覆盖 LLM 回复常用的 Markdown 子集：标题(#)、加粗(**)、斜体(*/_)、行内代码(`)、
//   代码块(```)、无序列表(-/*/+)、有序列表(1.)、水平线(---)、段落与换行。
// - 不支持链接/图片/表格等（诊断场景用不到；如需再增量扩展）。

/** 行内解析：把一行文本按 `**bold** *italic* `code`` 拆成 DOM 节点数组。 */
function renderInline(text: string): Node[] {
    const nodes: Node[] = [];
    // 依次匹配：行内代码 > 加粗 > 斜体。用单一正则交替，保序处理。
    const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (m.index > lastIndex) {
            nodes.push(document.createTextNode(text.slice(lastIndex, m.index)));
        }
        const token = m[0];
        if (token.startsWith('`')) {
            const code = document.createElement('code');
            code.className = 'md-code-inline';
            code.textContent = token.slice(1, -1);
            nodes.push(code);
        } else if (token.startsWith('**')) {
            const strong = document.createElement('strong');
            strong.textContent = token.slice(2, -2);
            nodes.push(strong);
        } else {
            // *italic* 或 _italic_
            const em = document.createElement('em');
            em.textContent = token.slice(1, -1);
            nodes.push(em);
        }
        lastIndex = m.index + token.length;
    }
    if (lastIndex < text.length) {
        nodes.push(document.createTextNode(text.slice(lastIndex)));
    }
    return nodes;
}

function appendInline(el: HTMLElement, text: string): void {
    for (const node of renderInline(text)) {
        el.appendChild(node);
    }
}

/**
 * 把 Markdown 文本渲染为 DOM 片段，追加进目标容器。
 * container 会被清空后重建，供流式结束时一次性定格渲染（避免逐字符重排闪烁）。
 */
export function renderMarkdownInto(container: HTMLElement, markdown: string): void {
    container.textContent = '';
    // 先做首尾空白裁剪，消除 LLM 常在正文前后附带的空行。
    const lines = markdown.replace(/\r\n/g, '\n').trim().split('\n');

    let i = 0;
    let listEl: HTMLUListElement | HTMLOListElement | null = null;

    const closeList = (): void => {
        if (listEl) {
            container.appendChild(listEl);
            listEl = null;
        }
    };

    while (i < lines.length) {
        const line = lines[i];

        // 代码块 ```
        if (line.trimStart().startsWith('```')) {
            closeList();
            const codeLines: string[] = [];
            i++;
            while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
                codeLines.push(lines[i]);
                i++;
            }
            i++; // 跳过结束 ```
            const pre = document.createElement('pre');
            pre.className = 'md-code-block';
            const code = document.createElement('code');
            code.textContent = codeLines.join('\n');
            pre.appendChild(code);
            container.appendChild(pre);
            continue;
        }

        // 空行：段落分隔
        if (line.trim() === '') {
            closeList();
            i++;
            continue;
        }

        // 水平线
        if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
            closeList();
            container.appendChild(document.createElement('hr'));
            i++;
            continue;
        }

        // 标题 #..######
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
            closeList();
            const level = heading[1].length;
            const h = document.createElement(`h${level}`);
            h.className = 'md-heading';
            appendInline(h, heading[2]);
            container.appendChild(h);
            i++;
            continue;
        }

        // 无序列表 - * +
        const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
        if (ul) {
            if (!listEl || listEl.tagName !== 'UL') {
                closeList();
                listEl = document.createElement('ul');
                listEl.className = 'md-list';
            }
            const li = document.createElement('li');
            appendInline(li, ul[1]);
            listEl.appendChild(li);
            i++;
            continue;
        }

        // 有序列表 1. 2.
        const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
        if (ol) {
            if (!listEl || listEl.tagName !== 'OL') {
                closeList();
                listEl = document.createElement('ol');
                listEl.className = 'md-list';
            }
            const li = document.createElement('li');
            appendInline(li, ol[1]);
            listEl.appendChild(li);
            i++;
            continue;
        }

        // 普通段落：合并连续非空、非特殊行为一个 <p>，行内以 <br> 连接。
        closeList();
        const p = document.createElement('p');
        p.className = 'md-paragraph';
        let first = true;
        while (i < lines.length) {
            const cur = lines[i];
            if (
                cur.trim() === '' ||
                cur.trimStart().startsWith('```') ||
                /^(#{1,6})\s+/.test(cur) ||
                /^\s*[-*+]\s+/.test(cur) ||
                /^\s*\d+\.\s+/.test(cur) ||
                /^\s*(---|\*\*\*|___)\s*$/.test(cur)
            ) {
                break;
            }
            if (!first) {
                p.appendChild(document.createElement('br'));
            }
            appendInline(p, cur);
            first = false;
            i++;
        }
        container.appendChild(p);
    }
    closeList();
}
