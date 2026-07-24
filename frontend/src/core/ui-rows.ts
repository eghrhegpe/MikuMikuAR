// [doc:architecture] ui-rows — 菜单行控件（toggle/slider/mode）
// addToggleRow / addSliderRow / addModeRow / sliderRow / toggleRow

import { createIconifyIcon } from './icons';
import { getCurrentRenderingMenu } from '../menus/menu';
import { ControlOptions } from './ui-types';
import { slideRow } from './ui-slide-row';
import { t } from './i18n/t';
import { clamp01, clampPct, swallowError } from '@/core/utils';
import { DragSliderController } from './ui-slider-controller';
import { SLIDER_QUARTER_LARGE_STEP, SLIDER_QUARTER_SMALL_STEP } from './ui-constants';

// ===================================================================
// addToggleRow
// ===================================================================

// 自增计数器，用于生成稳定的唯一 ID
let nextToggleId = 0;

export function addToggleRow(
    container: HTMLElement,
    label: string,
    value: boolean,
    onChange: (v: boolean) => void,
    icon?: string,
    opts?: ControlOptions<boolean>,
    testId?: string
): void {
    const row = document.createElement('div');
    row.className = 'toggle-row';
    if (testId) {
        row.setAttribute('data-testid', testId);
    }

    const left = document.createElement('div');
    left.className = 'toggle-left';

    if (icon) {
        const iconBox = document.createElement('span');
        iconBox.className = 'cs-icon';
        const iconEl = createIconifyIcon(icon);
        if (iconEl) {
            iconBox.appendChild(iconEl);
        } else {
            const fb = document.createElement('span');
            fb.className = 'cs-icon-fallback';
            fb.textContent = label.charAt(0) || '?';
            iconBox.appendChild(fb);
        }
        left.appendChild(iconBox);
    }

    const lbl = document.createElement('span');
    lbl.className = 'toggle-label';
    lbl.textContent = label;
    lbl.id = `toggle-${++nextToggleId}`;
    left.appendChild(lbl);

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'toggle';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = value;
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('aria-checked', String(value));
    toggle.setAttribute('aria-labelledby', lbl.id);
    toggle.addEventListener('change', () => {
        toggle.setAttribute('aria-checked', String(toggle.checked));
        onChange(toggle.checked);
    });
    const slider = document.createElement('span');
    slider.className = 'slider';
    toggleLabel.appendChild(toggle);
    toggleLabel.appendChild(slider);
    row.appendChild(left);
    row.appendChild(toggleLabel);

    // 整行点击（除 toggle 开关外）也可切换
    row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.toggle')) {
            return;
        }
        toggle.checked = !toggle.checked;
        toggle.setAttribute('aria-checked', String(toggle.checked));
        onChange(toggle.checked);
    });

    container.appendChild(row);

    // === 自更新支持 ===
    initControl(row, opts, value, (v, cached) => {
        const b = !!v;
        if (b === cached) {
            return false;
        }
        toggle.checked = b;
        toggle.setAttribute('aria-checked', String(b));
        return true;
    });
}

// ===================================================================
// initControl — 控件自更新注册 + 立即初始化
// ===================================================================

/**
 * 封装 registerControl + immediate update 模式。
 * `apply` 返回 true 表示值已变更，用于更新缓存。
 */
export function initControl<T>(
    el: HTMLElement,
    opts: ControlOptions<T> | undefined,
    initial: T,
    apply: (v: T, cached: T) => boolean
): void {
    if (!opts) {
        return;
    }
    let cached = initial;
    const update = (): void => {
        if (opts.onUpdate) {
            opts.onUpdate(el);
            return;
        }
        if (!opts.bind) {
            return;
        }
        const v = opts.bind();
        if (apply(v, cached)) {
            cached = v;
        }
    };
    getCurrentRenderingMenu()?.registerControl(update);
    update();
}

// ===================================================================
// addSliderRow
// ===================================================================

/**
 * 数字滑块行。ADR-140：内部统一由 {@link DragSliderController} 驱动
 * （拖拽 + 键盘 + 游标点击），行为与其他滑块 builder 保持一致。
 */
export function addSliderRow(
    container: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
    icon?: string,
    onDragEndCb?: (v: number) => void,
    opts?: ControlOptions<number>,
    testId?: string
): void {
    // 防御: 非有限数值（undefined/NaN）回落到 min ?? 0，避免 .toFixed() 崩溃导致整个面板渲染失败
    let currentValue = typeof value === 'number' && Number.isFinite(value) ? value : (min ?? 0);
    const range = max - min;

    const row = document.createElement('div');
    row.className = 'cs-row';
    if (testId) {
        row.setAttribute('data-testid', testId);
    }

    const top = document.createElement('div');
    top.className = 'cs-top';

    if (icon) {
        const iconBox = document.createElement('span');
        iconBox.className = 'cs-icon';
        const iconEl = createIconifyIcon(icon);
        if (iconEl) {
            iconBox.appendChild(iconEl);
        } else {
            const fb = document.createElement('span');
            fb.className = 'cs-icon-fallback';
            fb.textContent = label.charAt(0) || '?';
            iconBox.appendChild(fb);
        }
        top.appendChild(iconBox);
    }

    const lbl = document.createElement('span');
    lbl.className = 'cs-label';
    lbl.textContent = label;

    const val = document.createElement('span');
    val.className = 'cs-value';

    top.appendChild(lbl);
    top.appendChild(val);

    const bar = document.createElement('div');
    bar.className = 'cs-bar';
    bar.tabIndex = 0;
    bar.setAttribute('role', 'slider');
    bar.setAttribute('aria-label', label);
    bar.setAttribute('aria-valuemin', String(min));
    bar.setAttribute('aria-valuemax', String(max));

    const fill = document.createElement('div');
    fill.className = 'cs-fill';

    const thumb = document.createElement('div');
    thumb.className = 'cs-thumb';

    bar.appendChild(fill);
    bar.appendChild(thumb);

    function updateDisplay(v: number): void {
        currentValue = v;
        val.textContent = step < 1 ? v.toFixed(2) : String(Math.round(v));
        const newPct = ((v - min) / range) * 100;
        const clamped = clampPct(newPct);
        fill.style.width = clamped + '%';
        thumb.style.left = clamped + '%';
        bar.setAttribute('aria-valuenow', String(v));
    }

    updateDisplay(currentValue);

    const controller = new DragSliderController({
        value: currentValue,
        min,
        max,
        step,
        onChange: (v) => {
            updateDisplay(v);
            onChange(v);
        },
        onDragEnd: (v) => {
            onDragEndCb?.(v);
        },
    });
    controller.bind(bar);

    // cs-top 四分区域相对步进：左→右 = 减大步 → 减小步 → 加小步 → 加大步
    top.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = top.getBoundingClientRect();
        const pct = clamp01((e.clientX - rect.left) / rect.width);
        const delta =
            pct < 0.25
                ? -(range * SLIDER_QUARTER_LARGE_STEP)
                : pct < 0.5
                  ? -(range * SLIDER_QUARTER_SMALL_STEP)
                  : pct < 0.75
                    ? range * SLIDER_QUARTER_SMALL_STEP
                    : range * SLIDER_QUARTER_LARGE_STEP;
        const raw = currentValue + delta;
        const precision = step > 0 ? 1 / step : 1;
        const snapped = Math.round(raw * precision) / precision;
        const clamped = Math.max(min, Math.min(max, snapped));
        if (clamped !== currentValue) {
            currentValue = clamped;
            updateDisplay(clamped);
            onChange(clamped);
        }
    });

    row.appendChild(top);
    row.appendChild(bar);
    container.appendChild(row);

    // === 自更新支持 ===
    initControl(row, opts, value, (v, cached) => {
        if (!Number.isFinite(v) || v === cached) {
            return false;
        }
        updateDisplay(v);
        controller.setValue(v);
        return true;
    });
}

// ===================================================================
// addModeRow
// ===================================================================

export function addModeRow<T extends string | number>(
    container: HTMLElement,
    label: string,
    options: Array<{ value: T; label: string }>,
    currentValue: T,
    onChange: (v: T) => void,
    testId?: string
): void {
    const row = document.createElement('div');
    row.className = 'type-row';
    if (testId) {
        row.setAttribute('data-testid', testId);
    }
    const lbl = document.createElement('span');
    lbl.className = 'type-label';
    lbl.textContent = label;
    row.appendChild(lbl);
    for (const opt of options) {
        const btn = document.createElement('button');
        btn.textContent = opt.label;
        btn.className = 'mode-btn' + (currentValue === opt.value ? ' active' : '');
        btn.addEventListener('click', () => onChange(opt.value));
        row.appendChild(btn);
    }
    container.appendChild(row);
}

// ===================================================================
// addEmptyRow — 空状态占位行
// ===================================================================

/**
 * 创建空状态占位行（灰色文字，不可点击），替代手动 `el.style.opacity = '0.5'` 模式
 */
export function addEmptyRow(parent: HTMLElement, text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'slide-item slide-item-muted';
    el.textContent = text;
    parent.appendChild(el);
    return el;
}

/** 创建 card-title 标题行并追加到容器 */
export function addCardTitle(container: HTMLElement, text: string): HTMLElement {
    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = text;
    container.appendChild(title);
    return title;
}

// ===================================================================
// addDangerRow — 危险/删除操作行
// ===================================================================

/**
 * 创建危险操作行（icon + red label），替代手动拼接 `div.slide-item > icon + label.danger-text`
 */
export function addDangerRow(
    container: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
    testId?: string
): HTMLElement {
    return slideRow(
        container,
        icon,
        label,
        false,
        onClick,
        undefined,
        undefined,
        undefined,
        undefined,
        {
            variant: 'danger',
            ...(testId ? { testId } : {}),
        }
    );
}

// ===================================================================
// addFieldRow — 键值字段行
// ===================================================================

/**
 * 创建字段行（左 label + 右 value），替代手动拼接的
 * `div.slide-item > span.slide-label.field-label + span.field-value`
 */
export function addFieldRow(
    container: HTMLElement,
    label: string,
    value: string,
    testId?: string
): HTMLElement {
    const row = slideRow(
        container,
        '',
        label,
        false,
        () => {},
        undefined,
        undefined,
        undefined,
        undefined,
        {
            rightLabel: value,
            hideIcon: true,
            ...(testId ? { testId } : {}),
        }
    );
    row.classList.add('field-row');
    return row;
}

// ===================================================================
// addInfoGrid / addInfoCard — 响应式信息卡网格
// 数字类短字段进常规卡（窄屏 2 列、宽屏 auto-fill 自动加列），
// 长文本字段传 wide:true 跨整行，避免截断。
// 用 textContent 写入，天然免疫 HTML 注入，无需 escapeHtml。
// ===================================================================

export function addInfoGrid(container: HTMLElement): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'info-grid';
    container.appendChild(grid);
    return grid;
}

export function addInfoCard(
    container: HTMLElement,
    label: string,
    value: string,
    opts?: { wide?: boolean; sub?: string; testId?: string }
): HTMLElement {
    const card = document.createElement('div');
    card.className = 'info-card' + (opts?.wide ? ' info-card--wide' : '');
    if (opts?.testId) {
        card.setAttribute('data-testid', opts.testId);
    }
    const labelEl = document.createElement('div');
    labelEl.className = 'info-card-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('div');
    valueEl.className = 'info-card-value';
    valueEl.textContent = value;
    card.appendChild(labelEl);
    card.appendChild(valueEl);
    if (opts?.sub) {
        const subEl = document.createElement('div');
        subEl.className = 'info-card-sub';
        subEl.textContent = opts.sub;
        card.appendChild(subEl);
    }
    container.appendChild(card);
    return card;
}

// ===================================================================
// sliderRow — addSliderRow 的简化版，只保留 onDragEnd
// ===================================================================

export function sliderRow(
    container: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    icon: string,
    onDragEnd: (v: number) => void
): void {
    addSliderRow(container, label, value, min, max, step, () => {}, icon, onDragEnd);
}

// ===================================================================
// toggleRow — addToggleRow 的简化版，onChange 后自动调用 onSave
// ===================================================================

export function toggleRow(
    container: HTMLElement,
    label: string,
    value: boolean,
    icon: string,
    onChange: (v: boolean) => void,
    onSave?: () => void
): void {
    addToggleRow(
        container,
        label,
        value,
        (v) => {
            onChange(v);
            onSave?.();
        },
        icon
    );
}

// ===================================================================
// addWatchDirRow — 监听目录行（状态 + 只读输入框 + 选择按钮）
// 替代 settings-filename.ts 中 ~40 行手写 DOM 孤岛代码
// ===================================================================

export function addWatchDirRow(
    container: HTMLElement,
    onRefreshStatus: (setStatusText: (text: string) => void) => Promise<void>,
    onSelectDir: () => Promise<string | undefined>
): void {
    const statusEl = document.createElement('div');
    statusEl.style.cssText = 'font-size:11px;color:var(--text);padding:4px 14px;';
    container.appendChild(statusEl);

    const setStatusText = (text: string) => {
        statusEl.textContent = text;
    };

    onRefreshStatus(setStatusText).catch(() => setStatusText(t('settings.paths.watchStopped')));

    const dirRow = document.createElement('div');
    dirRow.style.cssText = 'display:flex;gap:6px;padding:6px 14px;';

    const dirInput = document.createElement('input');
    dirInput.type = 'text';
    dirInput.placeholder = t('settings.paths.watchDirPlaceholder');
    dirInput.readOnly = true;
    dirInput.style.cssText =
        'flex:1;background:var(--white-08);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:6px 8px;font-size:12px;';

    const selectBtn = document.createElement('button');
    selectBtn.textContent = '📁';
    selectBtn.className = 'mode-btn';
    selectBtn.addEventListener('click', async () => {
        const dir = await onSelectDir();
        if (!dir) {
            return;
        }
        dirInput.value = dir;
        await onRefreshStatus(setStatusText);
    });

    // 回填初始目录
    swallowError(
        onRefreshStatus(async (text) => {
            const prefix = t('settings.paths.watching')
                .replace(/\{dir\}/g, '')
                .replace(/\s+$/, '');
            const match = text.match(new RegExp(prefix + '\\s*(.+)'));
            if (match) {
                dirInput.value = match[1];
            }
        })
    );

    dirRow.appendChild(dirInput);
    dirRow.appendChild(selectBtn);
    container.appendChild(dirRow);
}

// ===================================================================
// ADR-143 主题 6：收敛三个内联 DOM 孤岛
// ===================================================================

/** 创建一个可点击的操作按钮行（替代手写 cs-row + button）。
 * 复用 addModeRow 的 mode-btn 样式，确保 UI 一致性。 */
export function addActionRow(
    container: HTMLElement,
    label: string,
    onClick: () => void,
    opts?: { icon?: string; disabled?: boolean; testId?: string }
): HTMLElement {
    const { icon, disabled, testId } = opts ?? {};
    const row = document.createElement('div');
    row.className = 'type-row';
    if (testId) {
        row.setAttribute('data-testid', testId);
    }

    const btn = document.createElement('button');
    if (disabled) {
        btn.className = 'mode-btn';
        btn.disabled = true;
        btn.textContent = label;
    } else {
        btn.className = 'mode-btn';
        btn.style.flex = '1';
        btn.textContent = label;
        if (icon) {
            const iconEl = createIconifyIcon(icon);
            if (iconEl) {
                btn.prepend(iconEl);
            }
        }
        btn.addEventListener('click', onClick);
    }
    row.appendChild(btn);
    container.appendChild(row);
    return row;
}

/** 创建一个不可交互的提示行（替代手写 cs-row + opacity 0.4 + pointer-events none）。
 * 复用 cs-row / cs-label / cs-value 样式，视觉与既有行一致。 */
export function addDisabledRow(
    container: HTMLElement,
    label: string,
    value?: string,
    opts?: { testId?: string }
): HTMLElement {
    const { testId } = opts ?? {};
    const row = document.createElement('div');
    row.className = 'cs-row';
    row.style.opacity = '0.4';
    row.style.pointerEvents = 'none';
    if (testId) {
        row.setAttribute('data-testid', testId);
    }
    const lbl = document.createElement('span');
    lbl.className = 'cs-label';
    lbl.textContent = label;
    row.appendChild(lbl);
    if (value !== undefined) {
        const val = document.createElement('span');
        val.className = 'cs-value';
        val.textContent = value;
        row.appendChild(val);
    }
    container.appendChild(row);
    return row;
}

/** 创建一个内联 toggle 行（替代手写 toggle-row + toggle-label + toggle-switch）。
 * 视觉上与 addToggleRow 保持一致，但用 span 模拟而非 input checkbox，
 * 适用于不需要 aria/accessibility 完整性的菜单内联场景。 */
export function addInlineToggleRow(
    container: HTMLElement,
    label: string,
    value: boolean,
    onChange: (v: boolean) => void,
    opts?: { testId?: string }
): HTMLElement {
    const { testId } = opts ?? {};
    const row = document.createElement('div');
    row.className = 'toggle-row';
    if (testId) {
        row.setAttribute('data-testid', testId);
    }
    const lbl = document.createElement('span');
    lbl.className = 'toggle-label';
    lbl.textContent = label;
    const sw = document.createElement('span');
    sw.className = 'toggle-switch' + (value ? ' active' : '');
    sw.addEventListener('click', () => {
        const v = !sw.classList.contains('active');
        sw.classList.toggle('active', v);
        onChange(v);
    });
    row.appendChild(lbl);
    row.appendChild(sw);
    container.appendChild(row);
    return row;
}

// ===================================================================
// createHeaderToggle — 标题栏小型开关（toggle.header-toggle）
// 复用点：menu.ts 弹窗标题 / ui-collapsible 折叠面板 / ui-slide-row 行 /
//         model-material 材质行。统一双触发去重 + bind 自更新 + disabled
// ===================================================================

export interface HeaderToggleConfig {
    value: boolean;
    onChange: (v: boolean) => void;
    /** 自更新：菜单重渲染时调用，返回值变化时同步 input.checked */
    bind?: () => boolean;
    /** 禁用态：input.disabled + toggle-disabled class，不响应 onChange */
    disabled?: boolean;
    /** 禁用态点击回调（如弹出提示） */
    onDisabledClick?: () => void;
    /** 禁用态提示文本（保留字段，由调用方自行消费） */
    disabledHint?: string;
}

/**
 * 创建标题栏小型开关。返回 `<label class="toggle header-toggle">`，
 * 含双触发去重（跳过 target===input 的 synthetic click + preventDefault）。
 * onChange 接收新状态；若需附加 DOM 副作用（如 row.classList.toggle），调用方自行处理。
 */
export function createHeaderToggle(config: HeaderToggleConfig): HTMLLabelElement {
    const toggle = document.createElement('label');
    toggle.className = 'toggle header-toggle';
    if (config.disabled) {
        toggle.classList.add('toggle-disabled');
    }
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = config.value;
    input.disabled = !!config.disabled;
    const slider = document.createElement('span');
    slider.className = 'slider';
    toggle.appendChild(input);
    toggle.appendChild(slider);

    if (!config.disabled) {
        // 修复：<label> 包裹 checkbox 时浏览器原生二次派发 click 到 input，导致 handler 双触发。
        // 跳过 synthetic click(target===input) 并 preventDefault 阻止原生切换造成的视觉错位。
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.target === input) {
                return;
            }
            e.preventDefault();
            input.checked = !input.checked;
            config.onChange(input.checked);
        });
    } else if (config.onDisabledClick) {
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            config.onDisabledClick();
        });
    }

    // bind 自更新：菜单重渲染时同步 input.checked
    if (config.bind) {
        let cached = config.value;
        const update = (): void => {
            const v = !!config.bind!();
            if (v === cached) {
                return;
            }
            cached = v;
            input.checked = v;
        };
        getCurrentRenderingMenu()?.registerControl(update);
    }

    return toggle;
}

// ===================================================================
// addBoneSelectRow — 骨骼下拉选择行（分组 + 搜索 + IK 标记）
// 替代 addModeRow 在骨骼列表上的误用与各面板内联 select 重复（ADR-122 P3）
// ===================================================================

/** [doc:adr-122 P3] 已知 IK 骨骼名集合（IK 目标骨 + 链骨） */
const IK_BONE_NAMES = new Set([
    '左足IK',
    '右足IK',
    '左腕IK',
    '右腕IK',
    '左足首',
    '右足首',
    '左ひざ',
    '右ひざ',
    '左ひじ',
    '右ひじ',
]);

/** [doc:adr-122 P3] 判断骨骼是否为 IK 相关骨骼 */
export function isIkBone(boneName: string): boolean {
    return IK_BONE_NAMES.has(boneName) || boneName.endsWith('IK');
}

/** 已知 MMD 骨骼分组（按日文标准名匹配前缀；遍历顺序决定归属优先级） */
const KNOWN_BONE_GROUPS: Record<string, string[]> = {
    'センター/腰部': ['センター', 'グルーブ', '腰'],
    上半身: ['上半身', '上半身2', '胸', '首', '頭'],
    下半身: [
        '下半身',
        '左足',
        '右足',
        '左ひざ',
        '右ひざ',
        '左足首',
        '右足首',
        '左足IK',
        '右足IK',
    ],
    左腕: ['左肩', '左腕', '左ひじ', '左手首'],
    右腕: ['右肩', '右腕', '右ひじ', '右手首'],
    左手: ['左親指', '左人指', '左中指', '左薬指', '左小指'],
    右手: ['右親指', '右人指', '右中指', '右薬指', '右小指'],
};

/** 按类别分组骨骼名，未匹配的归入「その他」。空组被剔除。 */
export function buildBoneGroups(boneNames: readonly string[]): [string, string[]][] {
    const groups: Map<string, string[]> = new Map();
    for (const key of Object.keys(KNOWN_BONE_GROUPS)) {
        groups.set(key, []);
    }
    groups.set('その他', []);
    for (const name of boneNames) {
        let placed = false;
        for (const [groupName, prefixes] of Object.entries(KNOWN_BONE_GROUPS)) {
            if (prefixes.some((p) => name === p || name.startsWith(p))) {
                groups.get(groupName)!.push(name);
                placed = true;
                break;
            }
        }
        if (!placed) {
            groups.get('その他')!.push(name);
        }
    }
    const result: [string, string[]][] = [];
    for (const [groupName, boneList] of groups) {
        if (boneList.length > 0) {
            boneList.sort();
            result.push([groupName, boneList]);
        }
    }
    return result;
}

export interface BoneSelectOptions {
    /** 搜索框 placeholder，默认 t('motion.boneOverride.search') */
    searchPlaceholder?: string;
    testId?: string;
}

/**
 * 创建骨骼选择行：label + 搜索框 + 分组下拉（含 IK 标记）。
 * 替代 addModeRow 在上百骨骼上的误用，统一相机骨骼锁定 / 高级骨骼覆盖两处入口。
 * 返回 select 元素，便于调用方按需同步 value。
 */
export function addBoneSelectRow(
    container: HTMLElement,
    label: string,
    boneNames: readonly string[],
    currentName: string,
    onChange: (name: string) => void,
    opts?: BoneSelectOptions
): HTMLSelectElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'bone-select-row';
    if (opts?.testId) {
        wrapper.setAttribute('data-testid', opts.testId);
    }

    if (label) {
        const lbl = document.createElement('div');
        lbl.className = 'cs-label-sm';
        lbl.textContent = label;
        wrapper.appendChild(lbl);
    }

    const boneSearch = document.createElement('input');
    boneSearch.type = 'text';
    boneSearch.className = 'full-input';
    boneSearch.placeholder = opts?.searchPlaceholder ?? t('motion.boneOverride.search');
    wrapper.appendChild(boneSearch);

    const boneSelect = document.createElement('select');
    boneSelect.className = 'setting-select';

    const groups = buildBoneGroups(boneNames);
    for (const [groupLabel, names] of groups) {
        const optGroup = document.createElement('optgroup');
        optGroup.label = groupLabel;
        for (const bn of names) {
            const opt = document.createElement('option');
            opt.value = bn;
            // [doc:adr-122 P3] IK 骨骼附加标记
            opt.textContent = isIkBone(bn) ? `${bn} ${t('motion.ikTag')}` : bn;
            optGroup.appendChild(opt);
        }
        boneSelect.appendChild(optGroup);
    }
    boneSelect.value = currentName;
    boneSelect.addEventListener('change', () => {
        onChange(boneSelect.value);
    });
    // [doc:adr-116 P4] 搜索过滤：原生 select 不支持搜索，附加过滤输入框
    boneSearch.addEventListener('input', () => {
        const q = boneSearch.value.trim().toLowerCase();
        for (const g of Array.from(boneSelect.querySelectorAll('optgroup'))) {
            let visible = 0;
            for (const opt of Array.from(g.querySelectorAll('option'))) {
                const hit = !q || (opt.textContent ?? '').toLowerCase().includes(q);
                (opt as HTMLElement).style.display = hit ? '' : 'none';
                if (hit) visible++;
            }
            (g as HTMLElement).style.display = visible > 0 ? '' : 'none';
        }
    });
    wrapper.appendChild(boneSelect);
    container.appendChild(wrapper);
    return boneSelect;
}
