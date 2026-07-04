// [doc:architecture] Scene Prop Levels — 舞台道具弹窗层级
// 从 env-prop-levels.ts 迁移至舞台域

import { cardContainer, escapeHtml, propRegistry } from '../core/config';
import type { PopupLevel } from '../core/config';
import { createIconifyIcon } from '../core/icons';
import { slideRow, addSliderRow, addToggleRow } from '../core/ui-helpers';
import { loadProp, removeProp, setPropTransform, getPropList } from '../scene/scene';
import { SelectPMXFile } from '../core/wails-bindings';
import { getSceneMenu } from './scene-menu';

export function buildPropLevel(): PopupLevel {
    return {
        label: '道具',
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');
            container.style.padding = '0';
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:plus', '添加道具文件', false, () => {
                    SelectPMXFile().then((path) => {
                        if (path) {
                            loadProp(path).then(() => getSceneMenu()?.reRender()).catch(() => {});
                        }
                    });
                });
            });
            const props = getPropList();
            if (props.length > 0) {
                cardContainer(container, (c) => {
                    for (const p of props) {
                        const row = document.createElement('div');
                        row.className = 'slide-item';
                        row.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:box"></iconify-icon></span><span class="slide-label">${escapeHtml(p.name)}</span><span class="slide-arrow">&gt;</span>`;
                        row.addEventListener('click', () => getSceneMenu()?.push(buildPropDetailLevel(p.id)));
                        const delBtn = document.createElement('span');
                        delBtn.className = 'slide-del-btn';
                        delBtn.textContent = '×';
                        delBtn.title = '删除道具';
                        delBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            removeProp(p.id);
                            getSceneMenu()?.reRender();
                        });
                        row.appendChild(delBtn);
                        c.appendChild(row);
                    }
                });
            } else {
                cardContainer(container, (c) => {
                    const empty = document.createElement('div');
                    empty.style.cssText = 'font-size:11px;color:var(--text-dim);padding:8px 4px;text-align:center;';
                    empty.textContent = '暂无道具，点击上方添加';
                    c.appendChild(empty);
                });
            }
        },
    };
}

export function buildPropDetailLevel(propId: string): PopupLevel {
    const PROP_SLIDER_PARAMS: {
        label: string;
        getValue: (p: import('../core/config').PropInstance) => number;
        min: number; max: number; step: number; icon: string;
        setValue: (p: import('../core/config').PropInstance, v: number) => void;
    }[] = [
        {
            label: '位置 X', getValue: (p) => p.position[0], min: -50, max: 50, step: 0.5, icon: 'lucide:move-horizontal',
            setValue: (p, v) => { p.position[0] = v; setPropTransform(propId, { position: [v, p.position[1], p.position[2]] }); },
        },
        {
            label: '位置 Y', getValue: (p) => p.position[1], min: -50, max: 50, step: 0.5, icon: 'lucide:move-vertical',
            setValue: (p, v) => { p.position[1] = v; setPropTransform(propId, { position: [p.position[0], v, p.position[2]] }); },
        },
        {
            label: '位置 Z', getValue: (p) => p.position[2], min: -50, max: 50, step: 0.5, icon: 'lucide:move',
            setValue: (p, v) => { p.position[2] = v; setPropTransform(propId, { position: [p.position[0], p.position[1], v] }); },
        },
        {
            label: '旋转 Y', getValue: (p) => p.rotationY, min: -Math.PI, max: Math.PI, step: 0.1, icon: 'lucide:rotate-cw',
            setValue: (p, v) => { p.rotationY = v; setPropTransform(propId, { rotationY: v }); },
        },
        {
            label: '缩放', getValue: (p) => p.scaling, min: 0.1, max: 10, step: 0.1, icon: 'lucide:maximize',
            setValue: (p, v) => { p.scaling = v; setPropTransform(propId, { scaling: v }); },
        },
    ];

    return {
        label: '道具变换',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const p = propRegistry.get(propId);
            if (!p) {
                const empty = document.createElement('div');
                empty.style.cssText = 'font-size:11px;color:var(--text-dim);padding:8px 4px;';
                empty.textContent = '道具不存在（可能已被删除）';
                container.appendChild(empty);
                return;
            }
            cardContainer(container, (c) => {
                const title = document.createElement('div');
                title.style.cssText = 'font-size:12px;color:var(--text);padding:8px 14px 4px;font-weight:600;';
                title.textContent = p.name;
                c.appendChild(title);
                PROP_SLIDER_PARAMS.forEach((param) => {
                    addSliderRow(c, param.label, param.getValue(p), param.min, param.max, param.step, (v) => { param.setValue(p, v); }, param.icon);
                });
                addToggleRow(c, '可见', p.visible, (v) => { setPropTransform(propId, { visible: v }); p.visible = v; });
                const delBtn = document.createElement('button');
                delBtn.textContent = '删除道具';
                delBtn.className = 'btn btn-sm btn-danger';
                delBtn.style.cssText = 'width:calc(100% - 28px);margin:10px 14px 6px;';
                delBtn.addEventListener('click', () => {
                    removeProp(propId);
                    const menu = getSceneMenu();
                    if (menu) { menu.pop(); menu.reRender(); }
                });
                c.appendChild(delBtn);
            });
        },
    };
}
