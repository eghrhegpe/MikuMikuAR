# MikuMikuAR 构建验证脚本
# 用法: pwsh scripts/build.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "=== 1/4 契约测试 ===" -ForegroundColor Cyan
Push-Location $root
try {
    python3 tests/test_config_syntax.py
    if ($LASTEXITCODE -ne 0) { throw "契约测试失败" }
    Write-Host "契约测试通过" -ForegroundColor Green
} finally { Pop-Location }

Write-Host "`n=== 2/4 Go 测试 ===" -ForegroundColor Cyan
Push-Location $root
try {
    go test ./...
    if ($LASTEXITCODE -ne 0) { throw "Go 测试失败" }
    Write-Host "Go 测试通过" -ForegroundColor Green
} finally { Pop-Location }

Write-Host "`n=== 3/4 Go 编译 ===" -ForegroundColor Cyan
Push-Location $root
try {
    go build .
    if ($LASTEXITCODE -ne 0) { throw "Go 编译失败" }
    Write-Host "Go 编译通过" -ForegroundColor Green
} finally { Pop-Location }

Write-Host "`n=== 4/4 前端构建 ===" -ForegroundColor Cyan
Push-Location (Join-Path $root "frontend")
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "前端构建失败" }
    Write-Host "前端构建通过" -ForegroundColor Green
} finally { Pop-Location }

Write-Host "`n=== ✅ 全部通过 ===" -ForegroundColor Green
