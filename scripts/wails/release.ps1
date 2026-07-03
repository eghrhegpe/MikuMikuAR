# MikuMikuAR 正式构建脚本
# 用法: pwsh scripts/release.ps1
# 生成带调试符号剥离的优化二进制

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "=== 1/3 Go 测试 ===" -ForegroundColor Cyan
Push-Location $root
try {
    go test ./...
    if ($LASTEXITCODE -ne 0) { throw "Go 测试失败" }
    Write-Host "Go 测试通过" -ForegroundColor Green
} finally { Pop-Location }

Write-Host "`n=== 2/3 Go 正式编译 (ldflags=-s -w) ===" -ForegroundColor Cyan
Push-Location $root
try {
    go build -ldflags="-s -w" -o "build\MikuMikuAR.exe" .
    if ($LASTEXITCODE -ne 0) { throw "Go 编译失败" }
    Write-Host "Go 编译通过" -ForegroundColor Green
} finally { Pop-Location }

Write-Host "`n=== 3/3 前端构建 ===" -ForegroundColor Cyan
Push-Location (Join-Path $root "frontend")
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "前端构建失败" }
    Write-Host "前端构建通过" -ForegroundColor Green
} finally { Pop-Location }

Write-Host "`n=== ✅ Release 构建完成 ===" -ForegroundColor Green
