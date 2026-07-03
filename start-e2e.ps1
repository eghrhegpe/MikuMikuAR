# Start Wails dev with WebView2 remote debugging enabled for Playwright E2E tests.
# Run this script from the project root BEFORE running `npm run test:e2e`.

$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
Write-Host "WebView2 remote debugging port set to 9222"
Write-Host "Starting wails dev..."
wails dev
