package app

import (
	"fmt"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"mikumikuar/internal/util"
)

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
	win.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		event.Cancel()
		win.Hide()
	})

	// [ADR-087 P1/P3] 导航完成时上报 URL 变化。ExecJS 发送 fetch 到 /__plaza_url__，
	// Go 端 handler 取 lastForwardedTarget（真实站点 URL）合并后 Emit 给前端。
	// 加 debounce 300ms 避免 SPA/iframe 切换高频触发。
	win.OnWindowEvent(events.Windows.WebViewNavigationCompleted, func(event *application.WindowEvent) {
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
// [ADR-087 P0] The window navigates to the local reverse-proxy URL (not the
// raw target) so the injected download-intercept script can fetch
// /__plaza_dl__ same-origin to trigger DownloadFromPlaza. StartProxy is
// called with mode="window" so plazaInjectScript emits the fetch variant.
func (a *App) NavigatePlazaWindow(targetURL string) error {
	a.plazaWinMu.Lock()
	defer a.plazaWinMu.Unlock()

	if a.plazaWin == nil {
		return fmt.Errorf("plaza window not prewarmed")
	}
	if targetURL == "" {
		return fmt.Errorf("empty URL")
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

// PlazaGoBack navigates the plaza window history backward. No-op if the
// window is not ready. ExecJS runs the browser's history.back() which is
// async and returns before navigation completes (ADR-087 P0).
func (a *App) PlazaGoBack() error {
	return util.SafeCallVoid(func() error {
		a.plazaWinMu.Lock()
		defer a.plazaWinMu.Unlock()
		if a.plazaWin == nil {
			return fmt.Errorf("plaza window not ready")
		}
		a.plazaWin.ExecJS("history.back()")
		return nil
	})
}

// PlazaGoForward navigates the plaza window history forward (ADR-087 P0).
func (a *App) PlazaGoForward() error {
	return util.SafeCallVoid(func() error {
		a.plazaWinMu.Lock()
		defer a.plazaWinMu.Unlock()
		if a.plazaWin == nil {
			return fmt.Errorf("plaza window not ready")
		}
		a.plazaWin.ExecJS("history.forward()")
		return nil
	})
}

// PlazaReload reloads the current page in the plaza window (ADR-087 P0).
func (a *App) PlazaReload() error {
	return util.SafeCallVoid(func() error {
		a.plazaWinMu.Lock()
		defer a.plazaWinMu.Unlock()
		if a.plazaWin == nil {
			return fmt.Errorf("plaza window not ready")
		}
		a.plazaWin.Reload()
		return nil
	})
}

// PlazaZoomIn / PlazaZoomOut / PlazaZoomReset control page zoom of the plaza
// window. These map directly to WebView2's zoom API (ADR-087 P0).
func (a *App) PlazaZoomIn() error {
	return util.SafeCallVoid(func() error {
		a.plazaWinMu.Lock()
		defer a.plazaWinMu.Unlock()
		if a.plazaWin == nil {
			return fmt.Errorf("plaza window not ready")
		}
		a.plazaWin.ZoomIn()
		return nil
	})
}

func (a *App) PlazaZoomOut() error {
	return util.SafeCallVoid(func() error {
		a.plazaWinMu.Lock()
		defer a.plazaWinMu.Unlock()
		if a.plazaWin == nil {
			return fmt.Errorf("plaza window not ready")
		}
		a.plazaWin.ZoomOut()
		return nil
	})
}

func (a *App) PlazaZoomReset() error {
	return util.SafeCallVoid(func() error {
		a.plazaWinMu.Lock()
		defer a.plazaWinMu.Unlock()
		if a.plazaWin == nil {
			return fmt.Errorf("plaza window not ready")
		}
		a.plazaWin.ZoomReset()
		return nil
	})
}
