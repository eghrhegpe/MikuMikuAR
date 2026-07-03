// [doc:architecture] Motion Dance Sets — 舞蹈套装弹窗层级
// 从 motion-popup.ts 拆分

import { cardContainer, stackRegistry, setStatus, escapeHtml } from '../core/config';
import type { PopupLevel, PopupRow } from '../core/config';
import { createIconifyIcon } from '../core/icons';
import {
    SelectVMDMotion, SelectAudioFile, GetDanceSets, DeleteDanceSet, ImportDanceSet,
} from '../core/wails-bindings';
import { loadAudioFile, setAudioOffset } from '../outfit/audio';
import { showConfirm, showPrompt } from '../core/dialog';
import { loadVMDFromPath, focusModel } from '../scene/scene';
import { closeAllOverlays } from '../core/config';

// ======== Dance Set Types & State ========

export type DanceSet = {
    name: string;
    vmd_path: string;
    audio_path: string;
    audio_offset: number;
    description: string;
    thumbnail: string;
    source: string;
};

let danceSets: DanceSet[] = [];

function computeDanceSetId(ds: DanceSet): string {
    return sha256Hex(ds.vmd_path + ':' + ds.audio_path).substring(0, 16);
}

function sha256Hex(s: string): string {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        const char = s.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
    }
    return (
        Math.abs(hash).toString(16).padStart(16, '0') +
        Math.abs(hash * 7).toString(16).padStart(16, '0')
    );
}

export async function loadDanceSets(): Promise<void> {
    try {
        const sets = await GetDanceSets();
        danceSets = sets || [];
    } catch (err) {
        console.warn('loadDanceSets:', err);
        danceSets = [];
    }
}

async function loadDanceSetAudio(ds: DanceSet): Promise<void> {
    if (!ds.audio_path) return;
    try {
        await loadAudioFile(ds.audio_path);
        setAudioOffset(ds.audio_offset || 0);
    } catch (err) {
        console.warn('loadDanceSetAudio failed:', err);
        setStatus('✗ 音频加载失败', false);
    }
}

// ======== Dance Sets Overview ========

function buildDanceSetsOverviewLevel(): PopupLevel {
    return {
        label: '舞蹈套装',
        dir: '',
        items: [],
        renderCustom: async (container) => {
            const loading = document.createElement('div');
            loading.style.cssText = 'padding:24px;text-align:center;color:var(--text-muted);font-size:13px;';
            loading.textContent = '加载中…';
            container.appendChild(loading);
            try {
                await loadDanceSets();
                container.innerHTML = '';
                if (!danceSets || danceSets.length === 0) {
                    cardContainer(container, (c) => {
                        const empty = document.createElement('div');
                        empty.style.cssText = 'padding:24px;text-align:center;color:var(--text-muted);font-size:13px;';
                        empty.innerHTML = '<div>暂无舞蹈套装</div><div style="font-size:11px;margin-top:8px;color:var(--text-dark);">点击下方按钮创建新套装</div>';
                        c.appendChild(empty);
                    });
                } else {
                    cardContainer(container, (c) => {
                        for (const ds of danceSets) {
                            const setId = computeDanceSetId(ds);
                            const row = document.createElement('div');
                            row.className = 'slide-item';
                            const vmdName = ds.vmd_path.split('/').pop() || ds.vmd_path;
                            const is = document.createElement('span');
                            is.className = 'slide-icon';
                            const ie = createIconifyIcon('lucide:music');
                            if (ie) is.appendChild(ie);
                            row.appendChild(is);
                            const ls = document.createElement('span');
                            ls.className = 'slide-label';
                            ls.textContent = ds.name;
                            row.appendChild(ls);
                            const ar = document.createElement('span');
                            ar.className = 'slide-arrow';
                            ar.textContent = '>';
                            row.appendChild(ar);
                            row.dataset.hint = ds.description || vmdName;
                            row.addEventListener('click', () => {
                                const level = buildDanceSetDetailLevel(setId);
                                if (stackRegistry.modelStack) {
                                    stackRegistry.modelStack.push(level);
                                } else {
                                    import('./motion-popup').then(m => m.getMotionMenu()?.push(level));
                                }
                            });
                            c.appendChild(row);
                        }
                    });
                }

                cardContainer(container, (c) => {
                    const row = document.createElement('div');
                    row.className = 'slide-item';
                    const is = document.createElement('span');
                    is.className = 'slide-icon';
                    const ie = createIconifyIcon('lucide:plus');
                    if (ie) is.appendChild(ie);
                    row.appendChild(is);
                    const ls = document.createElement('span');
                    ls.className = 'slide-label';
                    ls.textContent = '新建套装';
                    row.appendChild(ls);
                    row.addEventListener('click', () => createNewDanceSet());
                    c.appendChild(row);
                });
            } catch (err) {
                console.warn('buildDanceSetsOverviewLevel:', err);
                container.textContent = '加载失败';
            }
        },
    };
}

// ======== Dance Set Detail ========

export function buildDanceSetDetailLevel(setId: string): PopupLevel {
    const ds = danceSets.find((d) => computeDanceSetId(d) === setId);
    if (!ds) {
        return { label: '未知套装', dir: '', items: [] };
    }

    const vmdName = ds.vmd_path.split('/').pop() || ds.vmd_path;
    const audioName = ds.audio_path ? ds.audio_path.split('/').pop() : '无';

    return {
        label: ds.name,
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                const fields: Array<{ label: string; value: string }> = [
                    { label: '套装名称', value: ds.name },
                    { label: 'VMD 文件', value: vmdName },
                    { label: '音频文件', value: audioName },
                    { label: '音频偏移', value: `${ds.audio_offset.toFixed(2)} 秒` },
                    { label: '描述', value: ds.description || '—' },
                ];
                for (const f of fields) {
                    const row = document.createElement('div');
                    row.className = 'slide-item';
                    row.style.cssText = 'display:flex;justify-content:space-between;padding:6px 14px;min-height:auto;margin:0;';
                    row.innerHTML = `<span class="slide-label" style="color:var(--text-dim);flex:none;">${f.label}</span><span class="slide-label" style="text-align:right;max-width:60%;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(f.value)}</span>`;
                    c.appendChild(row);
                }
            });

            cardContainer(container, (c) => {
                const loadBtn = document.createElement('div');
                loadBtn.className = 'slide-item';
                loadBtn.innerHTML = '<span class="slide-icon"><iconify-icon icon="lucide:play"></iconify-icon></span><span class="slide-label">一键加载</span>';
                loadBtn.addEventListener('click', () => loadDanceSet(ds));
                c.appendChild(loadBtn);

                const deleteBtn = document.createElement('div');
                deleteBtn.className = 'slide-item';
                deleteBtn.innerHTML = '<span class="slide-icon"><iconify-icon icon="lucide:trash-2"></iconify-icon></span><span class="slide-label" style="color:var(--danger,#ff6b6b);">删除套装</span>';
                deleteBtn.addEventListener('click', async () => {
                    if (await showConfirm(`确定要删除舞蹈套装「${ds.name}」吗？`)) {
                        DeleteDanceSet(setId)
                            .then(() => {
                                setStatus('✓ 已删除舞蹈套装', true);
                                loadDanceSets().then(() => {
                                    stackRegistry.modelStack.pop();
                                    stackRegistry.modelStack.reRender();
                                });
                            })
                            .catch((err) => {
                                console.warn('DeleteDanceSet failed:', err);
                                setStatus('✗ 删除失败', false);
                            });
                    }
                });
                c.appendChild(deleteBtn);
            });
        },
    };
}

async function loadDanceSet(ds: DanceSet): Promise<void> {
    const { focusedModelId } = await import('../core/config');
    if (!focusedModelId) {
        setStatus('✗ 请先加载并聚焦一个模型', false);
        return;
    }
    closeAllOverlays();
    await Promise.all([loadVMDFromPath(ds.vmd_path, focusedModelId), loadDanceSetAudio(ds)]);
    setStatus(`✓ 已加载舞蹈套装: ${ds.name}`, true);
}

async function createNewDanceSet(): Promise<void> {
    try {
        const vmdPath = await SelectVMDMotion();
        if (!vmdPath) return;

        const audioPath = await SelectAudioFile().catch(() => '');

        const defaultName = vmdPath.split(/[\\/]/).pop().replace(/\.vmd$/i, '') || '';
        const name = await showPrompt('请输入舞蹈套装名称：', defaultName);
        if (!name) return;

        const setId = await ImportDanceSet(vmdPath, audioPath, name);
        if (setId) {
            setStatus('✓ 已创建舞蹈套装', true);
            await loadDanceSets();
            if (stackRegistry.modelStack) {
                stackRegistry.modelStack.reRender();
            }
        }
    } catch (err) {
        console.warn('createNewDanceSet failed:', err);
        setStatus('✗ 创建失败', false);
    }
}
