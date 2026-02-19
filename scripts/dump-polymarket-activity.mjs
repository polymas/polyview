#!/usr/bin/env node
/**
 * 直连 Polymarket Data API 拉取 activity，dump 到本地，便于排查「只有开仓没有平仓」。
 * 不依赖 CSV，完全以 API 返回为准。
 *
 * 用法:
 *   node scripts/dump-polymarket-activity.mjs [user] [conditionId]
 *   node scripts/dump-polymarket-activity.mjs 0x8ec4c13da685b5505399889012a57b954fb246c2
 *   node scripts/dump-polymarket-activity.mjs 0x8ec4c13da685b5505399889012a57b954fb246c2 0x6e757349fd02ac5358dc358d84268af636bae8868d5922c545158655832685fd
 *
 * 需代理时: PROXY=127.0.0.1:7890 node scripts/dump-polymarket-activity.mjs ...
 *
 * 输出:
 *   scripts/out/polymarket-activity-dump.json     - 原始 activity 数组
 *   scripts/out/polymarket-activity-summary.json - 按 conditionId 汇总（是否有 TRADE/REDEEM）
 *   scripts/out/polymarket-activity-only-open.json - 仅开仓未平的 market 列表
 *   scripts/out/polymarket-activity-{conditionId}.json - 若传了 conditionId，单独 dump 该市场
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';

const DATA_API_BASE = 'https://data-api.polymarket.com';
const BATCH_SIZE = 100;
const MAX_OFFSET = 3000;
const DELAY_MS = 400;

const user = process.argv[2] || '0x8ec4c13da685b5505399889012a57b954fb246c2';
const filterConditionId = process.argv[3] ? process.argv[3].toLowerCase() : null;

const outDir = path.join(process.cwd(), 'scripts', 'out');

const proxyRaw = process.env.PROXY || '';
const agent = proxyRaw
  ? new HttpsProxyAgent(proxyRaw.startsWith('http') ? proxyRaw : `http://${proxyRaw}`)
  : undefined;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPage(offset, start, end, sortDirection = 'DESC') {
  const url = new URL(`${DATA_API_BASE}/activity`);
  url.searchParams.set('user', user);
  url.searchParams.set('limit', String(BATCH_SIZE));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('sortBy', 'TIMESTAMP');
  url.searchParams.set('sortDirection', sortDirection);
  url.searchParams.set('excludeDepositsWithdrawals', 'true');
  if (start != null) url.searchParams.set('start', String(start));
  if (end != null) url.searchParams.set('end', String(end));

  const opts = {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(25000),
  };
  if (agent) opts.agent = agent;

  const res = await fetch(url.toString(), opts);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error('API 返回非数组');
  }
  return data;
}

async function fetchAllActivity(days = 30) {
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoff = nowSec - days * 24 * 60 * 60;
  const all = [];
  let offset = 0;

  // 先按 DESC 拉满 3000
  while (offset < MAX_OFFSET) {
    const batch = await fetchPage(offset, cutoff, nowSec, 'DESC');
    console.log(`  offset ${offset} → ${batch.length} 条`);
    if (batch.length === 0) break;
    const inRange = batch.filter((a) => (a.timestamp || 0) >= cutoff);
    all.push(...inRange);
    if (batch.length < BATCH_SIZE) break;
    offset += batch.length;
    await sleep(DELAY_MS);
  }

  // 再按 ASC 拉 3000 条（补「最旧」）
  offset = 0;
  while (offset < MAX_OFFSET) {
    const batch = await fetchPage(offset, cutoff, nowSec, 'ASC');
    if (!Array.isArray(batch) || batch.length === 0) break;

    const inRange = batch.filter((a) => (a.timestamp || 0) >= cutoff);
    const keys = new Set(all.map((a) => `${a.transactionHash || ''}_${(a.conditionId || '').toLowerCase()}`));
    let added = 0;
    for (const a of inRange) {
      const key = `${a.transactionHash || ''}_${(a.conditionId || '').toLowerCase()}`;
      if (!keys.has(key)) {
        keys.add(key);
        all.push(a);
        added++;
      }
    }
    console.log(`  ASC offset ${offset} → ${batch.length} 条, 新增 ${added}`);
    if (batch.length < BATCH_SIZE) break;
    offset += batch.length;
    await sleep(DELAY_MS);
  }

  return all;
}

function buildSummary(activities) {
  const byCondition = new Map();

  for (const a of activities) {
    const cid = (a.conditionId || '').toLowerCase();
    if (!cid) continue;
    if (!byCondition.has(cid)) {
      byCondition.set(cid, {
        conditionId: a.conditionId,
        title: a.title || '',
        eventSlug: a.eventSlug || '',
        types: [],
        events: [],
      });
    }
    const rec = byCondition.get(cid);
    const type = a.type || 'UNKNOWN';
    rec.types.push(type);
    rec.events.push({
      type,
      timestamp: a.timestamp,
      size: a.size,
      usdcSize: a.usdcSize,
      price: a.price,
      transactionHash: a.transactionHash,
      side: a.side,
    });
  }

  const summary = [];
  for (const [cid, rec] of byCondition.entries()) {
    const hasTrade = rec.types.includes('TRADE');
    const hasRedeem = rec.types.includes('REDEEM');
    summary.push({
      conditionId: rec.conditionId,
      title: rec.title,
      eventSlug: rec.eventSlug,
      count: rec.events.length,
      hasTrade,
      hasRedeem,
      onlyOpen: hasTrade && !hasRedeem,
      events: rec.events.sort((x, y) => (x.timestamp || 0) - (y.timestamp || 0)),
    });
  }
  return summary;
}

async function main() {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log('Polymarket Activity Dump');
  console.log('user:', user);
  if (filterConditionId) console.log('filter conditionId:', filterConditionId);
  console.log('');

  const activities = await fetchAllActivity(30);
  const onlyTradeRedeem = activities.filter((a) => a.type === 'TRADE' || a.type === 'REDEEM');
  console.log('\n合计:', activities.length, '条 (TRADE+REDEEM:', onlyTradeRedeem.length, ')');

  const dumpPath = path.join(outDir, 'polymarket-activity-dump.json');
  fs.writeFileSync(dumpPath, JSON.stringify(onlyTradeRedeem, null, 2), 'utf8');
  console.log('已写入:', dumpPath);

  const summary = buildSummary(onlyTradeRedeem);
  const summaryPath = path.join(outDir, 'polymarket-activity-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log('已写入:', summaryPath);

  const onlyOpen = summary.filter((s) => s.onlyOpen);
  if (onlyOpen.length > 0) {
    console.log('\n仅开仓未平(onlyOpen) 的 conditionId 数量:', onlyOpen.length);
    const onlyOpenPath = path.join(outDir, 'polymarket-activity-only-open.json');
    fs.writeFileSync(onlyOpenPath, JSON.stringify(onlyOpen, null, 2), 'utf8');
    console.log('已写入:', onlyOpenPath);
  }

  if (filterConditionId) {
    const cidNorm = filterConditionId.startsWith('0x') ? filterConditionId : `0x${filterConditionId}`;
    const forMarket = onlyTradeRedeem.filter((a) => (a.conditionId || '').toLowerCase() === cidNorm.toLowerCase());
    const outPath = path.join(outDir, `polymarket-activity-${cidNorm.slice(0, 18)}.json`);
    fs.writeFileSync(outPath, JSON.stringify(forMarket, null, 2), 'utf8');
    console.log('\n该 conditionId 记录数:', forMarket.length);
    console.log('已写入:', outPath);
    const sum = buildSummary(forMarket)[0];
    if (sum) {
      console.log('  title:', sum.title);
      console.log('  hasTrade:', sum.hasTrade, 'hasRedeem:', sum.hasRedeem, 'onlyOpen:', sum.onlyOpen);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
