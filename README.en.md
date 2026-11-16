# Orbit · Context & Quota Telemetry (agy-orbit)

[中文文档](./README.md) | **English**

A seamless bottom-bar telemetry plugin designed specifically for **Google Antigravity**. Monitor 1M context usage, 4-stage token breakdown, prompt cache validity countdown, and official account quota limits in real time.

<p align="center">
  <img src="assets/preview-footer.png" width="90%" alt="Antigravity composer footer inline progress ring" />
</p>

<p align="center">
  <img src="assets/preview-popover.png" width="340px" alt="Click-to-open telemetry dashboard" />
</p>

---

## Highlights

- **Inline Composer Footer Ring**: Mounts seamlessly to the left of the `Auto` button in the composer footer. Displays 1M context percentage with dynamic status colors (green safe, amber warning, red critical).
- **Click to Toggle / Outside to Close**: Clicking the ring opens/closes the telemetry dashboard. Hover only provides subtle button feedback to prevent accidental popups; clicking outside automatically closes it.
- **1,048k Context Window Proportional Bar**: The progress bar track accurately represents the full 1M (1,048,576 tokens) context window. Segments are proportionally stacked to indicate used capacity, while the remaining portion represents available headroom:
  - **Preset (System/Init)**: Amber segment
  - **Read (Tools/Files)**: Blue segment
  - **Think (Chain of Thought)**: Green segment
  - **Output (Responses)**: Orange segment
- **2×2 Clean Legend Grid**: Structured dual-column grid prevents Chinese/English character wrapping, using monospace font for token metrics.
- **Prompt Cache Status Tracker**: Tracks cache hit rate (%) and cached vs new tokens. Accurately counts elapsed time since the previous model turn:
  - `< 180s`: `Valid · X s since last turn` (Green)
  - `180s ~ 240s`: `Expiring · X s remaining` (Amber warning to reuse warm cache)
  - `>= 240s`: `Expired · Cold start on next turn` (Gray)
- **Dual Official Quota Limits with Progress Bars**: Connects directly to Antigravity's internal LanguageServer RPC:
  - **5-Hour Quota**: Remaining fraction %, reset countdown, and dynamic progress bar.
  - **Weekly Quota**: Remaining fraction %, refresh countdown, and dynamic progress bar.
- **Generation Speed**: Real-time throughput calculation (`~XXX t/s`).
- **Native Dark/Light Theme Support**: Uses Antigravity host CSS variables (`--card`, `--foreground`, `--border`, `--secondary`), providing backdrop blur and zero hardcoded colors.
- **Zero Emojis & Clean Minimalist Design**: Professional technical vocabulary.

---

## Installation

### Method 1: Ask Your Agent to Install (Zero Effort)

No need to open a terminal. Simply copy and send the following prompt directly into your **Antigravity chat**, and the agent will install and configure it for you:

```text
Please help me install the `agy-orbit` plugin:
1. Ensure the local plugin directory exists (`~/.gemini/config/plugins/` on macOS/Linux, or `$HOME\.gemini\config\plugins\` on Windows);
2. Clone `https://github.com/luluxiaoyu/agy-orbit.git` into the `agy-orbit` folder inside that directory (or run `git pull` if it already exists);
3. Verify that the files (`plugin.json` and `sidecars/monitor/server.mjs`) are present, and remind me to confirm it is enabled in Antigravity Plugins settings.
```

---

### Method 2: Git Terminal One-Liner

Run the command in your terminal:

#### macOS / Linux
```bash
git clone https://github.com/luluxiaoyu/agy-orbit.git ~/.gemini/config/plugins/agy-orbit
```

#### Windows (PowerShell)
```powershell
git clone https://github.com/luluxiaoyu/agy-orbit.git "$HOME\.gemini\config\plugins\agy-orbit"
```

---

### Method 3: Manual Installation

1. Click **Code -> Download ZIP** on GitHub and extract the archive;
2. Rename the extracted folder to `agy-orbit`;
3. Move it to your Antigravity plugin directory:
   - **macOS / Linux**: `~/.gemini/config/plugins/agy-orbit`
   - **Windows**: `%USERPROFILE%\.gemini\config\plugins\agy-orbit`
4. Directory structure should look like:
   ```text
   ~/.gemini/config/plugins/agy-orbit/
   ├── plugin.json
   ├── README.md
   ├── README.en.md
   ├── LICENSE
   └── sidecars/
       └── monitor/
           ├── package.json
           ├── sidecar.json
           └── server.mjs
   ```

---

## Verification

1. **Auto Hot-Reload**: Antigravity automatically detects the new plugin directory and launches the background daemon. The circular progress ring will appear in the composer footer.
2. **Check Plugins Menu**: If not visible, open Antigravity's **Plugins** settings and ensure **Orbit · 上下文与配额遥测** is enabled.
3. **Click Interaction**: Click the ring in the bottom bar to open the telemetry dashboard.

---

## License

[MIT License](./LICENSE)
