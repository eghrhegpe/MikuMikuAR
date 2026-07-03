# 自动接受 Android SDK 许可证
$sdkDir = "C:\Android\Sdk"
$sdkmanager = Join-Path $sdkDir "cmdline-tools\latest\bin\sdkmanager.bat"
$env:ANDROID_HOME = $sdkDir
$env:ANDROID_SDK_ROOT = $sdkDir

Write-Output "SDK Manager: $sdkmanager"
Write-Output "ANDROID_HOME: $env:ANDROID_HOME"

# 创建临时回答文件（8个 y）
$answerFile = Join-Path $env:TEMP "sdk_answers.txt"
"y`ny`ny`ny`ny`ny`ny`ny`ny" | Out-File -FilePath $answerFile -Encoding ascii -NoNewline

# 接受许可证（使用 cmd 管道）
Write-Output "接受许可证..."
$licenseCmd = "`"$sdkmanager`" --licenses --sdk_root=`"$sdkDir`""
cmd /c "$licenseCmd < $answerFile" 2>&1 | Out-Null

# 安装组件
Write-Output "安装 SDK 组件..."
$installCmd = "`"$sdkmanager`" `"platform-tools`" `"platforms;android-34`" `"build-tools;34.0.0`" `"ndk;26.3.11579264`" --sdk_root=`"$sdkDir`""
cmd /c $installCmd 2>&1

Remove-Item $answerFile -Force -ErrorAction SilentlyContinue
Write-Output "完成"