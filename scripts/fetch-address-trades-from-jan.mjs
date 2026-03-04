#!/usr/bin/env node
/**
 * 从 1 月至今抓取指定地址在 Polymarket 上的全部历史交易，支持断点续传。
 * 规则：Polymarket 单次时间区间内最多返回 3000 条。每次请求按开始时间正序排序，
 * 区间为 [起始时间, 当前时间]；用本批「最近时间」作为下一批的起始时间，直到无新数据。
 *
 * 使用方式（需代理，与 fetch-address-trades.mjs 相同）：
 *   node scripts/fetch-address-trades-from-jan.mjs
 *   PROXY=127.0.0.1:7890 node scripts/fetch-address-trades-from-jan.mjs
 *
 * 断点续传：中断后再次执行同一命令即可从未完成的地址继续。
 */

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DATA_API_BASE = 'https://data-api.polymarket.com';
const ACTIVITY_PATHS = ['/activity', '/v1/activity'];
const BATCH_SIZE = 500;
const MAX_ACTIVITY_OFFSET = 3000; // Polymarket 单时间区间内最多 3000 条
const JAN_1_2025_UTC = 1735689600; // 2025-01-01 00:00:00 UTC
const DELAY_MS = 600;

const TEST_ADDRESS = process.argv[2]?.trim();
const isTestSingle = TEST_ADDRESS?.toLowerCase().startsWith('0x') && TEST_ADDRESS.length === 42;

const PROGRESS_FILE = path.join(
  DATA_DIR,
  isTestSingle ? 'address-trades-jan-progress-test.json' : 'address-trades-jan-progress.json'
);
const OUTPUT_CSV = path.join(
  DATA_DIR,
  isTestSingle ? 'address-trades-from-jan-test.csv' : 'address-trades-from-jan.csv'
);
const ADDRESSES_FILE = path.join(DATA_DIR, 'addresses-jan.txt');

const proxyRaw = process.env.PROXY || '127.0.0.1:7890';
const useProxy = proxyRaw && proxyRaw !== '0' && proxyRaw.toLowerCase() !== 'false';
const [proxyHost, proxyPort] = proxyRaw.includes(':') ? proxyRaw.split(':') : ['127.0.0.1', '7890'];
const PROXY_CONFIG = {
  host: proxyHost.trim(),
  port: parseInt(proxyPort?.trim() || '7890', 10),
  protocol: 'http',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeTs(ts) {
  if (ts == null) return 0;
  const n = Number(ts);
  return n > 1e10 ? Math.floor(n / 1000) : Math.floor(n);
}

function formatTime(tsSec) {
  if (!tsSec) return '';
  const d = new Date(tsSec * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function createDataApiClient() {
  const config = {
    timeout: 60000,
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; Polyview/1.0)' },
  };
  if (useProxy) {
    const proxyUrl = `http://${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`;
    config.httpsAgent = new HttpsProxyAgent(proxyUrl);
    config.proxy = false;
  }
  return axios.create(config);
}

const dataApiClient = createDataApiClient();

const WINDOW_RETRIES = 3;
const isRetryableNetworkError = (e) =>
  e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED' || e.code === 'ENETUNREACH';

/** 拉取一页：指定时间范围 [startTs, endTs]，按时间正序，offset 分页；网络错误时自动重试 */
async function fetchActivityWindow(user, startTs, endTs, offset, sortAsc = true) {
  const params = new URLSearchParams({
    user,
    limit: String(BATCH_SIZE),
    offset: String(offset),
    sortBy: 'TIMESTAMP',
    sortDirection: sortAsc ? 'ASC' : 'DESC',
    excludeDepositsWithdrawals: 'true',
    start: String(startTs),
    end: String(endTs),
  });
  for (const path of ACTIVITY_PATHS) {
    for (let r = 0; r <= WINDOW_RETRIES; r++) {
      try {
        const res = await dataApiClient.get(`${DATA_API_BASE}${path}?${params}`);
        const data = res.data;
        if (Array.isArray(data)) return data;
        break;
      } catch (err) {
        if (err.response?.status === 404 && path === '/activity') {
          break;
        }
        if (r < WINDOW_RETRIES && isRetryableNetworkError(err)) {
          await sleep(1500 * (r + 1));
          continue;
        }
        throw err;
      }
    }
  }
  return [];
}

/**
 * 拉取一个地址在 [startTs, endTs] 内所有活动。
 * 按开始时间正序请求，每批最多 3000 条；用本批最大时间戳+1 作为下一批起点，直到无数据。
 */
async function fetchAddressFromStartToEnd(user, startTs, endTs) {
  const out = [];
  let currentStart = startTs;

  while (currentStart <= endTs) {
    let offset = 0;
    let segment = [];
    let segmentMaxTs = 0;

    while (offset < MAX_ACTIVITY_OFFSET) {
      const batch = await fetchActivityWindow(user, currentStart, endTs, offset, true);
      const onlyTradeOrRedeem = (batch || []).filter(
        (a) => a.type === 'TRADE' || a.type === 'REDEEM'
      );
      if (onlyTradeOrRedeem.length > 0) {
        segment.push(...onlyTradeOrRedeem);
        for (const a of onlyTradeOrRedeem) {
          const ts = normalizeTs(a.timestamp);
          if (ts > segmentMaxTs) segmentMaxTs = ts;
        }
      }
      if (!Array.isArray(batch) || batch.length < BATCH_SIZE) break;
      offset += batch.length;
      await sleep(DELAY_MS);
    }

    if (segment.length === 0) break;

    out.push(...segment);
    currentStart = segmentMaxTs + 1;
    await sleep(DELAY_MS);
  }

  return out;
}

function activityToRow(address, a) {
  const ts = normalizeTs(a.timestamp);
  const size = Math.abs(parseFloat(a.size ?? 0));
  const usdcSize = Math.abs(parseFloat(a.usdcSize ?? 0));
  const price = parseFloat(a.price ?? 0);
  const totalCost = usdcSize > 0 ? usdcSize : size * (price || 0);

  let typeZh = '买入';
  if (a.type === 'REDEEM') typeZh = 'Claim';
  else if (a.side && String(a.side).toUpperCase() === 'SELL') typeZh = '卖出';
  else if (a.side && String(a.side).toUpperCase() === 'BUY') typeZh = '买入';

  return {
    地址: address,
    交易类型: typeZh,
    原始类型: a.type || '',
    数量: size.toFixed(4),
    金额USDC: totalCost.toFixed(2),
    价格: (price || 0).toFixed(4),
    时间: formatTime(ts),
    时间戳: ts,
    市场命题: (a.title || a.question || '').replace(/"/g, '""'),
    outcome: a.outcome || '',
    conditionId: a.conditionId || '',
    tokenId: (a.asset ?? a.tokenId ?? '').toString().trim(),
    transactionHash: a.transactionHash || '',
  };
}

function escapeCsvField(v) {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const CSV_HEADERS = [
  '地址', '交易类型', '原始类型', '数量', '金额USDC', '价格', '时间', '时间戳',
  '市场命题', 'outcome', 'conditionId', 'tokenId', 'transactionHash',
];

function rowToCsvLine(row) {
  return CSV_HEADERS.map((h) => escapeCsvField(row[h])).join(',');
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadAddresses() {
  const raw = fs.readFileSync(ADDRESSES_FILE, 'utf8');
  const list = raw
    .split(/\n/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.startsWith('0x') && s.length === 42);
  const seen = new Set();
  return list.filter((a) => {
    if (seen.has(a)) return false;
    seen.add(a);
    return true;
  });
}

function loadProgress() {
  ensureDataDir();
  if (!fs.existsSync(PROGRESS_FILE)) {
    return {
      completedAddresses: [],
      currentAddress: null,
      currentAddressStartTs: null,
    };
  }
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    return {
      completedAddresses: Array.isArray(data.completedAddresses) ? data.completedAddresses : [],
      currentAddress: data.currentAddress ?? null,
      currentAddressStartTs:
        typeof data.currentAddressStartTs === 'number' ? data.currentAddressStartTs : null,
    };
  } catch (e) {
    return {
      completedAddresses: [],
      currentAddress: null,
      currentAddressStartTs: null,
    };
  }
}

function saveProgress(progress) {
  ensureDataDir();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf8');
}

function appendRowsToCsv(rows) {
  ensureDataDir();
  const exists = fs.existsSync(OUTPUT_CSV);
  const lines = [];
  if (!exists) {
    lines.push('\uFEFF' + CSV_HEADERS.map(escapeCsvField).join(','));
  }
  for (const row of rows) {
    lines.push(rowToCsvLine(row));
  }
  fs.appendFileSync(OUTPUT_CSV, lines.join('\n') + '\n', 'utf8');
}

/** 解析单行 CSV（支持双引号包裹含逗号字段） */
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

/** 启动时对已有 CSV 按 (地址, transactionHash, conditionId, tokenId) 去重，避免断点续传时重复追加 */
function deduplicateExistingCsv() {
  if (!fs.existsSync(OUTPUT_CSV)) return;
  const raw = fs.readFileSync(OUTPUT_CSV, 'utf8');
  const lines = raw.split(/\r?\n/).filter((s) => s.trim());
  if (lines.length < 2) return;
  const headerLine = lines[0];
  const header = parseCsvLine(headerLine.replace(/^\uFEFF/, ''));
  const addrIdx = header.indexOf('地址');
  const txIdx = header.indexOf('transactionHash');
  const cidIdx = header.indexOf('conditionId');
  const tokenIdx = header.indexOf('tokenId');
  if (addrIdx < 0 || txIdx < 0 || cidIdx < 0) return;
  const seen = new Map();
  const kept = [headerLine];
  let dupCount = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const addr = (cells[addrIdx] ?? '').trim();
    const tx = (cells[txIdx] ?? '').trim();
    const cid = (cells[cidIdx] ?? '').trim();
    const token = tokenIdx >= 0 ? (cells[tokenIdx] ?? '').trim() : '';
    const key = `${addr}|${tx}|${cid}|${token}`;
    if (seen.has(key)) {
      dupCount++;
      continue;
    }
    seen.set(key, true);
    kept.push(lines[i]);
  }
  if (dupCount > 0) {
    fs.writeFileSync(OUTPUT_CSV, kept.join('\n') + '\n', 'utf8');
    process.stderr.write(`[去重] 已移除 ${dupCount} 条重复，保留 ${kept.length - 1} 条\n`);
  }
}

async function main() {
  ensureDataDir();
  deduplicateExistingCsv();
  const addresses = isTestSingle
    ? [TEST_ADDRESS.toLowerCase()]
    : loadAddresses();
  if (addresses.length === 0) {
    console.error('未找到有效地址，请检查 ' + ADDRESSES_FILE);
    process.exit(1);
  }
  if (isTestSingle) {
    console.log('单地址测试模式:', TEST_ADDRESS, '| 输出:', OUTPUT_CSV, '\n');
  }

  const progress = loadProgress();
  const completedSet = new Set(progress.completedAddresses.map((a) => a.toLowerCase()));
  const nowSec = Math.floor(Date.now() / 1000);

  let toProcess = [];
  if (progress.currentAddress && progress.currentAddressStartTs != null) {
    toProcess.push({
      address: progress.currentAddress.toLowerCase(),
      startTs: progress.currentAddressStartTs,
    });
  }
  for (const addr of addresses) {
    const a = addr.toLowerCase();
    if (completedSet.has(a)) continue;
    if (!toProcess.some((p) => p.address === a)) {
      toProcess.push({ address: a, startTs: JAN_1_2025_UTC });
    }
  }

  console.log(
    (useProxy ? `代理: ${PROXY_CONFIG.host}:${PROXY_CONFIG.port} | ` : '无代理 | ') +
      `已完成: ${progress.completedAddresses.length} | 待处理: ${toProcess.length} | 输出: ${OUTPUT_CSV}\n`
  );

  const MAX_RETRIES = 4;

  for (let i = 0; i < toProcess.length; i++) {
    const { address, startTs } = toProcess[i];
    process.stderr.write(`[${i + 1}/${toProcess.length}] ${address} (从 ${formatTime(startTs)} 到当前) ... `);

    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const activities = await fetchAddressFromStartToEnd(address, startTs, nowSec);
        const rows = activities.map((a) => activityToRow(address, a));

        const dedup = new Map();
        for (const r of rows) {
          const key = `${r.transactionHash || ''}_${r.conditionId || ''}_${r.tokenId || ''}`;
          if (!dedup.has(key)) dedup.set(key, r);
        }
        const uniqueRows = Array.from(dedup.values()).sort((a, b) => (b.时间戳 || 0) - (a.时间戳 || 0));

        appendRowsToCsv(uniqueRows);

        completedSet.add(address);
        const nextItem = toProcess[i + 1];
        const nextAddress = nextItem ? nextItem.address : null;
        const nextStartTs = nextItem != null ? nextItem.startTs : null;

        saveProgress({
          completedAddresses: Array.from(completedSet),
          currentAddress: nextAddress,
          currentAddressStartTs: nextStartTs,
        });

        process.stderr.write(`${uniqueRows.length} 条\n`);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        if (attempt < MAX_RETRIES) {
          process.stderr.write(`重试 ${attempt + 1}/${MAX_RETRIES} ... `);
          await sleep(3000 * (attempt + 1));
        } else {
          saveProgress({
            completedAddresses: Array.from(completedSet),
            currentAddress: address,
            currentAddressStartTs: startTs,
          });
          process.stderr.write(`失败: ${e.message}\n`);
        }
      }
    }

    if (i < toProcess.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n已完成 ${completedSet.size} 个地址，结果已追加到 ${OUTPUT_CSV}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
