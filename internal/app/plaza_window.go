package app

import (
	"fmt"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"mikumikuar/internal/util"
)

// plazaDirectBridgeJS is injected into the plaza window when it navigates
// directly to a site's real origin (directNavigate=true, no proxy). SPA sites
// such as aplaybox.com open in-app pages via window.open / target=_blank; the
// WebView2 NewWindowRequested event is not exposed by Wails v3, so we intercept
// at the JS layer: same-site navigations are redirected to location.href (same
// WebView2 window, staying in-app), while cross-site ones (e.g. QQ login) fall
// back to Wails' default (system browser). Idempotent via __plazaDirectBridge.
const plazaDirectBridgeJS = `(function(){
  if (window.__plazaDirectBridge) return;
  window.__plazaDirectBridge = true;
  var isSameSite = function(u){
    try {
      var a = new URL(u, location.href);
      return a.origin === location.origin || a.hostname.endsWith('aplaybox.com');
    } catch(e){ return false; }
  };
  window.open = function(u){
    if (u && isSameSite(u)) { location.href = u; return null; }
    return null;
  };
  document.addEventListener('click', function(e){
    var el = e.target;
    while (el && el.tagName !== 'A') { el = el.parentElement; }
    if (el && el.href && el.target === '_blank' && isSameSite(el.href)) {
      e.preventDefault();
      location.href = el.href;
    }
  }, true);
})();`

// prewarmPlazaWindow creates a hidden WebView2 window at app startup so that
// the expensive Chromium renderer process is already warm when the user first
// opens a model-plaza site. Subsequent NavigatePlazaWindow calls reuse this
// single instance (SetURL + Show), reducing perceived latency from 1–3s
// (cold NewWithOptions) to ~200ms.
//
// The window intercepts WindowClosing via a RegisterHook (runs before the
// default destroy-listener) — pressing the X button hides the window instead
// of destroying it, keeping the renderer process alive for reuse.
func (a *App) prewarmPlazaWindow() {
	if a.wailsApp == nil {
		return
	}

	a.plazaWinMu.Lock()
	defer a.plazaWinMu.Unlock()

	win := a.wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:          "plaza:prewarmed",
		Title:         "模型广场",
		URL:           "about:blank",
		Width:         1200,
		Height:        800,
		Hidden:        true,
		HideOnEscape:  true,
		Windows: application.WindowsWindow{
			Theme: application.SystemDefault,
		},
	})

	if win == nil {
		a.safeLogError("prewarmPlazaWindow: failed to create prewarmed window")
		return
	}

	// Intercept WindowClosing: cancel the event (prevents the default
	// destroy-listener from running) and hide the window instead. This keeps
	// the WebView2 renderer process alive for instant reuse next time.
	// 保存 unregister 函数，供 ServiceShutdown 在退出前移除 hook 以彻底关闭窗口。
	a.plazaWinCloseHook = win.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		event.Cancel()
		win.Hide()
	})

	// [ADR-087 P1/P3] 导航完成时上报 URL 变化。ExecJS 发送 fetch 到 /__plaza_url__，
	// Go 端 handler 取 lastForwardedTarget（真实站点 URL）合并后 Emit 给前端。
	// 加 debounce 300ms 避免 SPA/iframe 切换高频触发。
	win.OnWindowEvent(events.Windows.WebViewNavigationCompleted, func(event *application.WindowEvent) {
		// [doc:plaza-spa] 直连模式下注入 window.open 拦截桥：同源链接改为同窗口
		// 导航（in-app 连续浏览），跨站（如 QQ 登录）保持 Wails 默认（系统浏览器）。
		if a.plazaDirectMode.Load() {
			win.ExecJS(plazaDirectBridgeJS)
		}
		if time.Since(a.lastPlazaNavReport) < 300*time.Millisecond {
			return
		}
		a.lastPlazaNavReport = time.Now()
		win.ExecJS(`fetch(location.origin+'/__plaza_url__',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:document.title})}).catch(function(){})`)
	})

	a.plazaWin = win
	a.safeLogInfo("prewarmPlazaWindow: prewarmed window created (name=plaza:prewarmed)")
}

// NavigatePlazaWindow navigates the prewarmed WebView2 window to the given
// site URL and shows it. Reuses a single hidden window instance created at
// startup, avoiding the 1–3s WebView2 cold-start cost of NewWithOptions per
// call.
//
// [ADR-087 P0] The window normally navigates to the local reverse-proxy URL
// (not the raw target) so the injected download-intercept script can fetch
// /__plaza_dl__ same-origin to trigger DownloadFromPlaza. StartProxy is
// called with mode="window" so plazaInjectScript emits the fetch variant.
//
// [doc:plaza-spa] When direct==true the window navigates straight to targetURL
// (real origin, no proxy). This is required for SPA sites that fetch a separate
// API domain (e.g. aplaybox.com → api.aplaybox.com): going through the proxy
// would make the page origin 127.0.0.1:PORT, and the API's CORS preflight
// fails (no Access-Control-Allow-Origin for that origin), leaving only a loading
// shell. Direct navigation restores the real origin so the API CORS whitelist
// passes. Trade-off: download interception (/__plaza_dl__) is unavailable in
// direct mode; such sites fall back to system-browser download + fsnotify
// (ADR-003).
func (a *App) NavigatePlazaWindow(targetURL string, direct bool) error {
	a.plazaWinMu.Lock()
	defer a.plazaWinMu.Unlock()

	if a.plazaWin == nil {
		return fmt.Errorf("plaza window not prewarmed")
	}
	if targetURL == "" {
		return fmt.Errorf("empty URL")
	}

	a.plazaDirectMode.Store(direct)

	if direct {
		// [doc:plaza-spa] 直连真实域名：修复独立 API 域 SPA 经代理后 origin
		// =127.0.0.1:PORT 触发 api CORS 白屏的问题。
		a.plazaWin.SetURL(targetURL)
		a.plazaWin.SetTitle("模型广场 — " + targetURL)
		a.plazaWin.Show()
		a.plazaWin.Focus()
		a.safeLogInfo("NavigatePlazaWindow: %s (direct, no proxy)", targetURL)
		return nil
	}

	// 走代理桥接：注入脚本才能 fetch /__plaza_dl__ 拦截下载（ADR-087 P0）。
	// StartProxy 内部获取 httpSrvMu，与 plazaWinMu 不构成反向锁序，安全。
	proxyURL, err := a.StartProxy(targetURL, "window")
	if err != nil {
		return fmt.Errorf("start proxy for %q: %w", targetURL, err)
	}

	a.plazaWin.SetURL(proxyURL)
	a.plazaWin.SetTitle("模型广场 — " + targetURL)
	a.plazaWin.Show()
	a.plazaWin.Focus()

	a.safeLogInfo("NavigatePlazaWindow: %s (via %s)", targetURL, proxyURL)
	return nil
}

// ClosePlazaWindow hides the prewarmed plaza window without destroying it,
// keeping the WebView2 renderer process warm for instant reuse. It also stops
// the window-mode reverse proxy started by NavigatePlazaWindow so the Go
// http.Server and its port are released (ADR-087 P0).
func (a *App) ClosePlazaWindow() error {
	a.plazaWinMu.Lock()
	if a.plazaWin != nil {
		a.plazaWin.Hide()
	}
	a.plazaWinMu.Unlock()
	// 释放 window 模式独占代理（幂等，无代理时无操作）。在锁外调用避免长
	// 期持有 plazaWinMu 等待 srv.Shutdown 超时。
	_ = a.StopProxy()
	return nil
}

// plazaCall is a helper that acquires plazaWinMu, checks the window is ready,
// and calls the given function. It is used by all Plaza* methods to avoid
// repeating the lock/nil-check boilerplate.
func (a *App) plazaCall(fn func(*application.WebviewWindow)) error {
	return util.SafeCallVoid(func() error {
		a.plazaWinMu.Lock()
		defer a.plazaWinMu.Unlock()
		if a.plazaWin == nil {
			return fmt.Errorf("plaza window not ready")
		}
		fn(a.plazaWin)
		return nil
	})
}

// PlazaGoBack navigates the plaza window history backward.
func (a *App) PlazaGoBack() error {
	return a.plazaCall(func(w *application.WebviewWindow) {
		w.ExecJS("history.back()")
	})
}

// PlazaGoForward navigates the plaza window history forward (ADR-087 P0).
func (a *App) PlazaGoForward() error {
	return a.plazaCall(func(w *application.WebviewWindow) {
		w.ExecJS("history.forward()")
	})
}

// PlazaReload reloads the current page in the plaza window (ADR-087 P0).
func (a *App) PlazaReload() error {
	return a.plazaCall(func(w *application.WebviewWindow) {
		w.Reload()
	})
}

// PlazaZoomIn / PlazaZoomOut / PlazaZoomReset control page zoom of the plaza
// window. These map directly to WebView2's zoom API (ADR-087 P0).
func (a *App) PlazaZoomIn() error {
	return a.plazaCall(func(w *application.WebviewWindow) {
		w.ZoomIn()
	})
}

func (a *App) PlazaZoomOut() error {
	return a.plazaCall(func(w *application.WebviewWindow) {
		w.ZoomOut()
	})
}

func (a *App) PlazaZoomReset() error {
	return a.plazaCall(func(w *application.WebviewWindow) {
		w.ZoomReset()
	})
}
