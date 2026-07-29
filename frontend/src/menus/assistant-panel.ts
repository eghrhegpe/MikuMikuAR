// [doc:adr-202] AI 助手独立面板 —— 从设置菜单拆出的主窗口内独立 overlay 入口。
//
// 复用 registerPopupMenu 工厂 + 诊断面板 schema（buildDiagnosticSchema），
// 以更宽的 overlayClass('sceneOverlay-assistant') 承载会话历史 + 对话。
// 不新开 WebView 窗口（用户选主窗口内面板）。设置菜单入口与此共用同一 schema。

import { registerPopupMenu } from './menu-factory';
import { t } from '../core/i18n/t';
import type { PopupLevel } from '../core/config';
import { renderDiagnosticPanel } from './settings-diagnostic';

const { show: showAssistant } = registerPopupMenu({
    wrapperKey: 'assistant-menu',
    popupType: 'assistant',
    overlayClass: 'sceneOverlay-assistant',
    buildRoot: (): PopupLevel => ({
        label: t('settings.diagnostic'),
        dir: '',
        items: [],
        // 独立面板含会话历史卡（withSessions），区别于设置菜单内的轻量入口；
        // renderDiagnosticPanel 返回 dispose，关闭时 flush 会话 + 清理运行态。
        renderCustom: (container) => renderDiagnosticPanel(container, { withSessions: true }),
    }),
    handlers: {},
});

export { showAssistant };
