// 统一 Wails binding 入口，隔离框架依赖
// Go 端新增 binding 自动可见，零维护
// 未来可在此层加 mock/日志/重试适配器

export * from '../../wailsjs/go/main/App';
export { OnFileDrop, EventsOn, EventsEmit, BrowserOpenURL } from '../../wailsjs/runtime/runtime';
export type { main } from '../../wailsjs/go/models';
