# Start Wails dev with WebView2 remote debugging enabled for Playwright E2E tests.
# Run this script from the project root BEFORE running `npm run test:e2e`.
#
# Mechanism: Wails v3 sets WebView2 AdditionalBrowserArgs explicitly, which
# SUPPRESSES the WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS env var. So we enable the
# debug port via MMCAR_DEBUG_PORT, which main.go reads and injects into
# application.Options.Windows.AdditionalBrowserArgs.

# --- Kill stale WebView2 processes ---
# WebView2 reuses one browser process per user-data-folder; browser args (incl.
# the debug port) are only read when that process is FIRST created. A leftover
# msedgewebview2.exe from a previous run would be reused and ignore our flag.
# NOTE: this kills ALL WebView2-based apps on the machine (VS Code webviews,
# other Wails apps, etc.). On a dev box this is acceptable; restart them after.
$stale = Get-Process -Name msedgewebview2 -ErrorAction SilentlyContinue
if ($stale) {
    Write-Host "Killing $($stale.Count) stale msedgewebview2.exe process(es)..."
    $stale | Stop-Process -Force
    Start-Sleep -Seconds 1
}

$env:MMCAR_DEBUG_PORT = '9222'
Write-Host "MMCAR_DEBUG_PORT set to 9222 (main.go injects --remote-debugging-port)"
Write-Host "Starting wails3 dev..."
wails3 dev
