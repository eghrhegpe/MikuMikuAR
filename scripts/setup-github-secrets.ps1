# GitHub Secrets 配置助手
# 用法: .\scripts\setup-github-secrets.ps1
# 将本地 keystore 编码并输出设置 secrets 的命令

$keystoreFile = "c:\Users\zhujieling11\MikuMikuAR\MikuMikuAR\build\android\keystore\release.keystore"

if (-not (Test-Path $keystoreFile)) {
    Write-Error "keystore 文件不存在: $keystoreFile"
    Write-Output "请先运行 Release 构建生成 keystore，或提供已有的 keystore 文件"
    exit 1
}

Write-Output "读取 keystore: $keystoreFile"
$keystoreBytes = [System.IO.File]::ReadAllBytes($keystoreFile)
$keystoreBase64 = [System.Convert]::ToBase64String($keystoreBytes)

Write-Output ""
Write-Output "=== GitHub Secrets 配置命令 ==="
Write-Output "在仓库 Settings -> Secrets and variables -> Actions -> New repository secret 中依次添加:"
Write-Output ""

Write-Output "1. Secret 名称: ANDROID_KEYSTORE_BASE64"
Write-Output "   值 (已复制到剪贴板，或手动复制下方内容):"
Write-Output ""

# 尝试复制到剪贴板
if (Get-Command "Set-Clipboard" -ErrorAction SilentlyContinue) {
    $keystoreBase64 | Set-Clipboard
    Write-Output "   [已自动复制到剪贴板]"
} else {
    Write-Output "   $keystoreBase64"
}

Write-Output ""
Write-Output "2. Secret 名称: ANDROID_KEYSTORE_PASSWORD"
Write-Output "   值: MikuMikuAR2026"
Write-Output ""

Write-Output "3. Secret 名称: ANDROID_KEY_ALIAS"
Write-Output "   值: mikumikuar"
Write-Output ""

Write-Output "4. Secret 名称: ANDROID_KEY_PASSWORD"
Write-Output "   值: MikuMikuAR2026"
Write-Output ""

Write-Output "=== 或使用 GitHub CLI 一键设置 ==="
Write-Output "gh secret set ANDROID_KEYSTORE_BASE64 --body `"$keystoreBase64`""
Write-Output "gh secret set ANDROID_KEYSTORE_PASSWORD --body `"MikuMikuAR2026`""
Write-Output "gh secret set ANDROID_KEY_ALIAS --body `"mikumikuar`""
Write-Output "gh secret set ANDROID_KEY_PASSWORD --body `"MikuMikuAR2026`""
Write-Output ""

Write-Output "=== 本地 Release 构建环境变量 ==="
Write-Output "本地运行 `build-android.ps1 -Production` 需要设置以下环境变量:"
Write-Output "  $env:ANDROID_KEYSTORE_PASSWORD = `"MikuMikuAR2026`""
Write-Output "  $env:ANDROID_KEY_ALIAS = `"mikumikuar`""
Write-Output "  $env:ANDROID_KEY_PASSWORD = `"MikuMikuAR2026`""
Write-Output ""

Write-Output "完成后，打 Tag 即可自动触发 Release 构建并上传 APK:"
Write-Output "  git tag v1.0.0"
Write-Output "  git push origin v1.0.0"
