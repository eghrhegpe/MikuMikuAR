# Android .so 编译脚本 (Windows PowerShell)
param(
    [string]$Arch = "arm64",
    [bool]$Production = $false
)

$sdkDir = [Environment]::GetEnvironmentVariable("ANDROID_HOME", "User")
if (-not $sdkDir) { $sdkDir = "C:\Android\Sdk" }

$ndkDir = [Environment]::GetEnvironmentVariable("ANDROID_NDK_HOME", "User")
if (-not $ndkDir) {
    $ndkDir = Get-ChildItem "$sdkDir\ndk" -Directory | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
}

if (-not $ndkDir) {
    Write-Error "Android NDK not found. Set ANDROID_NDK_HOME or install via sdkmanager."
    exit 1
}

Write-Output "SDK: $sdkDir"
Write-Output "NDK: $ndkDir"

$toolchain = "$ndkDir\toolchains\llvm\prebuilt\windows-x86_64"
$minSdk = "21"

if ($Arch -eq "arm64") {
    $CC = "$toolchain\bin\aarch64-linux-android$minSdk-clang.cmd"
    $CXX = "$toolchain\bin\aarch64-linux-android$minSdk-clang++.cmd"
    $GOARCH = "arm64"
    $jniDir = "arm64-v8a"
} elseif ($Arch -eq "amd64" -or $Arch -eq "x86_64") {
    $CC = "$toolchain\bin\x86_64-linux-android$minSdk-clang.cmd"
    $CXX = "$toolchain\bin\x86_64-linux-android$minSdk-clang++.cmd"
    $GOARCH = "amd64"
    $jniDir = "x86_64"
} else {
    Write-Error "Unsupported architecture: $Arch"
    exit 1
}

$projectDir = "c:\Users\zhujieling11\MikuMikuAR\MikuMikuAR"
$outputDir = "$projectDir\build\android\app\src\main\jniLibs\$jniDir"

# 创建输出目录
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

$env:CGO_ENABLED = "1"
$env:GOOS = "android"
$env:GOARCH = $GOARCH
$env:CC = $CC
$env:CXX = $CXX

$buildFlags = if ($Production) {
    "-tags production,android -trimpath -buildvcs=false"
} else {
    "-tags android,debug -buildvcs=false -gcflags=all=-l"
}

Write-Output "编译 Go -> libwails.so ($Arch)..."
$overlayJson = "$projectDir\build\android\overlay.json"

& go build -buildmode=c-shared -overlay $overlayJson $buildFlags.Split() -o "$outputDir\libwails.so" 2>&1

Write-Output "完成: $outputDir\libwails.so"