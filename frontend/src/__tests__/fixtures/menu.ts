// [doc:adr-204] 菜单测试共享设施：收敛跨文件重复的 SlideMenu 组装逻辑。
// 仅做无断言的组装工厂，不含分支/断言（见 ADR-204 §2.4 风险约定）。
import { vi } from 'vitest';
import { SlideMenu } from '../../menus/menu';
import type { PopupLevel, PopupRow } from '../../core/config';

export interface SlideMenuTestHandlers {
    onItemClick?: (row: PopupRow, menu: SlideMenu) => void;
    onFolderEnter?: (
        row: PopupRow,
        menu: SlideMenu
    ) => PopupLevel | null | Promise<PopupLevel | null>;
    onHover?: (row: PopupRow, entering: boolean) => void;
    onAfterRender?: (level: PopupLevel, menu: SlideMenu) => void;
    onClose?: () => void;
    extraButtonFactory?: () => HTMLElement[];
}

export interface MakeTestMenuOptions {
    container?: HTMLElement;
    handlers?: Partial<SlideMenuTestHandlers>;
}

/** 构造一个 PopupLevel（原 menu.test.ts 的 makeLevel 辅助函数）。 */
export function makeTestLevel(label: string, dir = '', items: PopupRow[] = []): PopupLevel {
    return { label, dir, items };
}

/**
 * 组装一个挂载到 document.body 的 SlideMenu 测试实例。
 * - 默认用 vi.fn() 填充所有回调，消除各测试文件里重复的 `new SlideMenu({...})` 桩。
 * - 如需特定回调（如断言 onItemClick 触发次数），通过 handlers 覆盖。
 * - 传入 container 时复用外部容器（高阶功能测试在 beforeEach 自建容器）。
 */
export function makeTestMenu(opts: MakeTestMenuOptions = {}): {
    container: HTMLElement;
    menu: SlideMenu;
} {
    const container =
        opts.container ??
        (() => {
            const c = document.createElement('div');
            document.body.appendChild(c);
            return c;
        })();
    const h = opts.handlers ?? {};
    const menu = new SlideMenu({
        container,
        onItemClick: h.onItemClick ?? vi.fn(),
        onFolderEnter: h.onFolderEnter ?? vi.fn(),
        onHover: h.onHover ?? vi.fn(),
        onAfterRender: h.onAfterRender ?? vi.fn(),
        onClose: h.onClose ?? vi.fn(),
        ...(h.extraButtonFactory ? { extraButtonFactory: h.extraButtonFactory } : {}),
    });
    return { container, menu };
}
