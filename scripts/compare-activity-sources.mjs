#!/usr/bin/env node
/**
 * 小规模比对「旧源」与「新源」历史交易数据，确保切换数据源前无差异。
 *
 * 旧源: Polymarket Data API (https://data-api.polymarket.com/activity)
 * 新源: poly_activity 缓存后端 (https://www.polyking.site/activity 或 POLY_ACTIVITY_BASE)
 *
 * 使用:
 *   node scripts/compare-activity-sources.mjs [address]
 *   node scripts/compare-activity-sources.mjs 0x38cc5Cf506aff32B8E26c5d19C7b288561805C4F
 *   FROM_TS=1735689600 TO_TS=1738368000 node scripts/compare-activity-sources.mjs
 *   FULL=1 FROM_TS=1767225600 TO_TS=1769904000 node scripts/compare-activity-sources.mjs  # 全量比对，建议上线前用
 *   可选: PROXY=127.0.0.1:7890  POLY_ACTIVITY_BASE=https://www.polyking.site/activity
 *
 * 默认时间范围: 2025-01-01 00:00 UTC 至 2025-02-01 00:00 UTC（约 1 个月，小规模）
 * 建议: 上线前用 FULL=1 对 1～2 个真实地址做全量比对，确保「仅旧有/仅新有」为 0 且字段差异为 0。
 */

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_API_BASE = 'https://data-api.polymarket.com';
const ACTIVITY_PATH = '/activity';
const DEFAULT_POLY_ACTIVITY_BASE = 'https://www.polyking.site/activity';

// 默认小范围: 2025-01-01 00:00 UTC ~ 2025-02-01 00:00 UTC
const DEFAULT_FROM_TS = 1735689600;
const DEFAULT_TO_TS = 1738368000;
const LIMIT = 500;

const proxyRaw = process.env.PROXY || '';
const useProxy = proxyRaw && proxyRaw !== '0' && proxyRaw.toLowerCase() !== 'false';
const [proxyHost, proxyPort] = proxyRaw.includes(':') ? proxyRaw.split(':') : ['127.0.0.1', '7890'];
const proxyUrl = useProxy ? `http://${proxyHost.trim()}:${proxyPort?.trim() || '7890'}` : null;

const POLY_ACTIVITY_BASE = (process.env.POLY_ACTIVITY_BASE || DEFAULT_POLY_ACTIVITY_BASE).replace(/\/$/, '');

function createDataApiClient() {
  const config = {
    timeout: 30000,
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; Polyview-compare/1.0)' },
  };
  if (proxyUrl) {
    config.httpsAgent = new HttpsProxyAgent(proxyUrl);
    config.proxy = false;
  }
  return axios.create(config);
}

function createPolyActivityClient() {
  const config = {
    timeout: 30000,
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; Polyview-compare/1.0)' },
  };
  if (proxyUrl) {
    config.httpsAgent = new HttpsProxyAgent(proxyUrl);
    config.proxy = false;
  }
  return axios.create(config);
}

const dataApiClient = createDataApiClient();
const polyActivityClient = createPolyActivityClient();

function normalizeTs(v) {
  if (v == null) return 0;
  const n = Number(v);
  return n > 1e10 ? Math.floor(n / 1000) : Math.floor(n);
}

/**
 * 旧源单条: Polymarket 原始字段 (camelCase)
 * timestamp, type, size, usdcSize, price, title, outcome, conditionId, tokenId/asset, transactionHash, side
 */
/** 旧源 type+side → 与新源一致的统一 type：TRADE+BUY→BUY, TRADE+SELL→SELL, REDEEM→REDEEM */
function normalTypeOld(a) {
  const type = (a.type ?? 'TRADE').toUpperCase();
  const side = (a.side ?? '').toUpperCase();
  if (type === 'REDEEM') return 'REDEEM';
  if (side === 'BUY' || side === 'SELL') return side;
  return type;
}

function normalizeOldItem(addr, a) {
  const ts = normalizeTs(a.timestamp);
  const size = Math.abs(parseFloat(a.size ?? 0));
  const price = parseFloat(a.price ?? 0);
  const conditionId = (a.conditionId ?? '').toString().trim().toLowerCase();
  const tokenId = (a.tokenId ?? a.asset ?? '').toString().trim();
  const transactionHash = (a.transactionHash ?? '').toString().trim().toLowerCase();
  const key = `${addr}|${transactionHash}|${conditionId}|${tokenId}`;
  return {
    key,
    ts,
    type: normalTypeOld(a),
    share: size,
    price,
    title: (a.title ?? a.question ?? '').trim(),
    outcome: (a.outcome ?? '').trim(),
    condition_id: conditionId,
    token_id: tokenId,
    transaction_hash: transactionHash,
    side: (a.side ?? '').toUpperCase(),
    usdc_size: parseFloat(a.usdcSize ?? 0),
  };
}

/**
 * 新源单条: poly_activity 返回 (可能是 ts, share, condition_id, token_id, transaction_hash 等)
 */
/** 新源 type 可能为 BUY/SELL/REDEEM，统一为大写 */
function normalTypeNew(a) {
  const t = (a.type ?? a.side ?? 'TRADE').toString().toUpperCase();
  if (t === 'REDEEM' || t === 'BUY' || t === 'SELL') return t;
  return t || 'TRADE';
}

function normalizeNewItem(addr, a) {
  const ts = normalizeTs(a.ts ?? a.timestamp);
  const share = Math.abs(parseFloat(a.share ?? a.size ?? 0));
  const price = parseFloat(a.price ?? 0);
  const conditionId = (a.condition_id ?? a.conditionId ?? '').toString().trim().toLowerCase();
  const tokenId = (a.token_id ?? a.tokenId ?? a.asset ?? '').toString().trim();
  const transactionHash = (a.transaction_hash ?? a.transactionHash ?? '').toString().trim().toLowerCase();
  const key = `${addr}|${transactionHash}|${conditionId}|${tokenId}`;
  return {
    key,
    ts,
    type: normalTypeNew(a),
    share,
    price,
    title: (a.title ?? a.question ?? '').trim(),
    outcome: (a.outcome ?? '').trim(),
    condition_id: conditionId,
    token_id: tokenId,
    transaction_hash: transactionHash,
  };
}

/** 用于比对的核心字段（忽略 title 微小差异、side 等） */
const COMPARE_FIELDS = ['ts', 'type', 'share', 'price', 'outcome', 'condition_id', 'token_id', 'transaction_hash'];

function compareRecords(oldR, newR) {
  const diffs = [];
  for (const f of COMPARE_FIELDS) {
    const ov = oldR[f];
    const nv = newR[f];
    const oStr = typeof ov === 'number' ? (Number.isFinite(ov) ? ov : '') : String(ov ?? '');
    const nStr = typeof nv === 'number' ? (Number.isFinite(nv) ? nv : '') : String(nv ?? '');
    const on = typeof ov === 'number' && Number.isFinite(ov) ? ov : oStr;
    const nn = typeof nv === 'number' && Number.isFinite(nv) ? nv : nStr;
    if (on !== nn) {
      diffs.push({ field: f, old: ov, new: nv });
    }
  }
  return diffs;
}

async function fetchOldSource(address, fromTs, toTs, limit) {
  const params = {
    user: address,
    start: fromTs,
    end: toTs,
    limit,
    sortBy: 'TIMESTAMP',
    sortDirection: 'ASC',
    excludeDepositsWithdrawals: 'true',
  };
  const url = `${DATA_API_BASE}${ACTIVITY_PATH}`;
  const res = await dataApiClient.get(url, { params });
  const data = Array.isArray(res.data) ? res.data : [];
  return data.map((a) => normalizeOldItem(address.toLowerCase(), a));
}

/** 旧源分页拉满 [fromTs, toTs] 区间 */
async function fetchOldSourceFull(address, fromTs, toTs) {
  const list = [];
  let offset = 0;
  const batchSize = 500;
  while (true) {
    const params = {
      user: address,
      start: fromTs,
      end: toTs,
      limit: batchSize,
      offset,
      sortBy: 'TIMESTAMP',
      sortDirection: 'ASC',
      excludeDepositsWithdrawals: 'true',
    };
    const res = await dataApiClient.get(`${DATA_API_BASE}${ACTIVITY_PATH}`, { params });
    const data = Array.isArray(res.data) ? res.data : [];
    if (data.length === 0) break;
    for (const a of data) list.push(normalizeOldItem(address.toLowerCase(), a));
    if (data.length < batchSize) break;
    offset += data.length;
    if (offset >= 3000) break; // Polymarket 单时间窗最多 3000
  }
  return list;
}

async function fetchNewSource(address, fromTs, toTs, limit) {
  const addr = address.toLowerCase();
  const url = `${POLY_ACTIVITY_BASE}/wallets/${encodeURIComponent(addr)}/activity`;
  const params = { from_ts: fromTs, to_ts: toTs, limit };
  const res = await polyActivityClient.get(url, { params });
  const body = res.data;
  const data = Array.isArray(body?.data) ? body.data : [];
  return data.map((a) => normalizeNewItem(addr, a));
}

/** 新源单次大 limit 拉取（若 API 支持分页可后续扩展） */
const NEW_SOURCE_FULL_LIMIT = 3000;

async function fetchNewSourceFull(address, fromTs, toTs) {
  const addr = address.toLowerCase();
  const url = `${POLY_ACTIVITY_BASE}/wallets/${encodeURIComponent(addr)}/activity`;
  const res = await polyActivityClient.get(url, {
    params: { from_ts: fromTs, to_ts: toTs, limit: NEW_SOURCE_FULL_LIMIT },
  });
  const body = res.data;
  const data = Array.isArray(body?.data) ? body.data : [];
  return data.map((a) => normalizeNewItem(addr, a));
}

function loadDefaultAddress() {
  const p = path.join(__dirname, 'data', 'addresses-jan.txt');
  if (!fs.existsSync(p)) return null;
  const line = fs.readFileSync(p, 'utf8').split(/\n/).map((s) => s.trim()).find((s) => /^0x[a-fA-F0-9]{40}$/.test(s));
  return line || null;
}

async function main() {
  const address = process.argv[2]?.trim() || loadDefaultAddress();
  if (!address || !address.startsWith('0x') || address.length !== 42) {
    console.error('用法: node scripts/compare-activity-sources.mjs [0x...]\n或设置 scripts/data/addresses-jan.txt 中有至少一个地址');
    process.exit(1);
  }

  const fromTs = parseInt(process.env.FROM_TS || String(DEFAULT_FROM_TS), 10);
  const toTs = parseInt(process.env.TO_TS || String(DEFAULT_TO_TS), 10);
  const addr = address.toLowerCase();
  const fullMode = process.env.FULL === '1' || process.env.FULL === 'true';

  console.log('=== 小规模比对：旧源 vs 新源 ===');
  console.log('地址:', addr);
  console.log('时间范围:', new Date(fromTs * 1000).toISOString(), '~', new Date(toTs * 1000).toISOString());
  console.log('新源基地址:', POLY_ACTIVITY_BASE);
  console.log('模式:', fullMode ? '全量（旧源分页拉满，新源 limit=' + NEW_SOURCE_FULL_LIMIT + '）' : '单页 limit=' + LIMIT);
  console.log('');

  let oldList = [];
  let newList = [];

  try {
    if (fullMode) {
      console.log('正在请求旧源 (Polymarket Data API，分页拉满)...');
      oldList = await fetchOldSourceFull(addr, fromTs, toTs);
    } else {
      console.log('正在请求旧源 (Polymarket Data API)...');
      oldList = await fetchOldSource(addr, fromTs, toTs, LIMIT);
    }
    console.log('旧源返回:', oldList.length, '条');
  } catch (e) {
    console.error('旧源请求失败:', e.message || e);
    if (e.response) console.error('状态:', e.response.status, e.response.data);
    process.exit(2);
  }

  try {
    if (fullMode) {
      console.log('正在请求新源 (poly_activity，limit=' + NEW_SOURCE_FULL_LIMIT + ')...');
      newList = await fetchNewSourceFull(addr, fromTs, toTs);
    } else {
      console.log('正在请求新源 (poly_activity)...');
      newList = await fetchNewSource(addr, fromTs, toTs, LIMIT);
    }
    console.log('新源返回:', newList.length, '条');
  } catch (e) {
    console.error('新源请求失败:', e.message || e);
    if (e.response) console.error('状态:', e.response.status, e.response.data);
    process.exit(3);
  }

  const oldByKey = new Map(oldList.map((r) => [r.key, r]));
  const newByKey = new Map(newList.map((r) => [r.key, r]));

  const onlyInOld = [...oldByKey.keys()].filter((k) => !newByKey.has(k));
  const onlyInNew = [...newByKey.keys()].filter((k) => !oldByKey.has(k));
  const commonKeys = [...oldByKey.keys()].filter((k) => newByKey.has(k));

  let fieldDiffs = [];
  for (const k of commonKeys) {
    const diffs = compareRecords(oldByKey.get(k), newByKey.get(k));
    if (diffs.length) fieldDiffs.push({ key: k, diffs });
  }

  console.log('');
  console.log('--- 比对结果 ---');
  console.log('旧源条数:', oldList.length);
  console.log('新源条数:', newList.length);
  console.log('共同 key 数:', commonKeys.length);
  console.log('仅旧源有:', onlyInOld.length);
  console.log('仅新源有:', onlyInNew.length);
  console.log('共同 key 中字段差异数:', fieldDiffs.length);

  if (onlyInOld.length > 0) {
    console.log('\n仅旧源有的 key（前 10）:');
    onlyInOld.slice(0, 10).forEach((k) => console.log(' ', k));
  }
  if (onlyInNew.length > 0) {
    console.log('\n仅新源有的 key（前 10）:');
    onlyInNew.slice(0, 10).forEach((k) => console.log(' ', k));
  }
  if (fieldDiffs.length > 0) {
    console.log('\n共同 key 的字段差异（前 5 条）:');
    fieldDiffs.slice(0, 5).forEach(({ key, diffs }) => {
      console.log(' ', key);
      diffs.forEach(({ field, old: o, new: n }) => console.log('   ', field, '旧:', o, '新:', n));
    });
  }

  const ok = onlyInOld.length === 0 && onlyInNew.length === 0 && fieldDiffs.length === 0;
  console.log('');
  if (ok) {
    console.log('结论: 小规模比对通过，两源在该时间区间内数据一致，可考虑上线切换。');
  } else {
    console.log('结论: 存在差异，请排查后再上线。');
    process.exit(1);
  }
}

main();
