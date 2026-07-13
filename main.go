package main

import (
	"embed"
	"log"
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
	"mikumikuar/internal/app"
)

// AppVersion is injected via -ldflags "-X main.AppVersion=..." at build time.
var AppVersion = "dev"

// BuildTime / CommitHash / GoVersion are injected the same way for diagnostics.
var BuildTime = "unknown"
var CommitHash = "unknown"

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	myApp := app.NewApp(AppVersion, BuildTime, CommitHash)

	wailsApp := application.New(application.Options{
		Name:        "MikuMikuAR",
		Description: "PMX Player with physics simulation",
		Services: []application.Service{
			application.NewService(myApp),
		},
		Assets: application.AssetOptions{
			// [doc:adr-099] Wrap with COOP/COEP so the top-level
			// document is cross-origin isolated → SharedArrayBuffer available
			// for MmdWasmInstanceTypeMPR. Gated by VITE_MMD_WASM_MT.
			Handler: app.CoopCoepMiddleware(application.AssetFileServerFS(assets)),
		},
		Windows: application.WindowsOptions{
			// E2E hook: when MMCAR_DEBUG_PORT is set, expose the WebView2
			// remote-debugging port so Playwright connectOverCDP (@webgl specs)
			// can attach. Wails v3 sets AdditionalBrowserArgs explicitly, which
			// suppresses the WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS env var, so
			// we must inject the flag here. Default (unset) ships no debug port.
			AdditionalBrowserArgs: e2eDebugBrowserArgs(),
		},
	})

	wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "MikuMikuAR — PMX 播放器",
		Width:            1280,
		Height:           800,
		MinWidth:         800,
		MinHeight:        600,
		BackgroundColour: application.NewRGBA(30, 30, 40, 255),
		URL:              "/",
	})

	myApp.SetWailsApp(wailsApp)

	err := wailsApp.Run()
	if err != nil {
		log.Fatal(err)
	}
}

// e2eDebugBrowserArgs enables the WebView2 remote-debugging port for E2E when
// MMCAR_DEBUG_PORT is set (e.g. by start-e2e.ps1). Returns nil otherwise so the
// debug port is never exposed in normal/production runs.
func e2eDebugBrowserArgs() []string {
	if port := os.Getenv("MMCAR_DEBUG_PORT"); port != "" {
		return []string{"--remote-debugging-port=" + port}
	}
	return nil
}
