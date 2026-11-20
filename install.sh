#!/usr/bin/env sh
set -eu

echo "[Orbit] 正在安装 Orbit · 上下文与配额遥测插件..."

TARGET_DIR="${HOME}/.gemini/config/plugins/agy-orbit"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"

mkdir -p "${HOME}/.gemini/config/plugins"

if [ -d "$TARGET_DIR" ]; then
    echo "[Orbit] 插件目录已存在，正在同步更新最新代码..."
    cp -R "$SCRIPT_DIR/." "$TARGET_DIR/"
else
    echo "[Orbit] 正在安装插件文件到 $TARGET_DIR..."
    mkdir -p "$TARGET_DIR"
    cp -R "$SCRIPT_DIR/." "$TARGET_DIR/"
fi

# Linux desktop file patch
if [ "$(uname -s)" = "Linux" ]; then
    DESKTOP_FILE="${HOME}/.local/share/applications/antigravity.desktop"
    if [ -f "$DESKTOP_FILE" ]; then
        if ! grep -q -- "--remote-debugging-port" "$DESKTOP_FILE"; then
            sed -i 's/^Exec=\(.*antigravity.*\)$/Exec=\1 --remote-debugging-port=0/' "$DESKTOP_FILE"
            echo "[Orbit] 已自动为 Linux 桌面快捷方式添加 --remote-debugging-port=0 参数！"
        fi
    fi
elif [ "$(uname -s)" = "Darwin" ]; then
    if [ -f "$SCRIPT_DIR/scripts/enable-cdp-mac.sh" ]; then
        sh "$SCRIPT_DIR/scripts/enable-cdp-mac.sh" || true
    fi
fi

echo ""
echo "========================================================"
echo "[Orbit] 插件部署完成！"
echo "1. 请在 Antigravity 的 Plugins 面板中确认启用 \"Orbit · 上下文与配额遥测\""
if [ "$(uname -s)" = "Darwin" ]; then
    echo "2. macOS 提示：已在「应用程序」或「~/Applications」中为您生成「Antigravity (CDP)」启动应用。"
    echo "   将其拖入程序坞（Dock），以后直接点击即可一键以 CDP 模式启动，无需每次在终端敲命令！"
fi
echo "========================================================"
