# Android .so 编译脚本 (Windows PowerShell)
# 用法: .\scripts\build-android-so.ps1 -Arch arm64|amd64 -Production $false
param(
    [ValidateSet("arm64", "amd64", "x86_64")]
    [string]$Arch = "arm64",
    [switch]$Production
)

# 解析项目目录（脚本位于仓库根目录的 scripts/ 下）
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Resolve-Path "$scriptsDir\.." | Select-Object -ExpandProperty Path

# SDK / NDK 自动定位
$sdkDir = [Environment]::GetEnvironmentVariable("ANDROID_HOME", "User")
if (-not $sdkDir) { $sdkDir = [Environment]::GetEnvironmentVariable("ANDROID_SDK_ROOT", "User") }
if (-not $sdkDir) { $sdkDir = "C:\Android\Sdk" }

$ndkDir = [Environment]::GetEnvironmentVariable("ANDROID_NDK_HOME", "User")
if (-not $ndkDir -and (Test-Path "$sdkDir\ndk")) {
    $ndkDir = Get-ChildItem "$sdkDir\ndk" -Directory | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
}

if (-not $ndkDir) {
    Write-Error "Android NDK not found. Set ANDROID_NDK_HOME or install via sdkmanager."
    exit 1
}

$toolchain = "$ndkDir\toolchains\llvm\prebuilt\windows-x86_64"
$minSdk = "21"

if ($Arch -eq "arm64") {
    $CC = "$toolchain\bin\aarch64-linux-android$minSdk-clang.cmd"
    $CXX = "$toolchain\bin\aarch64-linux-android$minSdk-clang++.cmd"
    $GOARCH = "arm64"
    $jniDir = "arm64-v8a"
} else {
    $CC = "$toolchain\bin\x86_64-linux-android$minSdk-clang.cmd"
    $CXX = "$toolchain\bin\x86_64-linux-android$minSdk-clang++.cmd"
    $GOARCH = "amd64"
    $jniDir = "x86_64"
}

$outputDir = "$projectDir\build\android\app\src\main\jniLibs\$jniDir"
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

$env:CGO_ENABLED = "1"
$env:GOOS = "android"
$env:GOARCH = $GOARCH
$env:CC = $CC
$env:CXX = $CXX

$buildFlags = if ($Production) {
    @("-tags", "production,android", "-trimpath", "-buildvcs=false")
} else {
    @("-tags", "android,debug", "-buildvcs=false", "-gcflags=all=-l")
}

$overlayJson = "$projectDir\build\android\overlay.json"
if (-not (Test-Path $overlayJson)) {
    Write-Error "overlay.json not found. Run 'wails3 android overlay:gen' first."
    exit 1
}

$startDir = Get-Location
Set-Location $projectDir

try {
    Write-Output "[build-android-so] 编译 Go -> libwails.so ($Arch)..."
    & go build -buildmode=c-shared -overlay $overlayJson $buildFlags -o "$outputDir\libwails.so" 2>&1
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Set-Location $startDir
}

Write-Output "[build-android-so] 完成: $outputDir\libwails.so"
