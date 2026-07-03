# Android 一键构建脚本 (Windows PowerShell)
# 用法: .\scripts\build-android.ps1 -Arch arm64|amd64|all -Production -Clean
param(
    [ValidateSet("arm64", "amd64", "x86_64", "all")]
    [string]$Arch = "arm64",
    [switch]$Production,
    [switch]$Clean
)

$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptsDir\.." | Select-Object -ExpandProperty Path
$projectDir = "$repoRoot\MikuMikuAR"
$androidDir = "$projectDir\build\android"
$apkDir = "$androidDir\app\build\outputs\apk"

Set-Location $projectDir

# 清理
if ($Clean) {
    Write-Output "[build-android] 清理构建产物..."
    Remove-Item "$androidDir\app\build" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item "$androidDir\.gradle" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item "$androidDir\app\src\main\jniLibs" -Recurse -Force -ErrorAction SilentlyContinue
}

# 生成 overlay.json
$overlayJson = "$androidDir\overlay.json"
if (-not (Test-Path $overlayJson)) {
    Write-Output "[build-android] 生成 Android overlay..."
    & wails3 android overlay:gen -out $overlayJson -config build/config.yml
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# 编译 .so
$archs = if ($Arch -eq "all") { @("arm64", "amd64") } else { @($Arch) }
foreach ($a in $archs) {
    & "$scriptsDir\build-android-so.ps1" -Arch $a -Production:$Production
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# Gradle 打包
$gradleTask = if ($Production) { "assembleRelease" } else { "assembleDebug" }
Write-Output "[build-android] Gradle 打包: $gradleTask ..."
Set-Location $androidDir
& .\gradlew.bat $gradleTask 2>&1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 输出产物路径
$flavor = if ($Production) { "release" } else { "debug" }
$apkPath = "$apkDir\$flavor\app-$flavor.apk"
Write-Output ""
Write-Output "✅ Android 构建完成"
Write-Output "   APK: $apkPath"
if (Test-Path $apkPath) {
    $size = (Get-Item $apkPath).Length / 1MB
    Write-Output "   大小: $([math]::Round($size, 2)) MB"
}

Set-Location $repoRoot
