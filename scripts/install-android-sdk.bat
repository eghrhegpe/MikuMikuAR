@echo off
set ANDROID_HOME=C:\Android\Sdk
set ANDROID_SDK_ROOT=C:\Android\Sdk
set SDKMANAGER=%ANDROID_HOME%\cmdline-tools\latest\bin\sdkmanager.bat

echo 接受许可证...
(
echo y
echo y
echo y
echo y
echo y
echo y
echo y
echo y
) | %SDKMANAGER% --licenses --sdk_root=%ANDROID_HOME%

echo 安装 SDK 组件...
%SDKMANAGER% "platform-tools" "platforms;android-34" "build-tools;34.0.0" "ndk;26.3.11579264" --sdk_root=%ANDROID_HOME%

echo 完成