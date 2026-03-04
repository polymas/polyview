#!/usr/bin/env node
/**
 * 根据 address-trades-from-jan.csv 生成：
 * 1. 按 conditionId（市场）分组聚合
 * 2. 按 tokenId 分组聚合，保留 tokenId 对应市场名称
 * 3. 按日期聚合
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const INPUT_CSV = path.join(DATA_DIR, 'address-trades-from-jan.csv');
const OUTPUT_BY_MARKET = path.join(DATA_DIR, 'address-trades-from-jan-by-market.csv');
const OUTPUT_BY_TOKEN = path.join(DATA_DIR, 'address-trades-from-jan-by-tokenid.csv');
const OUTPUT_BY_DATE = path.join(DATA_DIR, 'address-trades-from-jan-by-date.csv');

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
    } else if ((c === ',' && !inQuotes) || c === '\n' || c === '\r') {
      result.push(current);
      current = '';
      if (c !== ',') break;
    } else {
      current += c;
    }
  }
  if (current !== '' || result.length > 0) result.push(current);
  return result;
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter((s) => s.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]);
  if (headers[0] && headers[0].charCodeAt(0) === 0xfeff) headers[0] = headers[0].slice(1);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, j) => {
      row[h] = values[j] ?? '';
    });
    rows.push(row);
  }
  return { headers, rows };
}

function num(v) {
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function escapeCsv(s) {
  const t = String(s ?? '');
  if (t.includes(',') || t.includes('"') || t.includes('\n')) {
    return `"${t.replace(/"/g, '""')}"`;
  }
  return t;
}

function main() {
  if (!fs.existsSync(INPUT_CSV)) {
    console.error('未找到输入文件:', INPUT_CSV);
    process.exit(1);
  }

  const content = fs.readFileSync(INPUT_CSV, 'utf8');
  const { rows } = parseCsv(content);

  const byMarket = new Map();
  const byTokenId = new Map();
  const byDate = new Map();

  const isBuy = (type) => String(type ?? '').trim() === '买入';

  for (const r of rows) {
    const cid = (r['conditionId'] ?? '').trim() || '(无conditionId)';
    const tid = (r['tokenId'] ?? '').trim() || '(无tokenId)';
    const market = (r['市场命题'] ?? '').trim() || '(无市场命题)';
    const timeStr = (r['时间'] ?? '').trim();
    const date = timeStr.slice(0, 10) || '(无日期)';
    const addr = (r['地址'] ?? '').trim().toLowerCase();
    const qty = num(r['数量']);
    const usdc = num(r['金额USDC']);
    const ts = num(r['时间戳']) || 0;
    const buy = isBuy(r['交易类型']);

    if (!byMarket.has(cid)) {
      byMarket.set(cid, {
        市场命题: market,
        数量: 0,
        金额USDC: 0,
        笔数: 0,
        最近时间: '',
        最近时间戳: 0,
        买入地址: new Set(),
      });
    }
    const m = byMarket.get(cid);
    m.数量 += qty;
    m.金额USDC += usdc;
    m.笔数 += 1;
    if (buy && addr) m.买入地址.add(addr);
    if (ts > m.最近时间戳) {
      m.最近时间戳 = ts;
      m.最近时间 = timeStr;
    }

    if (!byTokenId.has(tid)) {
      byTokenId.set(tid, {
        市场命题: market,
        数量: 0,
        金额USDC: 0,
        笔数: 0,
        最近时间: '',
        最近时间戳: 0,
        买入地址: new Set(),
      });
    }
    const t = byTokenId.get(tid);
    t.数量 += qty;
    t.金额USDC += usdc;
    t.笔数 += 1;
    if (buy && addr) t.买入地址.add(addr);
    if (ts > t.最近时间戳) {
      t.最近时间戳 = ts;
      t.最近时间 = timeStr;
      t.市场命题 = market;
    }

    if (!byDate.has(date)) {
      byDate.set(date, { 数量: 0, 金额USDC: 0, 笔数: 0, 买入地址: new Set() });
    }
    const d = byDate.get(date);
    d.数量 += qty;
    d.金额USDC += usdc;
    d.笔数 += 1;
    if (buy && addr) d.买入地址.add(addr);
  }

  const byMarketRows = Array.from(byMarket.entries())
    .map(([conditionId, v]) => ({
      conditionId,
      市场命题: v.市场命题,
      最近交易时间: v.最近时间,
      数量: v.数量.toFixed(4),
      金额USDC: v.金额USDC.toFixed(2),
      笔数: v.笔数,
      买入钱包地址数: (v.买入地址 && v.买入地址.size) || 0,
      最近时间戳: v.最近时间戳,
    }))
    .sort((a, b) => (b.最近时间戳 ?? 0) - (a.最近时间戳 ?? 0));

  const byTokenIdRows = Array.from(byTokenId.entries())
    .map(([tokenId, v]) => ({
      tokenId,
      市场命题: v.市场命题,
      最近交易时间: v.最近时间,
      数量: v.数量.toFixed(4),
      金额USDC: v.金额USDC.toFixed(2),
      笔数: v.笔数,
      买入钱包地址数: (v.买入地址 && v.买入地址.size) || 0,
      最近时间戳: v.最近时间戳,
    }))
    .sort((a, b) => (b.最近时间戳 ?? 0) - (a.最近时间戳 ?? 0));

  const byDateRows = Array.from(byDate.entries())
    .map(([日期, v]) => ({
      日期,
      数量: v.数量.toFixed(4),
      金额USDC: v.金额USDC.toFixed(2),
      笔数: v.笔数,
      买入钱包地址数: (v.买入地址 && v.买入地址.size) || 0,
    }))
    .sort((a, b) => (a.日期 < b.日期 ? -1 : a.日期 > b.日期 ? 1 : 0));

  const csvMarket =
    '\uFEFF' +
    'conditionId,市场命题,最近交易时间,数量,金额USDC,笔数,买入钱包地址数\n' +
    byMarketRows
      .map((r) =>
        [r.conditionId, r.市场命题, r.最近交易时间, r.数量, r.金额USDC, r.笔数, r.买入钱包地址数]
          .map(escapeCsv)
          .join(',')
      )
      .join('\n');

  const csvTokenId =
    '\uFEFF' +
    'tokenId,市场命题,最近交易时间,数量,金额USDC,笔数,买入钱包地址数\n' +
    byTokenIdRows
      .map((r) =>
        [r.tokenId, r.市场命题, r.最近交易时间, r.数量, r.金额USDC, r.笔数, r.买入钱包地址数]
          .map(escapeCsv)
          .join(',')
      )
      .join('\n');

  const csvDate =
    '\uFEFF' +
    '日期,数量,金额USDC,笔数,买入钱包地址数\n' +
    byDateRows
      .map((r) => [r.日期, r.数量, r.金额USDC, r.笔数, r.买入钱包地址数].map(escapeCsv).join(','))
      .join('\n');

  fs.writeFileSync(OUTPUT_BY_MARKET, csvMarket, 'utf8');
  fs.writeFileSync(OUTPUT_BY_TOKEN, csvTokenId, 'utf8');
  fs.writeFileSync(OUTPUT_BY_DATE, csvDate, 'utf8');

  console.log('输入:', INPUT_CSV, '| 行数:', rows.length);
  console.log('按 conditionId 汇总:', OUTPUT_BY_MARKET, '| 条数:', byMarketRows.length);
  console.log('按 tokenId 汇总:', OUTPUT_BY_TOKEN, '| 条数:', byTokenIdRows.length);
  console.log('按日期汇总:', OUTPUT_BY_DATE, '| 日期数:', byDateRows.length);
}

main();
