# Windows 桌面构建脚本
# 用法: .\scripts\build-windows.ps1 [-Production] [-Clean]
param(
    [switch]$Production,
    [switch]$Clean
)

$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptsDir\.." | Select-Object -ExpandProperty Path
$projectDir = "$repoRoot\"

# 读取版本号
$pkgJson = Get-Content "$repoRoot\package.json" -Raw | ConvertFrom-Json
$version = $pkgJson.version
Write-Output "[build-windows] 版本: $version"

# 同步 config.yml version（Wails 框架会读取此字段嵌入到 Windows 版本信息资源）
$configYml = "$projectDir\build\config.yml"
if (Test-Path $configYml) {
    $content = Get-Content $configYml -Raw
    $content = $content -replace '(?m)^(\s+version:\s*)"([^"]*)"', "`$1`"$version`""
    Set-Content $configYml $content -NoNewline
    Write-Output "[build-windows] 同步 config.yml version -> $version"
}

# 清理构建产物
if ($Clean) {
    Write-Output "[build-windows] 清理构建产物..."
    Remove-Item "$projectDir\bin" -Recurse -Force -ErrorAction SilentlyContinue
}

# 确保 dist 目录不存在旧产物
$distDir = "$repoRoot\dist"
if (Test-Path $distDir) {
    Remove-Item "$distDir\*" -Recurse -Force -ErrorAction SilentlyContinue
}

Set-Location $projectDir

# 前端构建
Write-Output "[build-windows] 构建前端..."
Set-Location frontend
npm ci --quiet
npx vite build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Set-Location $projectDir

# Go 编译
if ($Production) {
    $buildTags = "production"
} else {
    $buildTags = "debug"
}

Write-Output "[build-windows] 编译 Go (tags=$buildTags)..."
& wails3 build -tags $buildTags
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 重命名产物
$distDir = "$repoRoot\dist"
New-Item -ItemType Directory -Path $distDir -Force | Out-Null

$exeName = "MikuMikuAR.exe"
$srcExe = "$projectDir\bin\$exeName"
$dstExe = "$distDir\MikuMikuAR-$version-windows-amd64.exe"

if (Test-Path $srcExe) {
    Copy-Item $srcExe $dstExe -Force
    $size = (Get-Item $dstExe).Length / 1MB
    Write-Output ""
    Write-Output "[build-windows] 构建完成"
    Write-Output "   产物: $dstExe"
    Write-Output "   大小: $([math]::Round($size, 2)) MB"
} else {
    Write-Error "未找到构建产物: $srcExe"
    exit 1
}

Set-Location $repoRoot
