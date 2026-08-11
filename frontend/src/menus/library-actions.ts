// [doc:architecture] Library Actions — 模型加载/替换/标签/缩略图
// 从 library-core.ts 拆分

import {
    allModels,
    LibraryModel,
    PopupLevel,
    modelRegistry,
    focusedModelId,
    recentModels,
    setRecentModels,
    cardContainer,
} from '../core/config';
import { computeLibraryRef } from '@/core/library-path';
import { loadManager } from '../core/load-manager';
import { closeAllOverlays } from './menu-overlay';
import { stackRegistry } from './menu-stack-registry';
import {
    removeModel,
    loadVPDPose,
    triggerAutoSave,
    pushUndoSnapshot,
    offerSceneUndoAndRefresh,
} from '../scene/scene';
import { captureInheritedState, applyInheritedState } from '../scene/manager/model-ops'; // [doc:adr-150]
import { applyIntentToModel } from './motion-binding-ui'; // [doc:adr-150] 触发继承动作的 VMD 应用
import { getSceneMotions, getMotionGen } from '../scene/motion/motion-intent'; // [doc:adr-150]
import { getMotionMenu } from './motion-popup';
import { slideRow } from '../core/ui-helpers';
import { addDisposableListener, type Disposable } from '../core/dom';
import {
    AddRecentModel,
    ExtractZip,
    GetAllTags,
    GetModelsByTag,
    SelectImportFile,
    ImportZip,
    GetLastBrowseDir,
    SetLastBrowseDir,
} from '../core/wails-bindings';
import { isUnderRoot, getBaseName, normPath, isStageLike } from '../core/path';
import { logWarn } from '../core/logger';
import { withLoadingStatus, withLoadingStatusTargeted } from '../core/status-helpers';
import { safeCallAsync } from '@/core/safe-call';
import { t } from '../core/i18n/t';
import { createIconifyIcon } from '../core/icons';
import {
    modelToRow,
    splitSubdirSegments,
    computeRestoreSegments,
    resolveDisplayBrowseDir,
} from './library-core';
import { librarySessionStore } from './library-session-store';
import { feedbackStatus, feedbackError } from '../core/feedback';

// ======== 模块级状态 ========
// [doc:adr-135] 加载守卫状态已迁入 LibrarySessionStore 单例。
// - extraction：原 _isExtracting，解压进行中标记（per-model 升级归 P1.2）
// - replaceLoading：原 _isReplaceLoading，链式替换加载中标记

// mmku:modelLoaded 事件：模型加载完成后刷新模型库弹窗根级列表
// 用命名函数 + 模块级引用，支持 HMR 幂等清理
let _mmkuDisp: Disposable | null = null;
function _onModelLoaded(): void {
    if (librarySessionStore.isReplaceLoading()) {
        return;
    }
    // 懒加载避免循环依赖
    import('../core/config')
        .then(({ dom }) => {
            if (
                dom.sceneOverlay.classList.contains('visible') &&
                dom.sceneOverlay.dataset.popupType === 'model'
            ) {
                const stack = stackRegistry.modelStack;
                if (stack) {
                    import('./library-core')
                        .then(({ buildModelRootItems }) => {
                            // [fix] 不再强制 setLevel(0) 重置菜单，改为就地更新根层级数据。
                            // 仅当用户当前就在根层级时才 reRender，保留用户在子目录中的浏览位置。
                            const rootLevel = stack.getLevel(0);
                            if (!rootLevel) {
                                return;
                            }
                            rootLevel.items = buildModelRootItems();
                            rootLevel.itemBuilder = buildModelRootItems;
                            if (stack.currentLevel === rootLevel) {
                                stack.reRender();
                            }
                        })
                        .catch((err) => logWarn('library', 'buildModelRootItems failed', err));
                }
            }
        })
        .catch((err) => logWarn('library', 'refresh model root list on modelLoaded failed', err));
}
// 先移除旧监听器再注册，确保 HMR 重载不重复绑定
_mmkuDisp?.dispose();
_mmkuDisp = addDisposableListener(document, 'mmku:modelLoaded', _onModelLoaded);

// ======== 模型恢复（上次浏览目录高亮）========

function highlightRow(root: HTMLElement, rowKey: string): void {
    const list = (root.querySelector('.slide-list') ?? root) as HTMLElement;
    const rows = Array.from(list.querySelectorAll('.slide-item')) as HTMLElement[];
    rows.forEach((r) => r.classList.remove('slide-focused'));
    const el = rows.find((r) => r.dataset.rowKey === rowKey);
    if (el) {
        el.classList.add('slide-focused');
        el.scrollIntoView({ block: 'nearest' });
    } else if (import.meta.env.DEV) {
        logWarn('restore', 'focus row not found:', rowKey);
    }
}

export async function prepareModelRestore(
    browseDir: string,
    category: 'pmx' | 'stage'
): Promise<void> {
    // [fix] allModels 为空时跳过恢复：扫描未完成或扫描失败，restore 必然失败
    if (!allModels || allModels.length === 0) {
        librarySessionStore.setPendingAutoExpand(null);
        librarySessionStore.setPendingFocusModel(null);
        return;
    }
    let restoreTarget: string | null = null;
    let focusModel: LibraryModel | null = null;
    let fromRecentModel = false;
    const categoryFilter = (m: LibraryModel) => m.format === category;
    for (const ref of recentModels) {
        const m = allModels.find(
            (x) => x.format === category && computeLibraryRef(x.file_path) === ref
        );
        if (m && isUnderRoot(browseDir, m.dir)) {
            restoreTarget = normPath(m.dir);
            focusModel = m;
            fromRecentModel = true;
            break;
        }
    }
    if (!restoreTarget) {
        const lastDir = await GetLastBrowseDir(category);
        if (lastDir) {
            restoreTarget = normPath(lastDir);
        }
    }
    if (restoreTarget) {
        const fullSegs = splitSubdirSegments(browseDir, restoreTarget);
        if (fromRecentModel) {
            const result = computeRestoreSegments(
                browseDir,
                restoreTarget,
                allModels,
                categoryFilter
            );
            librarySessionStore.setPendingAutoExpand(result && result.length > 0 ? result : null);
        } else {
            librarySessionStore.setPendingAutoExpand(
                fullSegs && fullSegs.length > 0 ? fullSegs : null
            );
        }
    } else {
        librarySessionStore.setPendingAutoExpand(null);
    }
    librarySessionStore.setPendingFocusModel(
        focusModel
            ? { dir: normPath(focusModel.dir), rowKey: 'model:' + focusModel.file_path }
            : null
    );
}

// ======== 模型行点击 ========

/** 记录最近使用的模型（用于历史列表）。 */
function recordRecentModel(m: LibraryModel): void {
    const ref = computeLibraryRef(m.file_path);
    if (ref) {
        safeCallAsync('library-actions', 'AddRecentModel failed:', () => AddRecentModel(ref));
        setRecentModels([ref, ...recentModels.filter((r) => r !== ref)].slice(0, 20));
    }
}

/** 记忆浏览目录：使用户下次打开资源库能回到当前位置。 */
function recordBrowseDir(m: LibraryModel): void {
    const memCat: 'pmx' | 'stage' = m.type === 'stage' || m.type === 'scene' ? 'stage' : 'pmx';
    void safeCallAsync('library-actions', 'SetLastBrowseDir failed:', () =>
        SetLastBrowseDir(memCat, resolveDisplayBrowseDir(m, memCat))
    );
}

/** 替换模式入口：加载新模型 → 移除旧模型 → 导航到浏览层。 */
function startReplaceModel(m: LibraryModel, replaceId: string): void {
    // 取消上一次 loadManager 请求，避免快速连点竞态（与 loadModelNormal 共享同一模块级 AbortController）
    if (_loadManagerAbortCtrl) {
        _loadManagerAbortCtrl.abort();
    }
    const ctrl = new AbortController();
    _loadManagerAbortCtrl = ctrl;
    const signal = ctrl.signal;

    librarySessionStore.setReplaceLoading(true);

    const doReplace = (path: string, libraryPath?: string, innerPath?: string): void => {
        // [doc:adr-150] 替换前捕获旧模型可继承状态 + 场景撤销快照
        const oldInst = modelRegistry.get(replaceId);
        const snapshot = oldInst ? captureInheritedState(oldInst) : null;
        const undoSnap = pushUndoSnapshot();
        feedbackStatus('library.loadingModel', getBaseName(m.file_path));
        let loadKind: 'actor' | 'stage' = 'actor';
        if (m.type === 'stage' || m.type === 'scene') {
            loadKind = 'stage';
        }

        loadManager
            .load({ kind: loadKind, path, libraryPath, innerPath }, signal)
            .then(async (handle) => {
                if (!handle?.id) {
                    stackRegistry.modelStack?.reRender();
                    feedbackError('library.modelLoadFailed', getBaseName(m.file_path));
                    return;
                }
                // [doc:adr-150] 在 removeModel 旧模型之前应用继承状态（此时新模型已注册，
                // 焦点已由 model-loader 切换；旧模型 inst 仍可查询）
                // [fix P2] 继承应用包 try-catch：失败时降级为「不继承但继续替换」，
                // 避免异常逃逸到 .catch 报「加载失败」而 removeModel 未执行 → 新旧模型并存。
                try {
                    if (snapshot) {
                        applyInheritedState(handle.id, snapshot);
                        // [doc:adr-150] sceneMotionId 赋值后手动触发 VMD 应用：
                        // model-loader 已按新模型默认 motionSlots 加载了 VMD，
                        // 若继承的 sceneMotionId 对应不同动作，需通过 applyIntentToModel 重新应用
                        if (snapshot.sceneMotionId) {
                            const intent = getSceneMotions().find(
                                (m) => m.id === snapshot.sceneMotionId
                            );
                            if (intent) {
                                applyIntentToModel(handle.id, intent, getMotionGen());
                            }
                        }
                    }
                } catch (inheritErr) {
                    logWarn('library-actions', 'applyInheritedState failed, replaced without inherit', inheritErr);
                }
                removeModel(replaceId);
                // [doc:adr-127] 破坏性操作场景级撤销保护
                offerSceneUndoAndRefresh(t('model-detail.replaced'), undoSnap, () =>
                    stackRegistry.modelStack?.reRender()
                );
                try {
                    // [doc:adr-195] 替换后保持浏览器打开，更新 outcome.modelId 指向新模型
                    const stack = stackRegistry.modelStack;
                    if (stack?.currentLevel) {
                        stack.currentLevel.outcome = { mode: 'stay', modelId: handle.id };
                    }
                    stack?.reRender();
                    // [doc:adr-feedback] 最终态已由 offerSceneUndoAndRefresh 给出带撤销的 toast，
                    // 这里不再补一条 "完成" toast，避免重复反馈。
                } catch (uiErr) {
                    logWarn('library-actions', 'replace UI navigation failed', uiErr);
                    // UI 导航失败但模型已加载成功，走状态栏兜底（不弹 toast，避免与"模型已替换"叠加）
                    feedbackStatus('status.done', getBaseName(m.file_path));
                }
            })
            .catch((err) => {
                feedbackError('library.modelLoadFailed', getBaseName(m.file_path), err);
                stackRegistry.modelStack?.reRender();
            })
            .finally(() => {
                librarySessionStore.setReplaceLoading(false);
                if (_loadManagerAbortCtrl === ctrl) {
                    _loadManagerAbortCtrl = null;
                }
            });
    };

    if (m.container === 'zip') {
        feedbackStatus('library.extractingZip', getBaseName(m.file_path));
        librarySessionStore.setExtracting(m.file_path);
        ExtractZip(m.file_path, m.zip_inner)
            .then((result) => {
                // [doc:adr-feedback] 中间步骤走状态栏，避免与后续"模型已替换"toast 叠加
                feedbackStatus(
                    result.cached ? 'library.cacheHit' : 'library.extracted',
                    getBaseName(m.file_path)
                );
                doReplace(result.file_path, m.file_path, m.zip_inner);
            })
            .catch((err) => {
                librarySessionStore.setReplaceLoading(false);
                feedbackError('library.extractFailed', getBaseName(m.file_path), err);
            })
            .finally(() => {
                librarySessionStore.clearExtracting(m.file_path);
            });
    } else {
        doReplace(m.file_path);
    }
}

/** [adr-143] 模块级 AbortController：用户快速连点新模型时，取消上一个 loadManager.load()。
 * 与 model-loader 内部的 _loadAbortController 互补：此处取消队列级请求，后者取消底层解析。 */
let _loadManagerAbortCtrl: AbortController | null = null;

/** 正常加载模式：zip 提取后加载，或按格式直接加载。 */
function loadModelNormal(m: LibraryModel, isStage: boolean): void {
    // 取消上一次 loadManager 请求，避免快速连点竞态
    if (_loadManagerAbortCtrl) {
        _loadManagerAbortCtrl.abort();
    }
    const ctrl = new AbortController();
    _loadManagerAbortCtrl = ctrl;
    const signal = ctrl.signal;

    // [fix P2] 统一判定「加载被取消」（快速连点被新选择 abort）——非失败，静默 logWarn
    // 不弹「加载失败」误报 toast。判定依据：ctrl 已被 abort 或 reject 的是 AbortError。
    const isAborted = (err: unknown): boolean =>
        ctrl.signal.aborted ||
        (err != null && typeof err === 'object' && 'name' in err && err.name === 'AbortError');
    // [fix P2] 统一清理模块级 ctrl（zip 与非 zip 分支共用，消除非 zip 分支无 finally 的残留）
    const clearCtrl = (): void => {
        if (_loadManagerAbortCtrl === ctrl) {
            _loadManagerAbortCtrl = null;
        }
    };
    const loadWithFallback = (promise: Promise<{ id?: string } | null | undefined>): void => {
        promise
            .then((handle) => {
                if (!handle) {
                    feedbackError('library.modelLoadFailed', getBaseName(m.file_path));
                }
            })
            .catch((err) => {
                if (isAborted(err)) {
                    logWarn('library-actions', '加载被取消（abort），静默处理', getBaseName(m.file_path));
                    return;
                }
                feedbackError('library.modelLoadFailed', getBaseName(m.file_path), err);
            })
            .finally(clearCtrl);
    };

    if (m.container === 'zip') {
        feedbackStatus('library.extractingZip', getBaseName(m.file_path));
        librarySessionStore.setExtracting(m.file_path);
        ExtractZip(m.file_path, m.zip_inner)
            .then((result) => {
                // [doc:adr-feedback] 中间步骤走状态栏，避免与后续 VMD/模型加载 toast 叠加
                feedbackStatus(
                    result.cached ? 'library.cacheHit' : 'library.extracted',
                    getBaseName(m.file_path)
                );
                if (m.format === 'vmd') {
                    loadWithFallback(
                        loadManager.load({ kind: 'vmd', path: result.file_path }, signal)
                    );
                } else {
                    loadWithFallback(
                        loadManager.load(
                            {
                                kind: isStage ? 'stage' : 'actor',
                                path: result.file_path,
                                libraryPath: m.file_path,
                                innerPath: m.zip_inner,
                            },
                            signal
                        )
                    );
                }
            })
            .catch((err) => {
                feedbackError('library.extractFailed', getBaseName(m.file_path), err);
            })
            .finally(() => {
                librarySessionStore.clearExtracting(m.file_path);
                // 清理模块级 ctrl（当前请求已走完，允许下次新建）
                if (_loadManagerAbortCtrl === ctrl) {
                    _loadManagerAbortCtrl = null;
                }
            });
        return;
    }
    if (m.format === 'pmx') {
        loadWithFallback(
            loadManager.load({ kind: isStage ? 'stage' : 'actor', path: m.file_path }, signal)
        );
    } else if (m.format === 'vmd') {
        loadWithFallback(loadManager.load({ kind: 'vmd', path: m.file_path }, signal));
    } else if (m.format === 'audio') {
        loadWithFallback(loadManager.load({ kind: 'audio', path: m.file_path }, signal));
    } else if (m.format === 'vpd') {
        // [audit-p2] VPD 加载无兜底：失败静默吞掉并 logWarn，避免未处理 rejection
        safeCallAsync('library-actions', 'loadVPDPose failed:', () => loadVPDPose(m.file_path));
        // [fix P2] VPD 路径无 loadManager 请求，主动清理 ctrl（避免残留悬挂）
        clearCtrl();
    }
}

function onModelRowClick(m: LibraryModel, jumpToDirModelId?: string): void {
    // [doc:adr-135] P1.2: per-model 守卫。zip A 解压时 pmx B 直接放行，不再被一刀切阻塞。
    if (librarySessionStore.isExtracting(m.file_path)) {
        feedbackStatus('library.extracting', getBaseName(m.file_path));
        return;
    }
    if (librarySessionStore.isReplaceLoading()) {
        feedbackStatus('library.loadingModel', getBaseName(m.file_path));
        return;
    }
    // [doc:adr-131] 由 replaceModel 传参取代 mutation of currentLevel.outcome
    const replaceId = jumpToDirModelId;
    const isStage = isStageLike(m.type);
    const isActor = m.format === 'pmx' && !isStage;
    if (m.format === 'pmx') {
        recordRecentModel(m);
    }

    // [修复] 记忆"显示目录"为上次浏览目录
    if (m.format === 'pmx') {
        recordBrowseDir(m);
    }

    // ===== Replace mode =====
    if (replaceId && isActor) {
        startReplaceModel(m, replaceId);
        return;
    }

    // ===== Normal mode =====
    loadModelNormal(m, isStage);
}

function replaceModel(m: LibraryModel): void {
    const _isActor = m.format === 'pmx' && m.type !== 'stage' && m.type !== 'scene';
    // [doc:adr-131] 传参取代 mutation of currentLevel.outcome
    onModelRowClick(m, focusedModelId ?? undefined);
}

// 网格模式点击动作（VMD）时触发：替换聚焦模型的当前基础动作。
// 与 replaceModel 对称——模型点击替换模型，动作点击替换动作。
function replaceMotion(m: LibraryModel): void {
    if (m.format !== 'vmd') {
        replaceModel(m);
        return;
    }
    if (!focusedModelId) {
        // 无聚焦模型：退化为普通加载（缓存待应用）
        onModelRowClick(m);
        return;
    }
    if (librarySessionStore.isReplaceLoading()) {
        feedbackStatus('library.loadingModel', undefined, false);
        return;
    }
    closeAllOverlays();
    const targetId = focusedModelId;
    const motionName = getBaseName(m.file_path).replace(/\.vmd$/i, '');
    const doLoad = async (path: string): Promise<void> => {
        // [fix P1] 与 startReplaceModel 对称：doLoad 开始即置 replaceLoading，
        // finally 复位——快速连点两个 VMD 时后点击被 isReplaceLoading() 拦截，
        // 否则两路并发各 pushUndoSnapshot + offerSceneUndoAndRefresh，撤销栈错乱。
        librarySessionStore.setReplaceLoading(true);
        try {
            // [adr-169] 原位替换默认动作是破坏性操作（旧默认被移除）：操作前快照，成功后提供撤销
            const snap = pushUndoSnapshot();
            // [fix P2] withLoadingStatus 吞错返回 undefined：加载失败时不得继续
            // 执行 triggerAutoSave/offerSceneUndoAndRefresh（否则「动作已替换」误报 + 误保存）
            const ok = await withLoadingStatus('library.loadingMotion', 'status.done', () =>
                loadManager.load({ kind: 'vmd', path, modelId: targetId })
            );
            if (!ok) {
                return;
            }
            triggerAutoSave();
            offerSceneUndoAndRefresh(t('motion.motionReplaced', { name: motionName }), snap, () =>
                getMotionMenu()?.reRender()
            );
        } finally {
            librarySessionStore.setReplaceLoading(false);
        }
    };
    if (m.container === 'zip') {
        librarySessionStore.setExtracting(m.file_path);
        withLoadingStatusTargeted(
            'library.extractingZip',
            'feedback.extractionSuccess',
            getBaseName(m.file_path),
            () => ExtractZip(m.file_path, m.zip_inner)
        )
            .then(async (result) => {
                if (!result) {
                    return;
                }
                try {
                    await doLoad(result.file_path);
                } catch (err) {
                    // [fix P2] doLoad 失败发生在解压成功之后——报「动作加载失败」而非误报「解压失败」。
                    // 注意：doLoad 内的 pushUndoSnapshot 已记录（操作前快照），失败时该撤销项指向
                    // 未完成的变更（撤销为 no-op），不破坏栈语义，属已知小瑕疵。
                    feedbackError('library.modelLoadFailed', getBaseName(m.file_path), err);
                }
            })
            .catch((err) => {
                // 仅 ExtractZip 本身失败才报解压失败
                feedbackError('library.extractFailed', getBaseName(m.file_path), err);
            })
            .finally(() => {
                librarySessionStore.clearExtracting(m.file_path);
            });
        return;
    }
    // [audit-p4] 非 zip 分支丢弃 doLoad 的 Promise：若中途抛异常，撤销快照已记录但异常被静默吞掉，这里统一安全包装
    safeCallAsync('library-actions', 'doLoad failed:', () => doLoad(m.file_path));
}

// ======== 标签 ========

function buildTagsOverviewLevel(): PopupLevel {
    return {
        label: t('library.tags'),
        dir: '',
        items: [],
        renderCustom: async (container) => {
            container.classList.remove('render-card');
            try {
                const favRefs = await GetModelsByTag('收藏');
                const tags = await GetAllTags();
                const regularTags = tags ? tags.filter((t) => t !== '收藏') : [];

                cardContainer(container, (c) => {
                    const favRow = document.createElement('div');
                    favRow.className = 'slide-item';
                    const fi = document.createElement('span');
                    fi.className = 'slide-icon';
                    const fe = createIconifyIcon('lucide:star');
                    if (fe) {
                        fe.style.color = 'var(--accent)';
                        fi.appendChild(fe);
                    }
                    favRow.appendChild(fi);
                    const fl = document.createElement('span');
                    fl.className = 'slide-label';
                    fl.textContent = t('library.favorites');
                    favRow.appendChild(fl);
                    const fs = document.createElement('span');
                    fs.className = 'slide-sublabel';
                    fs.textContent = t('library.favCount', { n: favRefs ? favRefs.length : 0 });
                    favRow.appendChild(fs);
                    const fa = document.createElement('span');
                    fa.className = 'slide-arrow';
                    fa.textContent = '>';
                    favRow.appendChild(fa);
                    favRow.addEventListener('click', () =>
                        stackRegistry.modelStack.push(buildTagDetailLevel('收藏'))
                    );
                    c.appendChild(favRow);

                    for (const tag of regularTags) {
                        slideRow(c, 'lucide:tag', tag, true, () =>
                            stackRegistry.modelStack.push(buildTagDetailLevel(tag))
                        );
                    }
                    if (regularTags.length === 0) {
                        const em = document.createElement('div');
                        em.className = 'slide-empty';
                        em.textContent = t('library.noOtherTags');
                        c.appendChild(em);
                    }
                });
                cardContainer(container, (c) => {
                    slideRow(c, 'lucide:plus', t('library.newTag'), false, () => {
                        feedbackStatus('library.addTagHint', undefined, false);
                        stackRegistry.modelStack.pop();
                    });
                });
            } catch (err) {
                logWarn('library-actions', 'buildTagsOverviewLevel:', err);
                container.textContent = t('library.loadTagsFailed');
            }
        },
    };
}

/** [audit-p4] 空态占位：用 createElement + textContent 而非 innerHTML，避免 i18n 文本注入 HTML。 */
function appendEmptyHint(container: HTMLElement, key: string): void {
    const empty = document.createElement('div');
    empty.className = 'slide-empty';
    empty.style.cssText = 'padding:24px;text-align:center;color:var(--text-muted);font-size:13px;';
    empty.textContent = t(key);
    container.appendChild(empty);
}

function buildTagDetailLevel(tagName: string): PopupLevel {
    return {
        label: t('library.tagDetail', { name: tagName }),
        dir: '',
        items: [],
        renderCustom: async (container) => {
            container.classList.remove('render-card');
            try {
                const modelRefs = await GetModelsByTag(tagName);
                if (!modelRefs || modelRefs.length === 0) {
                    appendEmptyHint(container, 'library.tagNoModels');
                    return;
                }
                const matched = (allModels || []).filter((m) => {
                    const ref = computeLibraryRef(m.file_path);
                    return ref && modelRefs.includes(ref);
                });
                if (matched.length === 0) {
                    appendEmptyHint(container, 'library.tagNoMatch');
                    return;
                }
                cardContainer(container, (c) => {
                    for (const m of matched) {
                        const row = modelToRow(m);
                        slideRow(
                            c,
                            row.icon,
                            row.label,
                            false,
                            () => onModelRowClick(m),
                            undefined,
                            undefined,
                            undefined,
                            undefined,
                            { wrapLabel: true }
                        );
                    }
                });
            } catch (err) {
                logWarn('library-actions', 'buildTagDetailLevel:', err);
                container.textContent = t('library.loadFailed');
            }
        },
    };
}

// ======== 导入文件 ========

export async function importFileByPath(path: string): Promise<void> {
    const lower = path.toLowerCase();
    // [doc:adr-182] web://model/<encStem> 是 FSA 手动导入 PMX 的返回路径（含序号后缀），
    // 不以 .pmx 结尾但语义为 PMX 加载，需与 .pmx 裸路径一视同仁。
    const isWebModel = path.startsWith('web://model/');
    if (lower.endsWith('.zip')) {
        const imported = await withLoadingStatusTargeted(
            'library.importingZip',
            'feedback.extractionSuccess',
            getBaseName(path),
            () => ImportZip(path)
        );
        if (!imported) {
            return;
        }
        // [fix:import-file-web] zip 解压后自动加载主 PMX 到场景（拖放导入已有此行为）
        if (imported.file_path) {
            await withLoadingStatusTargeted(
                'library.loadingModel',
                'feedback.loadedSuccess',
                getBaseName(imported.file_path),
                () => loadManager.load({ kind: 'actor', path: imported.file_path })
            );
        }
        const { refreshLibrary } = await import('./library-setup');
        await safeCallAsync('library-actions', 'refresh after zip import:', () => refreshLibrary());
    } else if (lower.endsWith('.pmx') || isWebModel) {
        await withLoadingStatusTargeted(
            'library.loadingModel',
            'feedback.loadedSuccess',
            getBaseName(path),
            () => loadManager.load({ kind: 'actor', path })
        );
    } else if (lower.endsWith('.vmd')) {
        await withLoadingStatusTargeted(
            'library.loadingMotion',
            'feedback.loadedSuccess',
            getBaseName(path),
            () => loadManager.load({ kind: 'vmd', path })
        );
    } else {
        feedbackStatus('library.unsupportedFormat', getBaseName(path));
    }
}

export async function importFile(): Promise<void> {
    let path: string;
    try {
        path = await SelectImportFile();
    } catch (err) {
        const msg =
            err instanceof Error
                ? err.message
                : err && typeof err === 'object' && 'message' in err
                  ? String((err as { message: unknown }).message)
                  : String(err);
        if (/cancelled by user/i.test(msg)) {
            return;
        }
        feedbackError('library.selectFileFailed', undefined, err);
        return;
    }
    if (!path) {
        return;
    }
    await importFileByPath(path);
}

// ======== 供 library-browse 使用的内部函数 ========

/** 按名称模糊搜索模型（纯查询，不触发加载）。供 ADR-155/197 NL 控制 resolve 使用，避免 resolve 阶段误触发真实加载。 */
function findLibraryModelByName(name: string): LibraryModel | null {
    return (
        allModels.find((m) =>
            getBaseName(m.file_path).toLowerCase().includes(name.toLowerCase())
        ) ?? null
    );
}

/** 按名称模糊搜索 VMD 动作（纯查询，不触发替换）。 */
function findLibraryMotionByName(name: string): LibraryModel | null {
    return (
        allModels.find(
            (m) =>
                m.format === 'vmd' &&
                getBaseName(m.file_path).toLowerCase().includes(name.toLowerCase())
        ) ?? null
    );
}

export {
    onModelRowClick,
    replaceModel,
    replaceMotion,
    buildTagsOverviewLevel,
    buildTagDetailLevel,
    highlightRow,
    findLibraryModelByName,
    findLibraryMotionByName,
};

// [doc:adr-238] 注册库操作供 core/action-defs 经 scene-action-bridge 调用
// （定义留 core、实现归 menus 启动链，切断 core→menus 反向依赖）。
import { registerSceneAction } from '@/core/scene-action-bridge';
registerSceneAction('replaceModel', (model: unknown) => replaceModel(model as LibraryModel));
registerSceneAction('replaceMotion', (model: unknown) => replaceMotion(model as LibraryModel));
registerSceneAction('findLibraryModelByName', (name: string) => findLibraryModelByName(name));
registerSceneAction('findLibraryMotionByName', (name: string) => findLibraryMotionByName(name));
registerSceneAction('importFile', () => importFile());
