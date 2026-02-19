#!/usr/bin/env node
/**
 * 抓取指定地址列表在 Polymarket 上的全部历史买入/卖出/Claim 交易，导出为 CSV 表格。
 *
 * 使用方式一（推荐，需先启动 Next 服务）：
 *   npm run dev
 *   node scripts/fetch-address-trades.mjs --api
 *
 * 使用方式二（直连 Polymarket API）：
 *   node scripts/fetch-address-trades.mjs
 *
 * 使用代理（默认 127.0.0.0:7890，可通过 PROXY 覆盖）：
 *   node scripts/fetch-address-trades.mjs
 *   或 PROXY=127.0.0.1:7890 node scripts/fetch-address-trades.mjs
 */

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

const DATA_API_BASE = 'https://data-api.polymarket.com';
const LOCAL_API_BASE = 'http://localhost:3010';
const BATCH_SIZE = 100; // 单次请求上限，兼容只支持 100 的环境
const MAX_ACTIVITY_OFFSET = 3000; // Polymarket API：offset 超过 3000 会返回 400
const ACTIVITY_PATHS = ['/activity', '/v1/activity'];
const DELAY_MS = 600;

const useLocalApi = process.argv.includes('--api');
const BASE_URL = useLocalApi ? LOCAL_API_BASE : DATA_API_BASE;

// 代理：默认 127.0.0.0:7890，可通过 PROXY=host:port 覆盖
const proxyRaw = process.env.PROXY || '127.0.0.0:7890';
const [proxyHost, proxyPort] = proxyRaw.includes(':')
  ? proxyRaw.split(':')
  : ['127.0.0.0', '7890'];
const PROXY_CONFIG = {
  host: proxyHost.trim(),
  port: parseInt(proxyPort?.trim() || '7890', 10),
  protocol: 'http',
};

const ADDRESSES = [
  '0x38cc5Cf506aff32B8E26c5d19C7b288561805C4F',
  '0x20Ac30EDbee5577e9279795178F230ad43493dE7',
  '0xCda1e8FC6654860B0B1D2F7CC418909FB3548456',
  '0xD38a846aEA68599aEAD11B4BF963c46b1f483E9B',
  '0xBbCEb2ACd5b3b136D48afaDA56bf6C7aC350Ac40',
  '0xDDc8Ce431F0628BDDE5FB850A2Cb73b2e5Bce34A',
  '0xd8Eb5aa1e985cF72af46EcEd98C383cFC478db32',
  '0x3cA984f8A437e82DA7e2F7Ed9A981832bE5825fB',
  '0x8b1e3addFc82BDDa7FCE3EfF7F55aA2Cd784aDeE',
  '0x8e94835dB4391068b399c92a7A85C0A021b0d388',
  '0xd62BeC02Ee81a048b5A1D8101A7940FAab28f255',
  '0x79be65ef025497dD15b8e2149d1aE5F0A3275C46',
  '0x2B06AE5260dA8b636198eAEf9003672d8e66510B',
  '0xB08d79b2F3da32447bEdf673F3E5Db3316BbB1cF',
  '0xC789151B4dd1F4fd16044742Ab17AAa895ae10FD',
  '0x8Ec4C13da685b5505399889012A57b954Fb246c2',
  '0x56902B49d3EBa59C3f407e7Ae9dc51e8Ee05C796',
  '0x9672D402a8eab028646C5fEbeA41eB73dE28CEa5',
  '0x1726D9A25c9F6B3c1F626a145329702bEc8De66F',
  '0x845b752818cA250f9F76A8E9f0A75e2fFA031737',
  '0xD0732b52234695cD948014384252638557069309',
  '0xf3ce8EcD84ed109B1F14e579eB1313A55f38EDC5',
  '0xf97a2Da1D9b5Ddb47B0F3522094454207144Ab4C',
  '0xa0BCa7E4ad4B04064D4849DB982cB8f216004738',
  '0xE64FeDd3907989EeE403B43AF45694658F32888D',
  '0xafFd754D9c75bbffcC25907B0296B105F1339e13',
  '0xB1E14DDC10e6B2DA1c4ac3A8EA5EAb787687087d',
  '0x399e78014785a9EcEDDcA1E7B60775b5FF5F89a4',
  '0xafcffaa688CC3a4F68A7e4c9e2EF9E3E5b8E034e',
  '0x645625A7A95390Da7f788b9800FDA743FaB1b930',
  '0x7FBcD2972e168700e220c5FC84AE9ECe91823A1E',
  '0x600425209bABf681D08255c491836A3Bac2587d4',
  '0xf003f74F38078cDCA76bA6717dbfa55bC2AC873A',
  '0x2F7e528744295d434b1b5422e2e6e7d4197C28B4',
  '0x6693bF5c58a429251b7AA5c08787b4ccd905327c',
  '0xaF588DBf4c6e44A916DaCE1e61D2EE04f17b0689',
  '0xD3C1631aD4cC3B4ebF078FD746DAeab088DBb5BB',
  '0xd7d6ab494364F1A7F4BCA660BDf108701a4e2C1D',
  '0x4EA9716eEBEe0AfD679D02BDe9f11C9c6BE70736',
  '0xCf087bD0640A67f26E1069b43B11a51D05ac9AC1',
  '0x1CC8849EE9dd32331f46E2d4cDebe70fb1B6f9A7',
  '0xEbb16b8697A7D3f24BEbd1c493C4F278544c5121',
  '0x38cd871AC31956A5a97cfA355c77De8Af9A87bf7',
  '0xACF84c74d728FaC60d86baE2eE198877cFF2D90A',
  '0x28b736feE9BE3a3b1cE1D2a6501e44e7497E1958',
  '0xcd9CA3ceFeD34042dD62A4C62E10c8E72ee111C7',
  '0x94D17A0245EF0d477424956d155bBD605d8D9b22',
];

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
  const proxyUrl = `http://${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`;
  const httpsAgent = new HttpsProxyAgent(proxyUrl);
  return axios.create({
    timeout: 60000,
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; Polyview/1.0)' },
    httpsAgent,
    proxy: false, // 已用 agent，不再用 axios 的 proxy 选项
  });
}

const dataApiClient = createDataApiClient();

async function fetchPageDataApi(user, offset) {
  const params = new URLSearchParams({
    user,
    limit: String(BATCH_SIZE),
    offset: String(offset),
    sortBy: 'TIMESTAMP',
    sortDirection: 'DESC',
    excludeDepositsWithdrawals: 'true',
  });
  for (const path of ACTIVITY_PATHS) {
    try {
      const res = await dataApiClient.get(`${DATA_API_BASE}${path}?${params}`);
      const data = res.data;
      if (Array.isArray(data)) return data;
      break;
    } catch (err) {
      if (err.response?.status === 404 && path === '/activity') continue;
      throw err;
    }
  }
  return [];
}

async function fetchAllActivityViaDataApi(user) {
  const out = [];
  let offset = 0;
  for (;;) {
    if (offset >= MAX_ACTIVITY_OFFSET) break;
    const batch = await fetchPageDataApi(user, offset);
    if (!Array.isArray(batch) || batch.length === 0) break;
    const onlyTradeOrRedeem = batch.filter(
      (a) => a.type === 'TRADE' || a.type === 'REDEEM'
    );
    out.push(...onlyTradeOrRedeem);
    if (batch.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
    await sleep(DELAY_MS);
  }
  return out;
}

async function fetchAllActivityViaLocalApi(user) {
  const url = new URL(`${LOCAL_API_BASE}/api/activity`);
  url.searchParams.set('user', user);
  url.searchParams.set('limit', '-1');
  url.searchParams.set('sort_by', 'TIMESTAMP');
  url.searchParams.set('sort_direction', 'DESC');
  url.searchParams.set('use_cache', 'false');

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const json = await res.json();
  if (!json.success || !Array.isArray(json.data)) throw new Error(json.error || 'API 返回格式错误');
  return json.data.filter((a) => a.type === 'TRADE' || a.type === 'REDEEM');
}

async function fetchAllActivityForUser(user) {
  if (useLocalApi) return fetchAllActivityViaLocalApi(user);
  return fetchAllActivityViaDataApi(user);
}

function activityToRow(address, a) {
  const ts = normalizeTs(a.timestamp);
  const size = Math.abs(parseFloat(a.size ?? 0));
  const usdcSize = Math.abs(parseFloat(a.usdcSize ?? 0));
  const price = parseFloat(a.price ?? 0);
  const totalCost = usdcSize > 0 ? usdcSize : size * (price || 0);

  let typeZh = '买入';
  if (a.type === 'REDEEM') {
    typeZh = 'Claim';
  } else if (a.side && String(a.side).toUpperCase() === 'SELL') {
    typeZh = '卖出';
  } else if (a.side && String(a.side).toUpperCase() === 'BUY') {
    typeZh = '买入';
  }

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

function toCsv(rows) {
  const headers = [
    '地址', '交易类型', '原始类型', '数量', '金额USDC', '价格', '时间', '时间戳',
    '市场命题', 'outcome', 'conditionId', 'transactionHash',
  ];
  const lines = [headers.map(escapeCsvField).join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => escapeCsvField(r[h])).join(','));
  }
  return lines.join('\n');
}

async function main() {
  if (useLocalApi) {
    console.log('使用本地 API 模式 (需已运行 npm run dev)\n');
  } else {
    console.log(`直连 Polymarket Data API（代理 ${PROXY_CONFIG.host}:${PROXY_CONFIG.port}）\n`);
  }
  const allRows = [];
  const total = ADDRESSES.length;
  for (let i = 0; i < total; i++) {
    const addr = ADDRESSES[i].toLowerCase();
    process.stderr.write(`[${i + 1}/${total}] ${addr} ... `);
    try {
      const activities = await fetchAllActivityForUser(addr);
      const rows = activities.map((a) => activityToRow(addr, a));
      allRows.push(...rows);
      process.stderr.write(`${rows.length} 条\n`);
    } catch (e) {
      process.stderr.write(`失败: ${e.message}\n`);
    }
    if (i < total - 1) await sleep(DELAY_MS);
  }

  // 按时间倒序（最新在前）
  allRows.sort((a, b) => (b.时间戳 || 0) - (a.时间戳 || 0));

  const csv = toCsv(allRows);
  const outPath = 'address-trades.csv';
  const fs = await import('fs');
  fs.writeFileSync(outPath, '\uFEFF' + csv, 'utf8'); // BOM for Excel
  console.log(`\n已写入 ${allRows.length} 条记录到 ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
