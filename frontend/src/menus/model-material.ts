// [doc:architecture] Model Material — 材质调节 UI 层（batch/per-mat/root/list）

import { cardContainer, PopupLevel, stackRegistry } from '../core/config';
import { feedbackInfo } from '../core/feedback';
import { showInfoToast } from '../core/toast';
import {
    getMatCatGroups,
    resetMatCatParams,
    getMatDetailList,
    getMatParams,
    setMatParams,
    resetSingleMatParams,
    isMatEnabled,
    setMatEnabled,
    isMatCategoryAllEnabled,
    setMatCategoryEnabled,
    DEFAULT_MAT_PARAMS,
    applyUnlitFallback,
} from '../scene/scene';
import {
    slideRow,
    addSliderRow,
    addCollapsible,
    addSectionTitle,
    createHeaderToggle,
} from '../core/ui-helpers';
import type { SlideMenu } from './menu';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { showConfirm } from '../core/dialog';

let _selectedMat: { cat: string; index: number } | null = null;
/** 参数卡片容器引用（增量更新用，避免 reRender） */
let _paramCardEl: HTMLElement | null = null;

/** 添加分组分隔线 + 小标题，将颜色乘率与贴图强度视觉分区。 */
function _addGroupSeparator(panel: HTMLElement, label: string): void {
    addSectionTitle(panel, label);
}

/** 10 个材质参数的元数据定义——buildPerMatSchema 与 _renderParamCard 共享 */
const MAT_PARAM_DEFS: Array<{
    key: keyof typeof DEFAULT_MAT_PARAMS;
    labelKey: string;
    min: number;
    max: number;
    step: number;
    icon?: string;
}> = [
    { key: 'diffuseMul', labelKey: 'model-material.diffuseMul', min: 0, max: 2, step: 0.05 },
    { key: 'specularMul', labelKey: 'model-material.specularMul', min: 0, max: 2, step: 0.05 },
    { key: 'shininess', labelKey: 'model-material.shininess', min: 0, max: 200, step: 1 },
    { key: 'ambientMul', labelKey: 'model-material.ambientMul', min: 0, max: 2, step: 0.05 },
    { key: 'emissiveMul', labelKey: 'model-material.emissiveMul', min: 0, max: 2, step: 0.05 },
    {
        key: 'diffuseTexLevel',
        labelKey: 'model-material.diffuseTexLevel',
        min: 0,
        max: 3,
        step: 0.1,
        icon: 'lucide:image',
    },
    {
        key: 'bumpTexLevel',
        labelKey: 'model-material.bumpTexLevel',
        min: 0,
        max: 3,
        step: 0.1,
        icon: 'lucide:box',
    },
    {
        key: 'toonTexLevel',
        labelKey: 'model-material.toonTexLevel',
        min: 0,
        max: 3,
        step: 0.1,
        icon: 'lucide:palette',
    },
    {
        key: 'sphereTexLevel',
        labelKey: 'model-material.sphereTexLevel',
        min: 0,
        max: 3,
        step: 0.1,
        icon: 'lucide:circle-dot',
    },
    {
        key: 'emissiveTexLevel',
        labelKey: 'model-material.emissiveTexLevel',
        min: 0,
        max: 3,
        step: 0.1,
        icon: 'lucide:sparkles',
    },
    {
        key: 'alphaMul',
        labelKey: 'model-material.alphaMul',
        min: 0,
        max: 1,
        step: 0.01,
        icon: '💧',
    },
];

/** 用 MAT_PARAM_DEFS 批量渲染滑块；withIcons 区分 batch 详情两种 UI */
function _renderMatParamSliders(
    container: HTMLElement,
    id: string,
    matIndex: number,
    params: typeof DEFAULT_MAT_PARAMS,
    withIcons: boolean
): void {
    let groupEmitted = false;
    for (const def of MAT_PARAM_DEFS) {
        if (def.icon && !groupEmitted) {
            _addGroupSeparator(container, t('model-material.texLevelGroup'));
            groupEmitted = true;
        }
        addSliderRow(
            container,
            t(def.labelKey),
            params[def.key] as number,
            def.min,
            def.max,
            def.step,
            (v) => setMatParams(id, matIndex, { [def.key]: v }),
            withIcons ? def.icon : undefined
        );
    }
}

/**
 * 构造材质行的 header-toggle 开关——收敛 matRoot 行与 matList 行两处 ~95% 相同的
 * 手写 toggle（含 <label> 原生二次 click 去重 bugfix、mat-disabled class 联动、
 * setStatus i18n 提示）。读取实时 isMatEnabled 状态，避免依赖过时 input.checked。
 */
function buildMatToggle(
    id: string,
    index: number,
    name: string,
    initialEnabled: boolean,
    row: HTMLElement
): HTMLLabelElement {
    const toggle = createHeaderToggle({
        value: initialEnabled,
        onChange: (newState) => {
            // 业务定制：读实时状态 + 同步 UI + setStatus 提示
            setMatEnabled(id, index, newState);
            row.classList.toggle('mat-disabled', !newState);
            showInfoToast(
                newState
                    ? t('model-material.shown', { name })
                    : t('model-material.hidden', { name })
            );
        },
    });
    toggle.style.marginLeft = 'auto';
    return toggle;
}

function buildMatRootSchema(
    id: string,
    modelName: string,
    targetStack?: SlideMenu | null
): MenuNode[] {
    _selectedMat = null;
    _paramCardEl = null;
    const groups = getMatCatGroups(id);
    const detailList = getMatDetailList(id);

    return [
        // 卡片 1：材质组（折叠列表）
        {
            id: 'mat-root:groups',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    if (groups.size === 0) {
                        const empty = document.createElement('div');
                        empty.className = 'empty-hint';
                        empty.textContent = t('model-material.noMaterialData');
                        inner.appendChild(empty);
                        return;
                    }
                    for (const [cat, mats] of groups) {
                        const count = mats.length;
                        addCollapsible(inner, {
                            title: `${cat} (${count})`,
                            icon: 'lucide:layers',
                            defaultOpen: false,
                            headerToggle: {
                                value: isMatCategoryAllEnabled(id, cat),
                                onChange: (v) => setMatCategoryEnabled(id, cat, v),
                                bind: () => isMatCategoryAllEnabled(id, cat),
                            },
                            renderContent: (inner2) => {
                                for (const matInfo of mats) {
                                    const detail = detailList.find(
                                        (d) => d.name === matInfo.mat.name
                                    );
                                    const idx = detail ? detail.index : -1;
                                    if (idx === -1) {
                                        continue;
                                    }
                                    const matEnabled = isMatEnabled(id, idx);

                                    const row = document.createElement('div');
                                    row.className = `slide-item${!matEnabled ? ' mat-disabled' : ''}`;
                                    row.style.paddingLeft = '28px';
                                    row.dataset.matIdx = String(idx);
                                    row.dataset.matCat = cat;

                                    const label = document.createElement('span');
                                    label.className = 'slide-label';
                                    label.textContent = `#${String(idx + 1).padStart(2, '0')} ${matInfo.mat.name}`;
                                    row.appendChild(label);

                                    if (detail.modified) {
                                        const sub = document.createElement('span');
                                        sub.className = 'slide-sublabel';
                                        sub.style.color = 'var(--accent)';
                                        sub.textContent = t('model-material.modified');
                                        row.appendChild(sub);
                                    }

                                    const toggle = buildMatToggle(
                                        id,
                                        idx,
                                        matInfo.mat.name,
                                        matEnabled,
                                        row
                                    );
                                    row.appendChild(toggle);

                                    row.addEventListener('click', () => {
                                        const prev = inner2.querySelector('.slide-focused');
                                        if (prev) {
                                            prev.classList.remove('slide-focused');
                                        }
                                        row.classList.add('slide-focused');
                                        _selectedMat = { cat, index: idx };
                                        _renderParamCard(
                                            id,
                                            modelName,
                                            cat,
                                            idx,
                                            detailList,
                                            targetStack
                                        );
                                    });
                                    inner2.appendChild(row);
                                }
                            },
                        });
                    }
                });
            },
        },
        // 卡片 2：参数微调容器（占位，内容由 _renderParamCard 增量填充）
        // 注意：renderCustom 执行时 list 尚未 appendChild 到 panel，isConnected 为 false，
        // 因此用 requestAnimationFrame 延后首次渲染，确保 _paramCardEl 已挂入 DOM 树。
        {
            id: 'mat-root:param-card',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    _paramCardEl = inner;
                });
                requestAnimationFrame(() => {
                    _renderParamCard(id, modelName, null, -1, detailList, targetStack);
                });
            },
        },
        // 卡片 3：光照兜底（伪 unlit，少数异常模型用）
        {
            id: 'mat-root:unlit-fallback',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    slideRow(
                        inner,
                        'lucide:sun-medium',
                        t('model-material.unlitFallback'),
                        false,
                        async () => {
                            const ok = await showConfirm(
                                t('model-material.unlitFallbackConfirm'),
                                t('model-material.unlitFallbackTitle')
                            );
                            if (!ok) {
                                return;
                            }
                            applyUnlitFallback(id);
                            _selectedMat = null;
                            (targetStack ?? stackRegistry.modelStack)?.reRender();
                            feedbackInfo('model-material.unlitFallbackDone', undefined);
                        }
                    );
                });
            },
        },
        // 卡片 4：重置全部
        {
            id: 'mat-root:reset',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    slideRow(
                        inner,
                        'lucide:refresh-ccw',
                        t('model-material.resetAll'),
                        false,
                        () => {
                            resetMatCatParams(id);
                            _selectedMat = null;
                            (targetStack ?? stackRegistry.modelStack)?.reRender();
                            feedbackInfo('model-material.resetAllDone', undefined);
                        }
                    );
                });
            },
        },
    ];
}

export function buildMatRootLevel(
    id: string,
    modelName: string,
    targetStack?: SlideMenu | null
): PopupLevel {
    return {
        label: t('model-material.materialAdjustTitle', { name: modelName }),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildMatRootSchema(id, modelName, targetStack), container);
        },
    };
}

/**
 * 增量渲染参数卡片（替代 reRender 全量重建）。
 * 只更新 _paramCardEl 容器的内容，不影响材质列表。
 */
function _renderParamCard(
    id: string,
    modelName: string,
    cat: string | null,
    index: number,
    detailList: { name: string; index: number; modified: boolean }[],
    targetStack?: SlideMenu | null
): void {
    if (!_paramCardEl) {
        return;
    }
    // 防止幽灵引用：容器被销毁后置 null
    if (!_paramCardEl.isConnected) {
        _paramCardEl = null;
        return;
    }
    _paramCardEl.innerHTML = '';

    if (index === -1 || !cat) {
        return;
    }

    const matName =
        detailList.find((d) => d.index === index)?.name || t('model-material.unknownMaterial');
    const current = getMatParams(id, index);
    const params = current ?? { ...DEFAULT_MAT_PARAMS };

    addCollapsible(_paramCardEl, {
        title: t('model-material.paramTuneTitle'),
        icon: 'lucide:sliders-horizontal',
        defaultOpen: true,
        renderContent: (panel) => {
            addSectionTitle(panel, `${cat} > ${matName}`);

            _renderMatParamSliders(panel, id, index, params, true);

            if (current !== null) {
                slideRow(panel, 'lucide:rotate-ccw', t('model-material.resetThis'), false, () => {
                    resetSingleMatParams(id, index);
                    _selectedMat = null;
                    (targetStack ?? stackRegistry.modelStack)?.reRender();
                    showInfoToast(t('model.materialReset', { name: matName }));
                });
            }
        },
    });
}
