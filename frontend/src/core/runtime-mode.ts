// [doc:adr-099] 运行时模式徽标 — 常驻 HUD，显示 MPR/COI/SAB 能力检测结果。
// 与瞬时 setStatus 不同：本徽标是独立 DOM 元素，不被其他状态消息覆盖；
// 检测结果持久化到 localStorage，刷新/导航后由 bootstrap 立即渲染，避免"被刷新丢失"。
import { dom } from './dom';

export interface RuntimeMode {
    /** 构建期是否编入 MPR（__MMD_ENABLE_MPR__） */
    mprBuild: boolean;
    /** 运行期 crossOriginIsolated 是否为 true（COOP/COEP 双头已注入） */
    coi: boolean;
    /** SharedArrayBuffer 是否可用 */
    sab: boolean;
    /** 实际走多线程物理（mprBuild && coi && sab） */
    mpr: boolean;
    /** 并行度（rayon worker 池上限，取 navigator.hardwareConcurrency） */
    threads: number;
}

const STORAGE_KEY = 'mmcar.runtimeMode.v1';

export function detectRuntimeMode(): RuntimeMode {
    const coi = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true;
    const sab = typeof SharedArrayBuffer === 'function';
    const mprBuild = typeof __MMD_ENABLE_MPR__ !== 'undefined' && __MMD_ENABLE_MPR__ === true;
    const mpr = mprBuild && coi && sab;
    const threads = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 0;
    return { mprBuild, coi, sab, mpr, threads };
}

export function persistRuntimeMode(mode: RuntimeMode): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mode));
}

export function loadPersistedRuntimeMode(): RuntimeMode | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RuntimeMode) : null;
}

function badgeText(mode: RuntimeMode): string {
    if (mode.mpr) {
        return `⚡MPR ×${mode.threads}`;
    }
    if (mode.mprBuild && !mode.coi) {
        return '⚠ MPR? COI✗';
    }
    return 'SPR';
}

function badgeColor(mode: RuntimeMode): string {
    if (mode.mpr) {
        return 'rgba(111,207,151,0.85)'; // 绿：多线程激活
    }
    if (mode.mprBuild && !mode.coi) {
        return 'rgba(240,180,80,0.9)'; // 琥珀：构建要 MPR 但隔离缺失，已回退 SPR
    }
    return 'rgba(255,255,255,0.35)'; // 灰：单线程
}

// [doc:adr-176] 追加显示实际选中的后端（go / browser），与 MPR/SPR 徽标合成，
// 消除「网页壳参杂 Go 逻辑」的歧义。模块级缓存最近一次 RuntimeMode + 后端 kind，
// 任一方更新都重绘，互不覆盖。
let _lastMode: RuntimeMode | null = null;
let _backendKind: string | null = null;

function _composeText(mode: RuntimeMode): string {
    const base = badgeText(mode);
    return _backendKind ? `${base} · ${_backendKind}` : base;
}
function _composeTitle(mode: RuntimeMode): string {
    const base = `MPR构建=${mode.mprBuild} COI=${mode.coi} SAB=${mode.sab} 并行度=${mode.threads}`;
    return _backendKind ? `${base} · backend=${_backendKind}` : base;
}

export function renderRuntimeBadge(mode: RuntimeMode): void {
    _lastMode = mode;
    if (!dom.runtimeBadge) {
        return;
    }
    dom.runtimeBadge.textContent = _composeText(mode);
    dom.runtimeBadge.style.color = badgeColor(mode);
    dom.runtimeBadge.title = _composeTitle(mode);
}

/** 渲染实际选中的后端（go / browser）到运行时徽标，与 MPR/SPR 状态合成显示 */
export function setBackendBadge(kind: string): void {
    _backendKind = kind;
    if (_lastMode && dom.runtimeBadge) {
        dom.runtimeBadge.textContent = _composeText(_lastMode);
        dom.runtimeBadge.title = _composeTitle(_lastMode);
    }
}

/** bootstrap 早期调用：立即渲染上次持久化的模式，刷新后不丢失 */
export function initRuntimeBadge(): void {
    const persisted = loadPersistedRuntimeMode();
    if (persisted) {
        renderRuntimeBadge(persisted);
        return;
    }
    // [bugfix:cap-badge] 首次访问（无持久化）时渲染当前检测结果，避免徽标空白
    renderRuntimeBadge(detectRuntimeMode());
}
