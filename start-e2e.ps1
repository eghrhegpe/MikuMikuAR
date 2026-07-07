# Start Wails dev with WebView2 remote debugging enabled for Playwright E2E tests.
# Run this script from the project root BEFORE running `npm run test:e2e`.
#
# Mechanism: Wails v3 sets WebView2 AdditionalBrowserArgs explicitly, which
# SUPPRESSES the WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS env var. So we enable the
# debug port via MMCAR_DEBUG_PORT, which main.go reads and injects into
# application.Options.Windows.AdditionalBrowserArgs.

# --- Kill stale WebView2 / Chromium processes ---
# WebView2 reuses one browser process per user-data-folder; browser args (incl.
# the debug port) are only read when that process is FIRST created. A leftover
# msedgewebview2.exe from a previous run would be reused and ignore our flag.
# Also kill msedge.exe / chrome.exe which may hold port 9222 from previous runs.
# NOTE: this kills ALL WebView2-based apps on the machine (VS Code webviews,
# other Wails apps, etc.) plus any Edge/Chrome. On a dev box this is acceptable;
# restart them after.
$stalePids = @()
foreach ($name in @('msedgewebview2', 'msedge', 'chrome')) {
    $procs = Get-Process -Name $name -ErrorAction SilentlyContinue
    if ($procs) {
        $stalePids += $procs.Id
        Write-Host "Killing $($procs.Count) stale $name.exe process(es)..."
        $procs | Stop-Process -Force
    }
}
if ($stalePids.Count -gt 0) {
    Start-Sleep -Seconds 1.5
}

# --- Pre-flight: verify port 9222 is free ---
# Use Select-String on raw text, filtering with ' :9222 ' (spaces around port) to avoid
# false matches on port 92220 etc. Extract unique PIDs via pattern-matched lines.
$rawNetstat = netstat -ano | Select-String ':\b9222\b'
if ($rawNetstat) {
    Write-Host "WARNING: Port 9222 is still in use after killing stale processes. Attempting force-clean..."
    $badPids = $rawNetstat | ForEach-Object { ($_ -split '\s+')[-1] } | Select-Object -Unique
    foreach ($pid in $badPids) {
        if ($pid -and $pid -ne '0') {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 1
}

# --- Check: ensure port 9222 is really free before proceeding ---
$stillBusy = netstat -ano | Select-String ':\b9222\b'
if ($stillBusy) {
    Write-Host "ERROR: Port 9222 is still occupied by another process. E2E tests will fail."
    Write-Host "Manually find and kill the process holding port 9222, then re-run."
    exit 1
} else {
    Write-Host "Port 9222 confirmed free."
}

$env:MMCAR_DEBUG_PORT = '9222'
Write-Host "`nMMCAR_DEBUG_PORT set to 9222 (main.go injects --remote-debugging-port)"
Write-Host "Starting wails3 dev...`n"
Write-Host "After wails3 dev is up, verify CDP endpoint in another terminal:"
Write-Host "  Invoke-WebRequest http://127.0.0.1:9222/json/version"
wails3 dev
