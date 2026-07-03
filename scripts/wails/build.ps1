# MikuMikuAR 构建验证脚本
# 用法: pwsh scripts/build.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "=== 0/5 前置依赖检查 ===" -ForegroundColor Cyan
Push-Location $root
try {
    $missing = @()

    # Go
    $go = Get-Command go -ErrorAction SilentlyContinue
    if (-not $go) {
        $missing += "go"
    } else {
        $ver = (go version) -replace '.*go(\d+\.\d+).*','$1'
        $major, $minor = $ver -split '\.'
        if ([int]$major -lt 1 -or ([int]$major -eq 1 -and [int]$minor -lt 25)) {
            Write-Host "WARNING: Go $ver detected, Wails 3 requires Go 1.25+" -ForegroundColor Yellow
        }
    }

    # Node.js + npm
    $node = Get-Command node -ErrorAction SilentlyContinue
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $node) { $missing += "node" }
    if (-not $npm)  { $missing += "npm" }

    # wails3 CLI
    $wails = Get-Command wails3 -ErrorAction SilentlyContinue
    if (-not $wails) { $missing += "wails3" }

    if ($missing.Count -gt 0) {
        Write-Host "ERROR: Missing required tools: $($missing -join ', ')" -ForegroundColor Red
        Write-Host "  Go:       https://go.dev/dl/" -ForegroundColor Gray
        Write-Host "  Node/npm: https://nodejs.org/" -ForegroundColor Gray
        Write-Host "  wails3:   go install github.com/wailsapp/wails/v3/cmd/wails3@latest" -ForegroundColor Gray
        exit 1
    }

    # Frontend dependencies
    $nodeModules = Join-Path $root "frontend\node_modules"
    if (-not (Test-Path $nodeModules)) {
        Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
        Push-Location (Join-Path $root "frontend")
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
        Pop-Location
    }

    # appicon.png (needed for icon generation)
    if (-not (Test-Path (Join-Path $root "build\appicon.png"))) {
        Write-Host "ERROR: build\appicon.png not found" -ForegroundColor Red
        exit 1
    }

    Write-Host "All prerequisites satisfied." -ForegroundColor Green
} finally { Pop-Location }

Write-Host "`n=== 1/5 契约测试 ===" -ForegroundColor Cyan
Push-Location $root
try {
    python tests/test_config_syntax.py
    if ($LASTEXITCODE -ne 0) { throw "契约测试失败" }
    Write-Host "契约测试通过" -ForegroundColor Green
} finally { Pop-Location }

Write-Host "`n=== 2/5 Go 测试 ===" -ForegroundColor Cyan
Push-Location $root
try {
    go test ./...
    if ($LASTEXITCODE -ne 0) { throw "Go 测试失败" }
    Write-Host "Go 测试通过" -ForegroundColor Green
} finally { Pop-Location }

Write-Host "`n=== 3/5 Go 编译 ===" -ForegroundColor Cyan
Push-Location $root
try {
    go build .
    if ($LASTEXITCODE -ne 0) { throw "Go 编译失败" }
    Write-Host "Go 编译通过" -ForegroundColor Green
} finally { Pop-Location }

Write-Host "`n=== 4/5 前端构建 ===" -ForegroundColor Cyan
Push-Location (Join-Path $root "frontend")
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "前端构建失败" }
    Write-Host "前端构建通过" -ForegroundColor Green
} finally { Pop-Location }

Write-Host "`n=== 5/5 产物校验 ===" -ForegroundColor Cyan
$exePath = Join-Path $root "bin\MikuMikuAR.exe"
if (Test-Path $exePath) {
    $size = (Get-Item $exePath).Length / 1MB
    Write-Host "Binary: $exePath ($([math]::Round($size, 1)) MB)" -ForegroundColor Green
} else {
    Write-Host "WARNING: bin\MikuMikuAR.exe not found after build" -ForegroundColor Yellow
}

Write-Host "`n=== ALL PASSED ===" -ForegroundColor Green
