// 组件隔离渲染入口：?c=<name> 经 navActions 真实链路打开单个菜单面板。
// 与 e2e 的分工：e2e 管「全 app 行为回归 + 硬断言」（playwright.config.ts），
// harness 管「单面板隔离视觉、秒级截图回看」——不跑 bootstrap()，零 3D 引擎。
// 就绪协议：面板经 toggleOverlay 挂出且 #sceneOverlay 出现内容后置 body[data-ready=1]，
// 失败置 data-error（信息给 shot.mjs 与人看），shot.mjs 轮询此标记再截图。
import '@/app.css';
import 'iconify-icon';
// [doc:adr-238] 与 core/main.ts 同款加载锚点：menus 子系统的桥接注册
// （registerSceneAction/registerUiAction）在模块顶层执行，模块不被 import 则永不注册。
import '@/menus/library-setup';
import { initI18n } from '@/core/i18n/locale';
import { dom } from '@/core/dom';
import { navActions } from '@/menus/nav-actions';

/**
 * 面板注册表：键 = 截图名，值 = 打开动作。
 * 值直接映射底栏 nav 按钮（navActions 走真实 toggleOverlay 链路：
 * visible 类 / inert / aria / setPopupOpen 全部同源，与真人点击唯一差异是没有按钮接线）。
 * 广场（navActions[7]）不收录：走 webviewLayer + 外网资源站，脱离「隔离渲染」语义。
 * 动作库（navActions[2]）不收录：buildRoot 链上读取 bootstrap 后才初始化的
 * 运行时状态（实测 pageerror: Cannot read properties of undefined (reading 'size')），
 * 隔离渲染修不动它，接进来只会天天假 FAIL——要看动作库布局走 e2e vitePage。
 */
const REGISTRY: Record<string, () => Promise<void> | void> = {
    library: () => navActions[1](),
    scene: () => navActions[3](),
    env: () => navActions[4](),
    settings: () => navActions[5](),
    assistant: () => navActions[8](),
};

// 清单单源出口：shot.mjs 打开无参页从这里读清单，勿在 shot.mjs 再抄一份（防清单漂移）。
(window as unknown as Record<string, unknown>).__harnessRegistry__ = Object.keys(REGISTRY);

function markError(msg: string): void {
    document.body.setAttribute('data-ready', '1');
    document.body.setAttribute('data-error', msg);
}

/** 轮询面板就绪：overlay 可见且菜单内容已渲染，上限 8s；再让两帧过渡动画落地后放行。 */
function waitPanelReady(): void {
    const deadline = Date.now() + 8000;
    const poll = (): void => {
        const overlay = dom.sceneOverlay;
        const hasContent =
            overlay.classList.contains('visible') && overlay.childElementCount > 0;
        if (hasContent || Date.now() > deadline) {
            requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                    document.body.setAttribute('data-ready', '1');
                    if (!hasContent) {
                        document.body.setAttribute(
                            'data-error',
                            'panel toggled but #sceneOverlay invisible/empty',
                        );
                    }
                }),
            );
            return;
        }
        setTimeout(poll, 100);
    };
    poll();
}

async function mount(name: string): Promise<void> {
    // harness 不跑 bootstrap()：真实 app 由 dom.showApp() 隐藏 loading 遮罩，
    // 此处直接放行（index.html 拷贝里已内联 display:none，此行兜底双保险）。
    dom.loadingEl.style.display = 'none';
    // i18n 初始化：预载语言包后再开面板，否则界面裸奔 i18n key（语言包
    // fetch public/locales/*.json，由 shot.mjs 先跑 generate-locale-json 生成）。
    await initI18n();
    const action = REGISTRY[name];
    if (action === undefined) {
        markError(`unknown panel: ${name}`);
        return;
    }
    try {
        await action();
    } catch (err) {
        markError(`panel action failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
    }
    waitPanelReady();
}

const name = new URLSearchParams(location.search).get('c') ?? 'library';
void mount(name);
