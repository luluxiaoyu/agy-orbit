# Orbit · 上下文与配额遥测 (agy-orbit)

专为 **Google Antigravity** 打造的底栏无感遥测插件。实时掌控真实会话上下文水位、四段 Token 成分、Prompt 缓存时效与官方账户配额进度。

<p align="center">
  <img src="assets/preview-footer.png" width="90%" alt="Antigravity 输入框底栏内联圆环与百分比" />
</p>

<p align="center">
  <img src="assets/preview-popover.png" width="340px" alt="点击展开的完整遥测看板" />
</p>

---

## 特性亮点

- **底栏极简内联圆环**：无缝挂载在输入框底栏 `Auto` 按钮左侧。实时呈现会话上下文占用水位，依据负载动态变换状态指示色（绿色安全、琥珀警示、红色临界）。
- **点击展开 / 外部收起**：严格遵循用户交互意图，点击圆环开关弹窗，鼠标悬停仅提供轻量底色反馈，绝不误触弹出；点击空白处自动收起。
- **动态上下文比例标尺（自适应真实上限）**：虽底层模型原生支持更大窗口，但 Antigravity 对会话分配了独立的有效安全窗口（例如 Gemini 会话上限为 **256k**，Claude 会话上限为 **160k**）。本插件通过读取会话原生元数据实时解析当前模型的真实上限，四段彩色滑块严格按实际占用水位紧凑排列，剩余为未占用底槽：
  - **预设 (系统/初始化)**：黄色滑块
  - **读取 (工具与文件)**：蓝色滑块
  - **思考 (推理链)**：绿色滑块
  - **回复 (生成输出)**：橙色滑块
- **2×2 清爽图例对齐**：采用双列网格排版，彻底解决汉字上下折行问题，数值使用等宽字体对齐展示。
- **Prompt 缓存状态追踪**：精准计算缓存命中率（%）与读取/新增 Token 数量；基于距上轮对话间隔动态追踪缓存有效性：
  - `< 180s`：`有效 · 距上轮 X 秒`（绿色）
  - `180s ~ 240s`：`即将失效 · 剩余 X 秒`（琥珀黄色预警，提醒趁热复用缓存）
  - `>= 240s`：`已失效 · 下一轮冷启动`（灰色）
- **官方账号限额双轨监控**：直连 Antigravity 后台 RPC 服务，实时读取官方配额并提供可视化进度条：
  - **5 小时限额**：剩余百分比、重置倒计时与专属水平动态进度条
  - **周限额**：本周累计剩余百分比、刷新周期与专属水平动态进度条
- **生成吞吐速率**：实时测量模型当前生成吐字速度（`~XXX t/s`）。
- **跨平台 CDP 启动看门狗 & 原生弹窗提醒**：内置快捷方式修补脚本与参数探针；当未检测到调试端口时，自动触发系统级通知提示用户。
- **原生黑白主题自适应**：全面复用 Antigravity 宿主原生 CSS 变量（`--card`, `--foreground`, `--border`, `--secondary` 等），完美契合浅色与深色模式，毛玻璃质感底色。
- **无 Emoji 极简技术风格**：纯中文专业术语，界面克制干净。

---

## 安装与配置

### 方法一：复制提示词让 Agent 全自动安装（最省心，跨平台推荐）

无需手动敲击终端命令，直接将下方预设提示词复制发送给 **Antigravity 对话框**，Agent 会自动为你克隆插件，并在 Windows 系统下全自动完成快捷方式参数修补：

```text
请帮我安装 `agy-orbit` 插件：
1. 检查并确保本地插件目录存在（macOS/Linux 为 `~/.gemini/config/plugins/`，Windows 为 `$HOME\.gemini\config\plugins\`）；
2. 运行命令将仓库 `https://github.com/luluxiaoyu/agy-orbit.git` 克隆到该目录下的 `agy-orbit` 文件夹中（若已存在则执行 git pull 更新）；
3. 如果当前系统是 Windows，自动运行插件目录下的 `powershell -ExecutionPolicy Bypass -File scripts\enable-cdp.ps1`，自动为桌面与开始菜单的 Antigravity 快捷方式加上 `--remote-debugging-port=0` 参数；
4. 检查确认目录结构完整（包含 `plugin.json` 与 `sidecars/monitor/server.mjs`），并提醒我在 Antigravity 插件管理中确认启用。
```

---

### 方法二：各系统一键安装脚本

#### Windows 用户
1. 下载本仓库源码包并解压；
2. 双击运行 **`install.bat`**；
3. 脚本会自动将插件部署到 `%USERPROFILE%\.gemini\config\plugins\agy-orbit`，并**自动修补桌面、开始菜单和任务栏的 Antigravity 快捷方式**（自动追加 `--remote-debugging-port=0`）；
4. 完全退出 Antigravity（右下角托盘完全退出），然后重新双击桌面或开始菜单图标打开即可！

#### macOS / Linux 用户
打开终端，运行一键安装：
```bash
git clone https://github.com/luluxiaoyu/agy-orbit.git ~/.gemini/config/plugins/agy-orbit && sh ~/.gemini/config/plugins/agy-orbit/install.sh
```

> **macOS 底栏圆环生效说明**：
> macOS 运行 `install.sh` 时会**自动在「应用程序」或「~/Applications」目录中生成原生「Antigravity (CDP)」启动器**（已提取官方高清图标并完成本地签名）。
> **只需将「Antigravity (CDP)」拖到程序坞（Dock）**，以后直接点击它启动即可，完全不需要每次打开终端敲命令！
> 
> （也可以在终端单独运行脚本生成：`sh ~/.gemini/config/plugins/agy-orbit/scripts/enable-cdp-mac.sh`）

---

## 验证与使用

1. **启用插件**：在 Antigravity 的 **Plugins（插件管理）** 界面中，确保 **Orbit · 上下文与配额遥测** 处于启用（Enabled）状态。
2. **底栏交互**：输入框底栏 `Auto` 按钮左侧即刻显示环形水尺与百分比；点击圆环展开完整遥测看板，再次点击或点击空白处即可收起。

---

## 技术原理

1. **CDP 动态挂载机制**：通过 Chrome DevTools Protocol 探针建立 WebSocket 链路，直接对客户端输入框底栏注入自愈型 DOM 节点，不修改 Antigravity 任何源码，升级客户端不影响使用。
2. **Windows 快捷方式自动化**：通过 `scripts/enable-cdp.ps1` 智能检索 Windows Shell 的 `.lnk` 快捷方式并自动注入参数，为用户省去手动配置启动项的繁琐过程。
3. **数据源层**：
   - **上下文与缓存遥测**：实时流式解析本地 SQLite 元数据与会话日志，动态读取 Antigravity 为当前模型设定的上下文上限（如 256k / 160k），精确计算 Token 分布与生成吞吐速度；
   - **官方配额**：通过本地通信通道直连官方 LanguageServer RPC 服务读取配额桶，无需任何 API Key。

---

## 开源协议

本项目采用 [MIT License](./LICENSE) 开源协议。
