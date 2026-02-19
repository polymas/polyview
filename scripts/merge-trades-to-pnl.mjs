#!/usr/bin/env node
/**
 * 读取 address-trades.csv，按「地址 + 市场(conditionId)」合并同一代币的买入/卖出/Claim，
 * 输出交易代币获利表格：address-market-pnl.csv
 *
 * 使用: node scripts/merge-trades-to-pnl.mjs [address-trades.csv]
 */

import { writeFileSync, createReadStream } from 'fs';
import { createInterface } from 'readline';

const inputPath = process.argv[2] || 'address-trades.csv';
const outputPath = 'address-market-pnl.csv';

// 排除的地址（小写），不参与汇总
const EXCLUDE_ADDRESSES = new Set(['0x38cc5cf506aff32b8e26c5d19c7b288561805c4f'].map((a) => a.toLowerCase()));
// 排除的 conditionId（小写），不参与汇总
const EXCLUDE_CONDITION_IDS = new Set([
  '0xfc98aa62bdcc0568c31fb97c6ef36f17e8675276dc42828194738b2273612328',
  '0xe6508d867d153a268bdab732aa8abc8cc57e652d28a23aa042da40895bf031b2',
].map((id) => id.toLowerCase()));

function parseCsvLine(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let s = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          s += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++;
          break;
        } else {
          s += line[i];
          i++;
        }
      }
      out.push(s);
    } else {
      let s = '';
      while (i < line.length && line[i] !== ',') {
        s += line[i];
        i++;
      }
      out.push(s);
      if (i < line.length) i++;
    }
  }
  return out;
}

function parseNum(s) {
  const n = parseFloat(String(s).trim());
  return Number.isFinite(n) ? n : 0;
}

function parseTs(s) {
  const n = parseInt(String(s).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function formatTime(tsSec) {
  if (tsSec == null || !Number.isFinite(tsSec)) return '';
  const d = new Date(tsSec * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

async function loadCsv(path) {
  const lines = [];
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    lines.push(line);
  }
  if (lines.length === 0) return { headers: [], rows: [] };
  const rawHeader = parseCsvLine(lines[0].replace(/^\uFEFF/, ''));
  const headers = rawHeader.map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    let cells = parseCsvLine(lines[i]);
    // 市场命题中含引号时可能被拆成两列，导致 13 列而 header 只有 12 列，outcome/conditionId 错位
    if (cells.length === headers.length + 1 && headers.length >= 10 && headers[8] === '市场命题') {
      cells[8] = (cells[8] + ',' + (cells[9] || '')).replace(/,\s*$/, '');
      cells.splice(9, 1);
    }
    const row = {};
    headers.forEach((h, j) => {
      row[h] = cells[j] !== undefined ? cells[j].trim() : '';
    });
    rows.push(row);
  }
  return { headers, rows };
}

function escapeCsv(v) {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function main() {
  console.log('读取', inputPath, '...');
  const { rows } = await loadCsv(inputPath);
  if (rows.length === 0) {
    console.log('无数据');
    return;
  }

  // 按 地址 + conditionId + outcome 分组（同一市场有 Yes/No 两个 outcome，必须分开算盈亏）
  // conditionId 为空时用市场命题区分，避免不同市场被合并
  const marketKey = (r) => (r['conditionId'] || '').trim() || (r['市场命题'] || '').trim();
  const key = (r) =>
    `${(r['地址'] || '').toLowerCase()}\t${marketKey(r).toLowerCase()}\t${(r['outcome'] || '').trim().toLowerCase()}`;
  const groups = new Map();

  for (const r of rows) {
    if (EXCLUDE_ADDRESSES.has((r['地址'] || '').toLowerCase())) continue;
    const cid = (r['conditionId'] || '').trim();
    if (cid && EXCLUDE_CONDITION_IDS.has(cid.toLowerCase())) continue;
    const k = key(r);
    if (!groups.has(k)) {
      groups.set(k, {
        地址: r['地址'] || '',
        conditionId: cid || '',
        outcome: (r['outcome'] || '').trim() || '',
        市场命题: r['市场命题'] || '',
        买入数量: 0,
        买入金额: 0,
        卖出数量: 0,
        卖出金额: 0,
        Claim数量: 0,
        Claim金额: 0,
        开仓时间: null,   // 最早买入时间戳(秒)
        关仓时间: null,   // 最晚卖出/Claim 时间戳(秒)，无则保持 null
      });
    }
    const g = groups.get(k);
    const type = (r['交易类型'] || '').trim();
    const amount = parseNum(r['数量']);
    const usdc = parseNum(r['金额USDC']);
    const ts = parseTs(r['时间戳']);

    if (type === '买入') {
      g.买入数量 += amount;
      g.买入金额 += usdc;
      if (ts != null) g.开仓时间 = g.开仓时间 == null ? ts : Math.min(g.开仓时间, ts);
    } else if (type === '卖出') {
      g.卖出数量 += amount;
      g.卖出金额 += usdc;
      if (ts != null) g.关仓时间 = g.关仓时间 == null ? ts : Math.max(g.关仓时间, ts);
    } else if (type === 'Claim') {
      g.Claim数量 += amount;
      g.Claim金额 += usdc;
      if (ts != null) g.关仓时间 = g.关仓时间 == null ? ts : Math.max(g.关仓时间, ts);
    }
    if (r['市场命题'] && !g.市场命题) g.市场命题 = r['市场命题'];
  }

  // 把 outcome 为空但有关仓的组，合并到同 (地址, conditionId) 下已有开仓的 outcome 组（多数是 Claim 的 outcome 为空）
  const baseKey = (addr, cid) => `${(addr || '').toLowerCase()}\t${(cid || '').toLowerCase()}`;
  const emptyOutcomeGroups = [];
  for (const [k, g] of groups.entries()) {
    const parts = k.split('\t');
    if (parts.length >= 3 && parts[2] === '' && (g.Claim数量 > 0 || g.卖出数量 > 0) && g.开仓时间 == null && g.关仓时间 != null) {
      emptyOutcomeGroups.push({ key: k, g, addr: g.地址, cid: g.conditionId });
    }
  }
  for (const { key: emptyKey, g: emptyG, addr, cid } of emptyOutcomeGroups) {
    const base = baseKey(addr, cid);
    const withOpen = [];
    for (const [k, g] of groups.entries()) {
      if (k === emptyKey) continue;
      if (k.startsWith(base + '\t') && g.开仓时间 != null) withOpen.push({ k, g });
    }
    if (withOpen.length === 1) {
      const target = withOpen[0].g;
      target.Claim数量 += emptyG.Claim数量;
      target.Claim金额 += emptyG.Claim金额;
      target.卖出数量 += emptyG.卖出数量;
      target.卖出金额 += emptyG.卖出金额;
      if (emptyG.关仓时间 != null) target.关仓时间 = target.关仓时间 == null ? emptyG.关仓时间 : Math.max(target.关仓时间, emptyG.关仓时间);
      groups.delete(emptyKey);
    } else if (withOpen.length >= 2) {
      const byBuy = withOpen.sort((a, b) => b.g.买入金额 - a.g.买入金额);
      const target = byBuy[0].g;
      target.Claim数量 += emptyG.Claim数量;
      target.Claim金额 += emptyG.Claim金额;
      target.卖出数量 += emptyG.卖出数量;
      target.卖出金额 += emptyG.卖出金额;
      if (emptyG.关仓时间 != null) target.关仓时间 = target.关仓时间 == null ? emptyG.关仓时间 : Math.max(target.关仓时间, emptyG.关仓时间);
      groups.delete(emptyKey);
    }
  }

  const outRows = [];
  for (const g of groups.values()) {
    if (g.关仓时间 == null || g.开仓时间 == null) continue; // 没有关仓或没有开仓的，忽略
    const 总成本 = g.买入金额;
    const 总收回 = g.卖出金额 + g.Claim金额;
    const 盈亏 = 总收回 - 总成本;
    const 盈亏率 = 总成本 > 0 ? (盈亏 / 总成本) * 100 : 0;
    outRows.push({
      地址: g.地址,
      市场命题: g.市场命题,
      conditionId: g.conditionId,
      outcome: g.outcome,
      开仓时间: formatTime(g.开仓时间),
      关仓时间: formatTime(g.关仓时间),
      总买入数量: g.买入数量.toFixed(4),
      总买入金额USDC: g.买入金额.toFixed(2),
      总卖出数量: g.卖出数量.toFixed(4),
      总卖出金额USDC: g.卖出金额.toFixed(2),
      总Claim数量: g.Claim数量.toFixed(4),
      总Claim金额USDC: g.Claim金额.toFixed(2),
      总成本USDC: 总成本.toFixed(2),
      总收回USDC: 总收回.toFixed(2),
      盈亏USDC: 盈亏.toFixed(2),
      盈亏率: 盈亏率.toFixed(2) + '%',
    });
  }

  // 按盈亏从高到低排
  outRows.sort((a, b) => parseFloat(b['盈亏USDC']) - parseFloat(a['盈亏USDC']));

  const outHeaders = [
    '地址', '市场命题', 'conditionId', 'outcome', '开仓时间', '关仓时间',
    '总买入数量', '总买入金额USDC', '总卖出数量', '总卖出金额USDC', '总Claim数量', '总Claim金额USDC',
    '总成本USDC', '总收回USDC', '盈亏USDC', '盈亏率',
  ];
  const csvLines = [outHeaders.map(escapeCsv).join(',')];
  for (const r of outRows) {
    csvLines.push(outHeaders.map((h) => escapeCsv(r[h])).join(','));
  }
  const csv = csvLines.join('\n');
  writeFileSync(outputPath, '\uFEFF' + csv, 'utf8');
  console.log('已写入', outRows.length, '条汇总到', outputPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
