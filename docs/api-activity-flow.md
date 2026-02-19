# `/api/activity` 请求背后运行流程

针对请求示例：

```
GET /api/activity?user=0x8ec4c13da685b5505399889012a57b954fb246c2&limit=-1&sort_by=TIMESTAMP&sort_direction=DESC&use_cache=false&days=30
```

## 1. 入口：API Route

**文件**: `app/api/activity/route.ts`

- 解析参数：`user`、`limit=-1`、`sort_by=TIMESTAMP`、`sort_direction=DESC`、`use_cache=false`、`days=30`
- 因 `limit === -1`，走「获取全部/按天数」分支，调用 **`getAllUserActivity(...)`**，传入：
  - `user`、`cacheManager`、`sortBy`、`sortDirection`
  - `batchSize=500`、`maxRecords=null`
  - **`useCache=false`**、`excludeDepositsWithdrawals=true`、**`days=30`**

---

## 2. 核心逻辑：getAllUserActivity

**文件**: `lib/polymarketApi.ts`

### 2.1 前置计算

- `daysToFetch = 30`（来自 `days`）
- `cutoffTimestamp = now - 30×24×3600`（30 天前的 Unix 秒）
- `nowSec = 当前时间（秒）`
- `windowSeconds = 7×24×3600`（每窗口 7 天，常量 `ACTIVITY_WINDOW_DAYS`）
- `actualBatchSize = min(500, 500) = 500`，但实际请求 Polymarket 时 **limit 会被封顶为 100**（`API_REQUEST_LIMIT_MAX`）

### 2.2 缓存判断（本次被跳过）

- `use_cache=false` → **不读缓存、不信任缓存**
- 不会走「5 分钟内缓存有效则直接返回」分支
- 会尝试读已有缓存仅用于后面「与 API 结果合并」；`use_cache=false` 时 `cachedData` 一般为空

### 2.3 按时间窗口拉取（主流程）

目标：在 **30 天内**、用 **时间窗口 + 分页** 拉全量，避免单次 offset 超过 3000（Polymarket 限制）。

1. **窗口划分**  
   把 `[cutoffTimestamp, nowSec]` 按 7 天一段切分，例如（示意）：
   - 窗口 1: `[cutoffTimestamp, cutoffTimestamp + 7天]`
   - 窗口 2: `[cutoffTimestamp + 7天, cutoffTimestamp + 14天]`
   - …
   - 最后一窗: `[..., nowSec]`

2. **对每个窗口**  
   - `windowStart` / `windowEnd` 为该段起止时间（Unix 秒）
   - 内层按 **offset** 分页，直到本窗口没数据或 offset 达到 3000：
     - 调用 **`fetchUserActivityFromAPI`**，参数包括：
       - `user`、`limit=500`（内部会变成 100）、**`offset=0,100,200,...`**
       - `sortBy=TIMESTAMP`、`sortDirection=DESC`
       - **`start=windowStart`**、**`end=windowEnd`**
     - 每批最多 100 条；若返回 < 100 条则本窗口结束
     - 结果经 `filterRecentData`（再按 30 天截一次）、`deduplicateByKey` 后追加到 `allActivities`
     - `use_cache=false` 时本阶段**不写缓存**
   - 窗口之间间隔约 200ms，避免打爆接口

3. **单次请求 Polymarket 的真实形态**  
   - URL: `https://data-api.polymarket.com/activity` 或 `/v1/activity`（先试前者，404 再试后者）
   - Query：`user=0x8ec4...`, `limit=100`, `offset=0|100|200|...`, `sortBy=TIMESTAMP`, `sortDirection=DESC`, `excludeDepositsWithdrawals=true`, **`start=窗口起`, `end=窗口止`**

### 2.4 ASC 补充拉取（条件触发）

- **条件**：`allActivities.length > 0` 且 `allActivities.length <= 3000`
- **目的**：若 API 实际忽略 `start`/`end`，按窗口拉可能只是重复拿到「最新 3000 条」；再按 **ASC（从旧到新）** 拉一轮，补「最旧」的 3000 条，合并去重，减少漏平仓。
- **做法**：再调 `fetchUserActivityFromAPI`，`sortDirection='ASC'`，`start=cutoffTimestamp`，`end=nowSec`，offset 0～2900，每批 100 条，结果与 `allActivities` 按 `(transactionHash, conditionId)` 去重合并。

### 2.5 合并与返回

- 对 `allActivities` 做 **deduplicateByKey**、按时间 **排序**（DESC）
- 若有 `maxRecords` 会截断；本次无
- **因 `use_cache=false`**：把最终 **result** 写回 **SQLite 缓存**（`cacheManager.saveActivities`），下次普通「查询」可命中
- 若之前读到了 `cachedData`，会把缓存里不在 result 中的记录合并进去，再排序、截断
- 最后经 **filterByConditionIdsFromEnv**（环境变量排除指定 conditionId）返回

---

## 3. 单次外网请求：fetchUserActivityFromAPI

**文件**: `lib/polymarketApi.ts`

- **limit**：入参 500，内部会改成 **100**（`API_REQUEST_LIMIT_MAX`）
- **路径**：先请求 `BASE_URL + '/activity'`，若 404 再请求 `'/v1/activity'`
- **重试**：同一路径最多 3 次（对 5xx、ECONNRESET）
- **参数**：`user`、`limit=100`、`offset`、`sortBy`、`sortDirection`、`excludeDepositsWithdrawals`，以及可选的 **`start`、`end`**（Unix 秒）
- **响应**：必须是数组，否则抛错；若有 `FILTER_CONDITION_IDS` 会过滤掉指定 conditionId

---

## 4. 流程简图（你这次请求）

```
GET /api/activity?user=0x8ec4...&limit=-1&...&use_cache=false&days=30
         │
         ▼
  route: limit=-1 → getAllUserActivity(user, cache, ..., useCache=false, days=30)
         │
         ├─ use_cache=false → 不因「缓存新鲜」直接返回
         ├─ cachedData = []（不读缓存或只读用于合并）
         │
         ▼
  【时间窗口循环】days=30 → 约 5 个 7 天窗口
         │
         │  对每个窗口 (windowStart, windowEnd):
         │     offset = 0, 100, 200, ... (< 3000)
         │        │
         │        ▼
         │     fetchUserActivityFromAPI(user, limit=500→100, offset, ..., start=windowStart, end=windowEnd)
         │        │
         │        ▼
         │     GET https://data-api.polymarket.com/activity?user=0x8ec4...&limit=100&offset=...&start=...&end=...
         │     （或 /v1/activity）
         │        │
         │        ▼
         │     filterRecentData(30天) + dedupe → 追加到 allActivities
         │
         ▼
  【若 allActivities.length ≤ 3000】ASC 补充拉取（start=cutoff, end=nowSec, sortDirection=ASC, offset 0~2900）
         │
         ▼
  dedupe → sort(DESC) → use_cache=false 时 saveActivities(result) → 合并 cachedData（若有）→ 返回 result
         │
         ▼
  NextResponse.json({ success: true, count, data: result, message })
```

---

## 5. 关键常量（当前代码）

| 常量 | 值 | 含义 |
|------|-----|------|
| `API_REQUEST_LIMIT_MAX` | 100 | 单次请求 Polymarket 的 limit 上限 |
| `MAX_ACTIVITY_OFFSET` | 3000 | 单次窗口内 offset 上限（API 限制） |
| `ACTIVITY_WINDOW_DAYS` | 7 | 每个时间窗口的天数 |
| `BATCH_SIZE_DEFAULT` (route) | 500 | 传给 getAllUserActivity 的 batchSize（内部仍按 100 请求） |
| `BASE_URL` | https://data-api.polymarket.com | Polymarket Data API 基地址 |

---

## 6. 小结

对你这条请求而言：

- **limit=-1 & days=30**：要的是「最近 30 天」的全量活动。
- **use_cache=false**：不用缓存结果，全程走 Polymarket；最后会把本次结果写回缓存。
- **实际运行**：按 7 天一个窗口、每个窗口内 offset 0/100/200/… 分批调 Polymarket，带 **start/end**；若总条数 ≤3000 还会做一次 ASC 补充拉取；合并、去重、排序后返回，并写入 SQLite 供下次查询使用。
