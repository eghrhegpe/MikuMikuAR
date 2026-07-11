package app

import (
	"fmt"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"mikumikuar/internal/util"
)

// openPlazaWindows tracks all open model-plaza windows by unique names.
// plazaWindowSeq provides incrementing sequence numbers so each window gets
// a distinct name (no dedup — each call opens a separate tab).
// Max concurrent plaza windows is capped at 5.
var (
	openPlazaWindowsMu sync.Mutex
	openPlazaWindows   []string
	plazaWindowSeq     int
)

// sweepClosedPlazaWindows removes names of windows that have been closed or
// destroyed from the tracking list, so the 5-window cap stays accurate.
func sweepClosedPlazaWindows(app *application.App) {
	alive := make([]string, 0, len(openPlazaWindows))
	for _, name := range openPlazaWindows {
		if _, ok := app.Window.GetByName(name); ok {
			alive = append(alive, name)
		}
	}
	openPlazaWindows = alive
}

// OpenPlazaWindow opens a new Wails v3 window with the given URL.
// This provides a full Chromium WebView2 instance that bypasses
// iframe CSP/X-Frame-Options restrictions (ADR-075 §独立浏览器窗口).
// Each call opens an independent window (no dedup), capped at 5 concurrent.
func (a *App) OpenPlazaWindow(targetURL string) error {
	return util.SafeCallVoid(func() error {
		if a.wailsApp == nil {
			return fmt.Errorf("wails app not initialized")
		}
		if targetURL == "" {
			return fmt.Errorf("empty URL")
		}

		// Acquire a unique window name under the 5-window cap
		openPlazaWindowsMu.Lock()
		sweepClosedPlazaWindows(a.wailsApp)
		if len(openPlazaWindows) >= 5 {
			openPlazaWindowsMu.Unlock()
			return fmt.Errorf("已达窗口上限（5），请先关闭已打开的模型广场窗口")
		}
		plazaWindowSeq++
		name := fmt.Sprintf("plaza:%d", plazaWindowSeq)
		openPlazaWindows = append(openPlazaWindows, name)
		openPlazaWindowsMu.Unlock()

		win := a.wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
			Name:   name,
			Title:  "模型广场 — " + targetURL,
			URL:    targetURL,
			Width:  1200,
			Height: 800,
			Windows: application.WindowsWindow{
				Theme: application.SystemDefault,
			},
		})

		if win == nil {
			// Creation failed — remove from tracking
			openPlazaWindowsMu.Lock()
			for i, n := range openPlazaWindows {
				if n == name {
					openPlazaWindows = append(openPlazaWindows[:i], openPlazaWindows[i+1:]...)
					break
				}
			}
			openPlazaWindowsMu.Unlock()
			return fmt.Errorf("failed to create window")
		}

		a.safeLogInfo("OpenPlazaWindow: %s (name=%s, total=%d)", targetURL, name, len(openPlazaWindows))
		return nil
	})
}
