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
$projectDir = "$repoRoot\"
$androidDir = "$projectDir\build\android"
$apkDir = "$androidDir\app\build\outputs\apk"

# 读取版本号
$pkgJson = Get-Content "$repoRoot\package.json" -Raw | ConvertFrom-Json
$version = $pkgJson.version
Write-Output "[build-android] 版本: $version"

# 同步 config.yml version
$configYml = "$projectDir\build\config.yml"
if (Test-Path $configYml) {
    $content = Get-Content $configYml -Raw
    $content = $content -replace '(?m)^(\s+version:\s*)"([^"]*)"', "`$1`"$version`""
    Set-Content $configYml $content -NoNewline
    Write-Output "[build-android] 同步 config.yml version -> $version"
}

Set-Location $projectDir

# 清理
if ($Clean) {
    Write-Output "[build-android] 清理构建产物..."
    Remove-Item "$androidDir\app\build" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item "$androidDir\.gradle" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item "$androidDir\app\src\main\jniLibs" -Recurse -Force -ErrorAction SilentlyContinue
}

# 前端构建（跳过 npm ci 避免 Windows 文件锁问题）
Write-Output "[build-android] 构建前端..."
Set-Location frontend
if (-not (Test-Path "node_modules\vite\index.js")) {
    Write-Output "[build-android] node_modules 不存在，执行 npm ci..."
    npm ci --quiet
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    Write-Output "[build-android] node_modules 已就绪，跳过 npm ci"
}
npx vite build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Set-Location $projectDir

# 前端产物拷贝到 Android assets
$assetsDir = "$androidDir\app\src\main\assets"
if (Test-Path $assetsDir) {
    Remove-Item "$assetsDir\*" -Recurse -Force -ErrorAction SilentlyContinue
} else {
    New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null
}
Copy-Item "frontend\dist\*" $assetsDir -Recurse -Force
Write-Output "[build-android] Android assets 已更新"

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

if ($Production) {
    $keystoreFile = "$androidDir\keystore\release.keystore"
    if (-not (Test-Path $keystoreFile)) {
        Write-Error "keystore 文件不存在: $keystoreFile"
        exit 1
    }

    $storePass = [Environment]::GetEnvironmentVariable("ANDROID_KEYSTORE_PASSWORD")
    $keyAlias = [Environment]::GetEnvironmentVariable("ANDROID_KEY_ALIAS")
    $keyPass = [Environment]::GetEnvironmentVariable("ANDROID_KEY_PASSWORD")

    if (-not $storePass -or -not $keyAlias -or -not $keyPass) {
        Write-Error "Release 构建需要环境变量: ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD"
        exit 1
    }

    $env:ANDROID_KEYSTORE_FILE = $keystoreFile
    $env:ANDROID_KEYSTORE_PASSWORD = $storePass
    $env:ANDROID_KEY_ALIAS = $keyAlias
    $env:ANDROID_KEY_PASSWORD = $keyPass
    Write-Output "[build-android] 使用 keystore: $keystoreFile (alias=$keyAlias)"
}

Set-Location $androidDir
& .\gradlew.bat $gradleTask 2>&1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 产物重命名
$flavor = if ($Production) { "release" } else { "debug" }
$apkPath = "$apkDir\$flavor\app-$flavor.apk"
$distDir = "$repoRoot\dist"
New-Item -ItemType Directory -Path $distDir -Force | Out-Null

if (Test-Path $apkPath) {
    $archLabel = if ($Arch -eq "all") { "multi" } else { $Arch }
    $distApk = "$distDir\MikuMikuAR-$version-android-$archLabel.apk"
    Copy-Item $apkPath $distApk -Force
    $size = (Get-Item $distApk).Length / 1MB
    Write-Output ""
    Write-Output "[build-android] Build complete"
    Write-Output "   APK: $distApk"
    Write-Output "   Size: $([math]::Round($size, 2)) MB"
} else {
    Write-Error "Build artifact not found: $apkPath"
    exit 1
}

Set-Location $repoRoot
