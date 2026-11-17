import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const INTERVAL_MS = 1000;
const PORT_FILE =
  process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort')
    : process.platform === 'win32'
      ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Antigravity', 'DevToolsActivePort')
      : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Antigravity', 'DevToolsActivePort');

const CONV_DIR = join(homedir(), '.gemini', 'antigravity', 'conversations');

const sockets = new Map();
let cachedQuota = null;
let lastQuotaFetchMs = 0;

function readCdpPort() {
  try {
    if (!existsSync(PORT_FILE)) return '';
    return readFileSync(PORT_FILE, 'utf-8').split('\n')[0].trim();
  } catch {
    return '';
  }
}

async function fetchQuota() {
  const now = Date.now();
  if (cachedQuota && now - lastQuotaFetchMs < 10000) return cachedQuota;

  const lsAddr = process.env.ANTIGRAVITY_LS_ADDRESS;
  const csrf = process.env.ANTIGRAVITY_CSRF_TOKEN;
  if (!lsAddr || !csrf) return cachedQuota;

  try {
    const res = await fetch(
      `http://${lsAddr}/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-codeium-csrf-token': csrf,
        },
        body: '{}',
      }
    );
    if (!res.ok) return cachedQuota;
    const json = await res.json();
    cachedQuota = json?.response?.groups || json?.groups || [];
    lastQuotaFetchMs = now;
    return cachedQuota;
  } catch (e) {
    return cachedQuota;
  }
}

function formatCountdown(targetIso) {
  if (!targetIso) return '';
  const diffMs = new Date(targetIso).getTime() - Date.now();
  if (diffMs <= 0) return '即将重置';
  const diffMin = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remH = hours % 24;
    return `${days}天${remH > 0 ? remH + '小时' : ''}后重置`;
  }
  if (hours > 0) {
    return `${hours}小时${mins}分后重置`;
  }
  return `${mins}分钟后重置`;
}

function parsePbMap(buf) {
  const fields = new Map();
  let pos = 0;
  while (pos < buf.length) {
    const key = buf[pos++];
    const wireType = key & 7;
    const fieldNum = key >> 3;
    if (wireType === 0) {
      let val = 0, shift = 0;
      while (pos < buf.length) {
        const b = buf[pos++];
        val |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
      }
      if (!fields.has(fieldNum)) fields.set(fieldNum, []);
      fields.get(fieldNum).push(val);
    } else if (wireType === 2) {
      let len = 0, shift = 0;
      while (pos < buf.length) {
        const b = buf[pos++];
        len |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
      }
      const val = buf.subarray(pos, pos + len);
      pos += len;
      if (!fields.has(fieldNum)) fields.set(fieldNum, []);
      fields.get(fieldNum).push(val);
    } else {
      break;
    }
  }
  return fields;
}

// Dynamically extracts the accurate session context limit configured by Antigravity
// (e.g. 256k for Gemini in Antigravity, 160k for Claude, etc.)
function resolveMaxContextTokens(convId) {
  if (!convId) return 256000;
  const dbFile = join(CONV_DIR, `${convId}.db`);
  if (!existsSync(dbFile)) return 256000;
  try {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    const rows = db.prepare('SELECT data FROM gen_metadata ORDER BY idx DESC LIMIT 5').all();
    db.close();
    for (const row of rows) {
      if (!row?.data) continue;
      const top = parsePbMap(Buffer.from(row.data));
      if (!top.has(1)) continue;
      const m1 = parsePbMap(top.get(1)[0]);
      if (m1.has(9)) {
        const m9 = parsePbMap(m1.get(9)[0]);
        if (m9.has(10)) {
          const m10 = parsePbMap(m9.get(10)[0]);
          if (m10.has(4)) {
            const val = m10.get(4)[0];
            if (val > 0) return val;
          }
        }
      }
    }
  } catch (err) {}
  return 256000;
}

function resolveActiveConvId(pathnameConvId) {
  if (pathnameConvId && existsSync(join(CONV_DIR, `${pathnameConvId}.db`))) {
    return pathnameConvId;
  }
  if (!existsSync(CONV_DIR)) return pathnameConvId || '';
  try {
    const files = readdirSync(CONV_DIR)
      .filter((f) => f.endsWith('.db'))
      .map((f) => ({
        id: basename(f, '.db'),
        mtimeMs: statSync(join(CONV_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (files.length > 0) return files[0].id;
  } catch {}
  return pathnameConvId || '';
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const entry = { ws, pending: new Map(), nextId: 1 };
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws timeout')), 3000);
    ws.onopen = () => {
      clearTimeout(t);
      resolve();
    };
    ws.onerror = (e) => {
      clearTimeout(t);
      reject(e);
    };
  });
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      const cb = entry.pending.get(msg.id);
      if (cb) {
        entry.pending.delete(msg.id);
        cb(msg);
      }
    } catch {}
  };
  ws.onclose = () => sockets.delete(target.id);
  sockets.set(target.id, entry);
  return entry;
}

function evaluate(entry, expression) {
  return new Promise((resolve) => {
    const id = entry.nextId++;
    const t = setTimeout(() => {
      entry.pending.delete(id);
      resolve(undefined);
    }, 3000);
    entry.pending.set(id, (msg) => {
      clearTimeout(t);
      resolve(msg?.result?.result?.value);
    });
    entry.ws.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true },
      })
    );
  });
}

async function computeMetrics(convId) {
  if (!convId) return null;
  const transcriptPath = join(
    homedir(),
    '.gemini',
    'antigravity',
    'brain',
    convId,
    '.system_generated',
    'logs',
    'transcript.jsonl'
  );
  if (!existsSync(transcriptPath)) return null;

  try {
    const content = readFileSync(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    let turn0 = 0;
    let rawOut = 0;
    let rawThink = 0;
    let latestModelWithTokens = null;
    let lastTime = 0;
    let prevTurnTime = 0;

    for (let i = 0; i < lines.length; i++) {
      try {
        const s = JSON.parse(lines[i]);
        if (s.source === 'MODEL') {
          // Record turn0 from the first valid model turn
          if (!turn0 && ((s.input_tokens || 0) + (s.cache_read_tokens || 0) > 0)) {
            turn0 = (s.input_tokens || 0) + (s.cache_read_tokens || 0);
          }
          // Only track steps that actually report input/cache token counts
          if (s.input_tokens !== undefined || s.cache_read_tokens !== undefined) {
            const turnTokens = (s.input_tokens || 0) + (s.cache_read_tokens || 0);
            if (turnTokens > 0) {
              if (latestModelWithTokens?.created_at) {
                prevTurnTime = new Date(latestModelWithTokens.created_at).getTime();
              }
              latestModelWithTokens = s;
            }
          }
          if (s.created_at) lastTime = new Date(s.created_at).getTime();
          rawOut += s.output_tokens || 0;
          if (s.thinking) rawThink += Math.round(s.thinking.length / 3);
        }
      } catch {}
    }

    if (!latestModelWithTokens) return null;
    const latest = latestModelWithTokens;

    const ctx = (latest.input_tokens || 0) + (latest.cache_read_tokens || 0);
    const cached = latest.cache_read_tokens || 0;

    // Dynamically retrieve Antigravity's true context limit (e.g. 256k for Gemini in Antigravity)
    const maxCtx = resolveMaxContextTokens(convId);
    const quotaPercent = Math.min((ctx / maxCtx) * 100, 100);

    // Breakdown scaled into actual window fractions
    const genTotal = rawOut + rawThink;
    const avail = Math.max(0, ctx - turn0);
    const scale = genTotal > 0 && genTotal > avail ? avail / genTotal : 1;
    const outTokens = Math.round(rawOut * scale);
    const thinkTokens = Math.round(rawThink * scale);
    const readTokens = Math.max(0, ctx - turn0 - outTokens - thinkTokens);

    // Cache rate
    const cacheRate = ctx > 0 ? (cached / ctx) * 100 : 0;

    // Cache Status (Valid / Expiring / Expired) - Strictly NO "保鲜"
    const now = Date.now();
    const elapsedSec = lastTime > 0 ? Math.floor((now - lastTime) / 1000) : 0;
    let cacheStatusText = '';
    let cacheStatusColor = '#10b981';

    if (elapsedSec < 180) {
      cacheStatusText = `有效 · 距上轮 ${elapsedSec} 秒`;
      cacheStatusColor = '#10b981';
    } else if (elapsedSec < 240) {
      const rem = 240 - elapsedSec;
      cacheStatusText = `即将失效 · 剩余 ${rem} 秒`;
      cacheStatusColor = '#f59e0b';
    } else {
      cacheStatusText = '已失效 · 下一轮冷启动';
      cacheStatusColor = '#71717a';
    }

    // Speed
    let speed = 0;
    if (prevTurnTime > 0 && lastTime > prevTurnTime) {
      const diffSec = Math.max((lastTime - prevTurnTime) / 1000, 1);
      speed = Math.round((latest.output_tokens || 0) / diffSec);
    }

    // Official Quotas from Language Server
    const quotaGroups = (await fetchQuota()) || [];
    let q5hPct = null;
    let q5hReset = '';
    let qWkPct = null;
    let qWkReset = '';

    const targetGroup =
      quotaGroups.find((g) => g.displayName === 'Gemini Models') ||
      quotaGroups.find((g) => g.displayName?.includes('Gemini') || g.displayName?.includes('Models'));

    if (targetGroup) {
      for (const b of targetGroup.buckets || []) {
        if (b.window === '5h') {
          q5hPct = +(b.remainingFraction * 100).toFixed(1);
          q5hReset = formatCountdown(b.resetTime);
        } else if (b.window === 'weekly') {
          qWkPct = +(b.remainingFraction * 100).toFixed(1);
          qWkReset = formatCountdown(b.resetTime);
        }
      }
    }

    return {
      quotaPercent: +quotaPercent.toFixed(1),
      totalInputK: (ctx / 1000).toFixed(1),
      maxCtxK: (maxCtx / 1000).toFixed(0),
      cacheTokensK: (cached / 1000).toFixed(1),
      inputTokensK: (Math.max(0, ctx - cached) / 1000).toFixed(1),
      cacheRate: +cacheRate.toFixed(1),
      cacheStatusText,
      cacheStatusColor,
      speed: speed > 0 ? speed : 280,
      breakdown: {
        turn0K: (turn0 / 1000).toFixed(1),
        turn0WindowPct: +((turn0 / maxCtx) * 100).toFixed(2),
        readK: (readTokens / 1000).toFixed(1),
        readWindowPct: +((readTokens / maxCtx) * 100).toFixed(2),
        thinkK: (thinkTokens / 1000).toFixed(1),
        thinkWindowPct: +((thinkTokens / maxCtx) * 100).toFixed(2),
        outK: (outTokens / 1000).toFixed(1),
        outWindowPct: +((outTokens / maxCtx) * 100).toFixed(2),
      },
      quota5h: q5hPct !== null ? { remainingPct: q5hPct, resetText: q5hReset } : null,
      quotaWeekly: qWkPct !== null ? { remainingPct: qWkPct, resetText: qWkReset } : null,
    };
  } catch (err) {
    return null;
  }
}

// Injected client renderer function
function pageMount(data) {
  if (!data) return 'no-data';
  const footer = document.querySelector('.agy-composer-footer');
  if (!footer) return 'no-footer';
  const autoContainer = footer.children[1];
  if (!autoContainer) return 'no-auto-container';
  const autoBtn = autoContainer.querySelector('button');
  if (!autoBtn) return 'no-auto-btn';

  let wrapper = document.getElementById('token-monitor-wrapper');

  // BUILD STRUCTURE STRICTLY ONCE (v11)
  if (!wrapper || wrapper.getAttribute('data-tm-ver') !== '11') {
    if (wrapper) wrapper.remove();

    wrapper = document.createElement('div');
    wrapper.id = 'token-monitor-wrapper';
    wrapper.setAttribute('data-tm-ver', '11');
    wrapper.style.cssText = [
      'position: relative !important',
      'display: inline-flex !important',
      'align-items: center !important',
      'margin-right: 4px !important',
      'vertical-align: middle !important',
      'flex-shrink: 0 !important',
      'z-index: 50 !important',
    ].join(';');

    wrapper.innerHTML = `
      <div id="token-monitor-bottom-pill" style="
        display: inline-flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 28px;
        padding: 0 8px;
        border-radius: 9999px;
        background: transparent;
        color: var(--secondary-foreground, #3f3f46);
        font-family: inherit;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
        box-sizing: border-box;
        transition: background-color 0.15s ease, color 0.15s ease;
      ">
        <svg width="15" height="15" viewBox="0 0 18 18" style="transform: rotate(-90deg); flex-shrink: 0; display: block; overflow: visible;">
          <circle cx="9" cy="9" r="6.5" stroke="var(--border, rgba(128,128,128,0.22))" stroke-width="2.2" fill="none" />
          <circle id="tm-ring-circle" cx="9" cy="9" r="6.5" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" fill="none" stroke-dasharray="40.84" stroke-dashoffset="40.84" style="transition: stroke-dashoffset 0.4s ease, stroke 0.3s ease;" />
        </svg>
        <span id="tm-pct-text" style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12.5px; font-weight: 500; letter-spacing: -0.01em; color: inherit; line-height: 1;">0.0%</span>
      </div>

      <div id="token-monitor-popover" style="
        display: none;
        position: absolute;
        bottom: calc(100% + 10px);
        right: 0;
        width: 300px;
        padding: 14px 16px;
        border-radius: 12px;
        background: var(--card, #ffffff);
        border: 1px solid var(--border, rgba(128,128,128,0.2));
        box-shadow: 0 12px 32px -4px rgba(0,0,0,0.16), 0 4px 12px -2px rgba(0,0,0,0.06);
        color: var(--foreground, #0a0a0c);
        font-family: inherit;
        font-size: 12px;
        line-height: 1.5;
        z-index: 999999;
        cursor: default;
        text-align: left;
        box-sizing: border-box;
        backdrop-filter: blur(16px);
      ">
        <!-- Title & Quota -->
        <div style="font-weight: 600; font-size: 13px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border, rgba(128,128,128,0.12)); display: flex; justify-content: space-between; align-items: center;">
          <span style="color: var(--foreground, #0a0a0c);">上下文与配额遥测</span>
          <span id="tm-pop-pct" style="font-weight: 600; font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color: #10b981;">0.0%</span>
        </div>

        <!-- 1. Context Usage Watermark -->
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
          <span style="color: var(--muted-foreground, #71717a);">上下文总水位</span>
          <span id="tm-pop-ctx" style="font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; color: var(--foreground, #0a0a0c);">0.0k / 256k</span>
        </div>

        <!-- Segmented Context Bar (Proportional to True Antigravity Context Window) -->
        <div style="display: flex; height: 6px; border-radius: 9999px; overflow: hidden; background: var(--border, rgba(128,128,128,0.18)); margin-bottom: 8px;">
          <div id="tm-seg-turn0" style="width: 0%; background: #eab308; transition: width 0.3s ease;" title="初始系统预设"></div>
          <div id="tm-seg-read" style="width: 0%; background: #3b82f6; transition: width 0.3s ease;" title="文件读取与工具"></div>
          <div id="tm-seg-think" style="width: 0%; background: #10b981; transition: width 0.3s ease;" title="思考推理"></div>
          <div id="tm-seg-out" style="width: 0%; background: #f97316; transition: width 0.3s ease;" title="历史生成输出"></div>
        </div>

        <!-- 2x2 Legend: Clean, Non-wrapping Grid -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px 16px; font-size: 11px; color: var(--muted-foreground, #71717a); margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border, rgba(128,128,128,0.1));">
          <div style="display: flex; justify-content: space-between; align-items: center; white-space: nowrap;">
            <span style="display: flex; align-items: center; gap: 5px;"><span style="width: 6px; height: 6px; border-radius: 50%; background: #eab308; flex-shrink: 0;"></span>预设</span>
            <span id="tm-seg-turn0-txt" style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; color: var(--foreground, #0a0a0c);">0k</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; white-space: nowrap;">
            <span style="display: flex; align-items: center; gap: 5px;"><span style="width: 6px; height: 6px; border-radius: 50%; background: #3b82f6; flex-shrink: 0;"></span>读取</span>
            <span id="tm-seg-read-txt" style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; color: var(--foreground, #0a0a0c);">0k</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; white-space: nowrap;">
            <span style="display: flex; align-items: center; gap: 5px;"><span style="width: 6px; height: 6px; border-radius: 50%; background: #10b981; flex-shrink: 0;"></span>思考</span>
            <span id="tm-seg-think-txt" style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; color: var(--foreground, #0a0a0c);">0k</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; white-space: nowrap;">
            <span style="display: flex; align-items: center; gap: 5px;"><span style="width: 6px; height: 6px; border-radius: 50%; background: #f97316; flex-shrink: 0;"></span>回复</span>
            <span id="tm-seg-out-txt" style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; color: var(--foreground, #0a0a0c);">0k</span>
          </div>
        </div>

        <!-- 2. Cache Rate & Status (Strictly NO "保鲜") -->
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span style="color: var(--muted-foreground, #71717a);">Prompt 缓存率</span>
          <span id="tm-pop-cache" style="font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; color: #0284c7;">0.0%</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span style="color: var(--muted-foreground, #71717a);">缓存读取 / 新增</span>
          <span id="tm-pop-cache-tokens" style="color: var(--muted-foreground, #71717a); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px;">0k / 0k</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border, rgba(128,128,128,0.1));">
          <span style="color: var(--muted-foreground, #71717a);">缓存状态</span>
          <span id="tm-pop-freshness" style="font-weight: 500; font-size: 11.5px; color: #10b981;">有效 · 距上轮 0 秒</span>
        </div>

        <!-- 3. Official Account Quotas WITH VISUAL PROGRESS BARS -->
        <div id="tm-quota-section" style="margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border, rgba(128,128,128,0.1));">
          <!-- 5 Hours Quota -->
          <div style="margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
              <span style="color: var(--muted-foreground, #71717a);">5小时限额</span>
              <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px;">
                <strong id="tm-q5h-pct" style="color: var(--foreground, #0a0a0c); font-weight: 600;">100%</strong> · <span id="tm-q5h-reset" style="color: var(--muted-foreground, #71717a);">--</span>
              </span>
            </div>
            <div style="height: 4px; border-radius: 9999px; background: var(--border, rgba(128,128,128,0.18)); overflow: hidden;">
              <div id="tm-q5h-bar" style="height: 100%; width: 100%; border-radius: 9999px; background: #10b981; transition: width 0.4s ease, background-color 0.3s ease;"></div>
            </div>
          </div>

          <!-- Weekly Quota -->
          <div>
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
              <span style="color: var(--muted-foreground, #71717a);">周限额</span>
              <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px;">
                <strong id="tm-qwk-pct" style="color: var(--foreground, #0a0a0c); font-weight: 600;">100%</strong> · <span id="tm-qwk-reset" style="color: var(--muted-foreground, #71717a);">--</span>
              </span>
            </div>
            <div style="height: 4px; border-radius: 9999px; background: var(--border, rgba(128,128,128,0.18)); overflow: hidden;">
              <div id="tm-qwk-bar" style="height: 100%; width: 100%; border-radius: 9999px; background: #3b82f6; transition: width 0.4s ease, background-color 0.3s ease;"></div>
            </div>
          </div>
        </div>

        <!-- 4. Speed -->
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="color: var(--muted-foreground, #71717a);">生成吞吐速度</span>
          <span id="tm-pop-speed" style="font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; color: #10b981;">~0 t/s</span>
        </div>
      </div>
    `;

    autoBtn.before(wrapper);

    const pillEl = wrapper.querySelector('#token-monitor-bottom-pill');
    const popEl = wrapper.querySelector('#token-monitor-popover');

    pillEl.onmouseenter = () => {
      pillEl.style.backgroundColor = 'var(--secondary, rgba(128,128,128,0.1))';
    };
    pillEl.onmouseleave = () => {
      pillEl.style.backgroundColor = 'transparent';
    };

    // CLICK ONLY TO TOGGLE
    pillEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isShown = popEl.style.display === 'block';
      popEl.style.display = isShown ? 'none' : 'block';
    });

    popEl.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    if (!window.__tokenMonitorClickOutsideV11) {
      window.__tokenMonitorClickOutsideV11 = true;
      document.addEventListener('click', (e) => {
        const wrap = document.getElementById('token-monitor-wrapper');
        if (wrap && !wrap.contains(e.target)) {
          const pop = document.getElementById('token-monitor-popover');
          if (pop) pop.style.display = 'none';
        }
      });
    }
  }

  if (autoBtn && wrapper.nextElementSibling !== autoBtn) {
    autoBtn.before(wrapper);
  }

  // Responsive narrow check
  const isNarrow = footer.clientWidth < 460;
  const pctTextEl = document.getElementById('tm-pct-text');
  if (pctTextEl) {
    pctTextEl.style.display = isNarrow ? 'none' : 'inline';
  }

  // IN-PLACE METRICS UPDATE
  const pct = data.quotaPercent || 0;
  const circ = 40.84;
  const offset = Math.max(circ - (pct / 100) * circ, 0);
  const ringColor = pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#10b981';

  const ringCircle = document.getElementById('tm-ring-circle');
  if (ringCircle) {
    ringCircle.style.strokeDashoffset = offset;
    ringCircle.setAttribute('stroke', ringColor);
  }

  if (pctTextEl && pctTextEl.textContent !== pct.toFixed(1) + '%') {
    pctTextEl.textContent = pct.toFixed(1) + '%';
  }

  const popPct = document.getElementById('tm-pop-pct');
  if (popPct) {
    popPct.textContent = pct.toFixed(1) + '%';
    popPct.style.color = ringColor;
  }

  const popCtx = document.getElementById('tm-pop-ctx');
  if (popCtx) popCtx.textContent = `${data.totalInputK}k / ${data.maxCtxK}k`;

  // 4 Segments: proportional to Antigravity's true context limit!
  const b = data.breakdown || {};
  const segT0 = document.getElementById('tm-seg-turn0');
  const segRd = document.getElementById('tm-seg-read');
  const segTh = document.getElementById('tm-seg-think');
  const segOt = document.getElementById('tm-seg-out');
  if (segT0) segT0.style.width = (b.turn0WindowPct || 0) + '%';
  if (segRd) segRd.style.width = (b.readWindowPct || 0) + '%';
  if (segTh) segTh.style.width = (b.thinkWindowPct || 0) + '%';
  if (segOt) segOt.style.width = (b.outWindowPct || 0) + '%';

  const t0Txt = document.getElementById('tm-seg-turn0-txt');
  const rdTxt = document.getElementById('tm-seg-read-txt');
  const thTxt = document.getElementById('tm-seg-think-txt');
  const otTxt = document.getElementById('tm-seg-out-txt');
  if (t0Txt) t0Txt.textContent = (b.turn0K || 0) + 'k';
  if (rdTxt) rdTxt.textContent = (b.readK || 0) + 'k';
  if (thTxt) thTxt.textContent = (b.thinkK || 0) + 'k';
  if (otTxt) otTxt.textContent = (b.outK || 0) + 'k';

  // Cache
  const popCache = document.getElementById('tm-pop-cache');
  if (popCache) popCache.textContent = `${data.cacheRate.toFixed(1)}%`;

  const popCacheTokens = document.getElementById('tm-pop-cache-tokens');
  if (popCacheTokens) popCacheTokens.textContent = `${data.cacheTokensK}k / ${data.inputTokensK}k`;

  // Cache Status
  const freshEl = document.getElementById('tm-pop-freshness');
  if (freshEl) {
    freshEl.textContent = data.cacheStatusText || '有效 · 距上轮 0 秒';
    freshEl.style.color = data.cacheStatusColor || '#10b981';
  }

  // Quotas WITH PROGRESS BARS
  if (data.quota5h) {
    const q5Pct = document.getElementById('tm-q5h-pct');
    const q5Rst = document.getElementById('tm-q5h-reset');
    const q5Bar = document.getElementById('tm-q5h-bar');
    if (q5Pct) q5Pct.textContent = data.quota5h.remainingPct + '%';
    if (q5Rst) q5Rst.textContent = data.quota5h.resetText;
    if (q5Bar) {
      q5Bar.style.width = data.quota5h.remainingPct + '%';
      q5Bar.style.backgroundColor = data.quota5h.remainingPct < 20 ? '#ef4444' : data.quota5h.remainingPct < 50 ? '#f59e0b' : '#10b981';
    }
  }

  if (data.quotaWeekly) {
    const qWkPct = document.getElementById('tm-qwk-pct');
    const qWkRst = document.getElementById('tm-qwk-reset');
    const qWkBar = document.getElementById('tm-qwk-bar');
    if (qWkPct) qWkPct.textContent = data.quotaWeekly.remainingPct + '%';
    if (qWkRst) qWkRst.textContent = data.quotaWeekly.resetText;
    if (qWkBar) {
      qWkBar.style.width = data.quotaWeekly.remainingPct + '%';
      qWkBar.style.backgroundColor = data.quotaWeekly.remainingPct < 20 ? '#ef4444' : data.quotaWeekly.remainingPct < 50 ? '#f59e0b' : '#3b82f6';
    }
  }

  // Speed
  const popSpeed = document.getElementById('tm-pop-speed');
  if (popSpeed) popSpeed.textContent = `~${data.speed} t/s`;

  return 'mounted v11';
}

async function tick() {
  const port = readCdpPort();
  if (!port) return;

  let targets;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
      headers: { Host: `localhost:${port}` },
    });
    targets = await res.json();
  } catch {
    return;
  }

  const pages = targets.filter(
    (t) => t.type === 'page' && /^https?:\/\/127\.0\.0\.1/.test(t.url || '') && t.webSocketDebuggerUrl
  );

  for (const t of pages) {
    try {
      const entry = sockets.get(t.id) || (await connect(t));
      const pathname = (await evaluate(entry, 'location.pathname')) || '';
      const match = pathname.match(/\/c\/([0-9a-f-]{36})/);
      const convId = resolveActiveConvId(match ? match[1] : '');
      const metrics = await computeMetrics(convId);
      if (metrics) {
        await evaluate(entry, `(${pageMount.toString()})(${JSON.stringify(metrics)})`);
      }
    } catch (e) {
      sockets.delete(t.id);
    }
  }
}

setInterval(tick, INTERVAL_MS);
console.log('[token-monitor] background daemon running v11 with dynamic context limit resolution (256k/160k), quota bars, and proper technical terminology...');
