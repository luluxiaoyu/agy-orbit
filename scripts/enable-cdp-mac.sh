#!/usr/bin/env bash
set -euo pipefail

echo "[Orbit] 正在为 macOS 构建 Antigravity (CDP) 免命令行启动器..."

SOURCE_APP="/Applications/Antigravity.app"
if [ ! -d "$SOURCE_APP" ]; then
    echo "[Orbit] 错误：未在 /Applications 找到 Antigravity.app"
    exit 1
fi

DEST_DIR="${HOME}/Applications"
mkdir -p "$DEST_DIR"
APP_NAME="Antigravity (CDP).app"
APP_PATH="$DEST_DIR/$APP_NAME"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# 编译极简原生 Mach-O 启动器
cat << 'EOF' > "$TMP_DIR/launcher.c"
#include <unistd.h>
#include <stdlib.h>

int main(int argc, char *argv[]) {
    char *args[] = {
        "/usr/bin/open",
        "-a",
        "/Applications/Antigravity.app",
        "--args",
        "--remote-debugging-port=0",
        NULL
    };
    execv("/usr/bin/open", args);
    return 0;
}
EOF

rm -rf "$APP_PATH"
mkdir -p "$APP_PATH/Contents/MacOS"
mkdir -p "$APP_PATH/Contents/Resources"

clang -O2 "$TMP_DIR/launcher.c" -o "$APP_PATH/Contents/MacOS/launcher"
chmod +x "$APP_PATH/Contents/MacOS/launcher"

# 复用原版高清图标
if [ -f "$SOURCE_APP/Contents/Resources/icon.icns" ]; then
    cp "$SOURCE_APP/Contents/Resources/icon.icns" "$APP_PATH/Contents/Resources/icon.icns"
fi

# 写入 Bundle 元数据（LSUIElement=true 使启动器静默执行后立即退出，不在 Dock 额外残留）
cat << 'EOF' > "$APP_PATH/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>zh_CN</string>
    <key>CFBundleDisplayName</key>
    <string>Antigravity (CDP)</string>
    <key>CFBundleExecutable</key>
    <string>launcher</string>
    <key>CFBundleIconFile</key>
    <string>icon.icns</string>
    <key>CFBundleIdentifier</key>
    <string>com.luluxiaoyu.antigravity-cdp</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>Antigravity (CDP)</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
EOF

# 进行本地 Ad-hoc 代码签名
codesign --force --deep --sign - "$APP_PATH" >/dev/null 2>&1 || true

# 如果 /Applications 对当前用户可写，同时复制一份到 /Applications 便于全局 Spotlight 索引
if [ -w "/Applications" ]; then
    rm -rf "/Applications/$APP_NAME"
    cp -R "$APP_PATH" "/Applications/$APP_NAME" 2>/dev/null || true
    echo "[Orbit] 已成功创建启动器至 /Applications/$APP_NAME"
else
    echo "[Orbit] 已成功创建启动器至 $APP_PATH"
fi

echo "[Orbit] 完成！您可以将「Antigravity (CDP)」拖到程序坞（Dock），以后直接点击即可一键启动！"
