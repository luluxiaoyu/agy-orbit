@echo off
chcp 65001 >nul
echo [Orbit] 正在为 Windows 安装 Orbit · 上下文与配额遥测插件...

set "TARGET_DIR=%USERPROFILE%\.gemini\config\plugins\agy-orbit"

if not exist "%USERPROFILE%\.gemini\config\plugins" (
    mkdir "%USERPROFILE%\.gemini\config\plugins"
)

if not exist "%TARGET_DIR%" (
    echo [Orbit] 正在复制插件文件到 %TARGET_DIR%...
    xcopy /E /I /Y "%~dp0*" "%TARGET_DIR%\" >nul
) else (
    echo [Orbit] 插件目录已存在，正在同步更新最新代码...
    xcopy /E /I /Y "%~dp0*" "%TARGET_DIR%\" >nul
)

echo [Orbit] 正在自动修补 Antigravity 快捷方式（添加 --remote-debugging-port=0）...
powershell -NoProfile -ExecutionPolicy Bypass -File "%TARGET_DIR%\scripts\enable-cdp.ps1"

echo.
echo ========================================================
echo [Orbit] 安装完成！
echo 1. 请在 Antigravity 的 Plugins（插件管理）中确认启用 "Orbit · 上下文与配额遥测"
echo 2. 请完全退出 Antigravity（右下角托盘完全退出），然后重新双击桌面图标打开
echo 3. 输入框底栏左侧即可看到实时遥测圆环！
echo ========================================================
pause
