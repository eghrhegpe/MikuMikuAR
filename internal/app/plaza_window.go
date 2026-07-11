package app

import (
	"fmt"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
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

	a.plazaWin = win
	a.safeLogInfo("prewarmPlazaWindow: prewarmed window created (name=plaza:prewarmed)")
}

// NavigatePlazaWindow navigates the prewarmed WebView2 window to the given URL
// and shows it. Reuses a single hidden window instance created at startup,
// avoiding the 1–3s WebView2 cold-start cost of NewWithOptions per call.
func (a *App) NavigatePlazaWindow(targetURL string) error {
	a.plazaWinMu.Lock()
	defer a.plazaWinMu.Unlock()

	if a.plazaWin == nil {
		return fmt.Errorf("plaza window not prewarmed")
	}
	if targetURL == "" {
		return fmt.Errorf("empty URL")
	}

	a.plazaWin.SetURL(targetURL)
	a.plazaWin.SetTitle("模型广场 — " + targetURL)
	a.plazaWin.Show()
	a.plazaWin.Focus()

	a.safeLogInfo("NavigatePlazaWindow: %s", targetURL)
	return nil
}

// ClosePlazaWindow hides the prewarmed plaza window without destroying it,
// keeping the WebView2 renderer process warm for instant reuse.
func (a *App) ClosePlazaWindow() error {
	a.plazaWinMu.Lock()
	defer a.plazaWinMu.Unlock()

	if a.plazaWin == nil {
		return nil
	}
	a.plazaWin.Hide()
	return nil
}
