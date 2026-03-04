# 钱包 Activity 缓存后端 — 需求文档

> 独立维护的后端服务，用于缓存 Polymarket 钱包地址的 Activity。新钱包从起始时间 0 拉全量，已有钱包每次更新以库内最新时间为起点、当前时间为终点做增量拉取。

---

## 1. 目标与背景

- **目标**：为多个钱包地址维护一份 **Activity 缓存**，避免重复请求 Polymarket API，并支持按需增量更新。
- **数据源**：Polymarket Data API（如 `https://data-api.polymarket.com/activity` 或 `/v1/activity`），按 `user`（钱包地址）和时间区间查询。
- **约束**：Polymarket 在**同一时间区间内**最多返回 **3000 条** 数据，需通过「正序 + 移动起始时间」的方式分批拉取。

---

## 2. 功能需求

### 2.1 钱包注册与首次拉取

- 支持**注册/登记**一个钱包地址。
- **新钱包**（数据库中尚无该地址或该地址无任何 Activity 记录）：
  - 拉取 Activity 时，**起始时间 = 0**（或平台支持的最早时间戳）。
  - 结束时间 = **当前时间**。
  - 将拉取到的 Activity 写入存储，并记录该地址的**最新 Activity 时间戳**（用于后续增量）。

### 2.2 增量更新

- 对**已存在**的钱包：
  - **起始时间** = 数据库中该地址**已存储的最新 Activity 时间戳**（即上次同步到的最大 `timestamp`）。
  - **结束时间** = **当前时间**。
  - 仅拉取 `(最新时间戳, 当前时间]` 区间的数据，写入存储并更新「最新 Activity 时间戳」。

### 2.3 数据存储与去重

- 所有拉取到的 Activity 需**持久化**到本服务使用的数据库中。
- 单条 Activity 在业务上由「钱包地址 + 交易哈希 + conditionId + tokenId」等唯一标识，**写入时需去重**，避免重复插入（如断点续传、重复触发同步时）。

### 2.4 查询能力

- 支持按**钱包地址**查询该地址的**已缓存 Activity 列表**。
- 支持**分页**（如 `limit` + `offset` 或游标），便于前端或其它服务消费。
- 可选：按时间范围、类型（TRADE / REDEEM 等）过滤。

---

## 3. 与 Polymarket API 的交互规则

### 3.1 单次请求限制

- 在**同一组** `start` / `end` 参数下，API 最多返回 **3000 条** 数据（不论 `offset` 多大，超过 3000 即无更多数据）。

### 3.2 拉取策略（满足 3000 条限制）

- **排序**：请求参数使用**按时间正序**（`sortBy=TIMESTAMP`, `sortDirection=ASC`），即从早到晚。
- **时间区间**：每次请求的 `start` = 本批起始时间，`end` = 本批结束时间（首次全量时 end = 当前时间，增量时 end = 当前时间）。
- **分页方式**：
  1. 在**同一 [start, end]** 内用 `offset` 分批请求（如每批 100 或 500 条），直到本区间内拿满 3000 条或接口返回条数 &lt; 每批大小。
  2. 取本批中**最大时间戳** `T_max`，下一批的 **start = T_max + 1**（避免重复），end 不变。
  3. 重复直到某次返回 0 条，表示该 [start, end] 已拉完。

### 3.3 请求参数要点（参考）

- `user`: 钱包地址（0x...）
- `start` / `end`: Unix 时间戳（秒）
- `sortBy`: `TIMESTAMP`
- `sortDirection`: `ASC`
- `limit`: 单次请求条数（如 500）
- `offset`: 偏移
- `excludeDepositsWithdrawals`: 按需，例如 `true` 仅交易与 redeem，或 `false` 含存取款

### 3.4 新钱包「起始时间为 0」

- 新钱包首次拉取时，**start = 0**（若 API 对 0 有特殊处理，则改用平台支持的最小时间戳，如 2025-01-01 00:00:00 UTC 对应的时间戳）。

---

## 4. 存储选型：DuckDB

- **选用 DuckDB** 作为唯一存储：嵌入式、列存、无独立进程，与后端服务同一进程内运行，部署时无额外依赖。
- **形态**：单文件（如 `activity_cache.duckdb`）或指定数据目录，备份/迁移即拷贝文件。
- **Rust**：通过 `duckdb` crate 嵌入，打开同一路径即复用已有数据；单写多读，批量 `INSERT` 与按时间范围查询均高效。

---

## 5. 数据模型（逻辑 + DuckDB）

### 5.1 钱包（用于记录同步进度）

| 字段 | 类型（建议） | 说明 |
|------|----------------|------|
| address | VARCHAR PRIMARY KEY | 钱包地址，统一小写 |
| latest_activity_ts | BIGINT | 该地址已缓存的最新 Activity 时间戳（秒），用于下次增量 start |
| created_at | TIMESTAMP | 首次注册时间 |
| updated_at | TIMESTAMP | 最近一次同步完成时间 |

### 5.2 Activity（单条记录）

与 Polymarket 返回字段对齐，列存下按时间范围查询友好：

| 字段 | 类型（建议） | 说明 |
|------|----------------|------|
| address | VARCHAR | 钱包地址 |
| ts | BIGINT | 活动时间戳（秒） |
| type | VARCHAR | 如 TRADE, REDEEM 等 |
| side | VARCHAR | BUY / SELL（若有） |
| size | DOUBLE | 数量 |
| usdc_size | DOUBLE | USDC 金额（若有） |
| price | DOUBLE | 价格（若有） |
| title | VARCHAR | 市场命题（若有） |
| outcome | VARCHAR | 选项（若有） |
| condition_id | VARCHAR | 条件 ID |
| token_id | VARCHAR | 代币 ID |
| transaction_hash | VARCHAR | 交易哈希 |

**唯一约束**：`(address, transaction_hash, condition_id, token_id)` 或等价组合，保证去重；插入时使用 `INSERT ... ON CONFLICT DO NOTHING` 或先查再插，避免重复。

### 5.3 DuckDB 建表示例（参考）

```sql
-- 钱包同步进度
CREATE TABLE wallets (
  address VARCHAR PRIMARY KEY,
  latest_activity_ts BIGINT,
  created_at TIMESTAMP DEFAULT current_timestamp,
  updated_at TIMESTAMP DEFAULT current_timestamp
);

-- Activity 缓存（列存，按 ts 查询多时可考虑按 address 分区或仅依赖索引）
CREATE TABLE activities (
  address VARCHAR,
  ts BIGINT,
  type VARCHAR,
  side VARCHAR,
  size DOUBLE,
  usdc_size DOUBLE,
  price DOUBLE,
  title VARCHAR,
  outcome VARCHAR,
  condition_id VARCHAR,
  token_id VARCHAR,
  transaction_hash VARCHAR,
  PRIMARY KEY (address, transaction_hash, condition_id, token_id)
);

-- 按地址 + 时间范围查询时，对 (address, ts) 建索引更佳
CREATE INDEX idx_activities_address_ts ON activities(address, ts);
```

---

## 6. API 设计（建议）

### 6.1 登记钱包并触发首次/增量同步

- **POST** `/wallets`
- Body: `{ "address": "0x..." }`
- 行为：若为新钱包，则 start=0、end=now 全量拉取并落库；若已存在，可按策略选择是否顺带做一次增量（或仅登记，由 6.2 触发）。

### 6.2 对指定钱包触发增量同步

- **POST** `/wallets/:address/sync`
- 行为：start = 该地址在库中的 `latest_activity_ts`（无则视为 0），end = 当前时间；拉取后写入并更新 `latest_activity_ts`。
- 返回：本次新增条数或简要状态。

### 6.3 查询某地址的已缓存 Activity

- **GET** `/wallets/:address/activity`
- Query：`limit`、`offset`（或 `before_ts` 游标）；可选 `type`、`from_ts`、`to_ts`；可选 `force_refresh`（为 true 时先执行增量同步再查缓存）。
- 返回：Activity 列表（JSON），按时间倒序或正序可约定。

**强制刷新与后续查询一致性**：当请求带 `force_refresh=true` 时，应先完成增量同步并落库，再**按与未带 force_refresh 时相同的查询逻辑**（同一 `from_ts`、`to_ts`、`limit` 等）从缓存读取并返回。这样，**强制刷新返回的结果与紧接着一次不带 force_refresh 的查询结果应保持一致**（同一参数下返回相同数据集），避免前端出现「刚刷新有数据、再查又不一样」的现象。

### 6.4 列出已登记钱包（可选）

- **GET** `/wallets`
- 返回：地址列表及可选的 `latest_activity_ts`、`updated_at`。

---

## 7. 非功能需求（建议）

- **配置**：Polymarket API 根地址、请求超时、每批 limit、代理（如需要）等可配置（环境变量或配置文件）；DuckDB 文件路径可配置（如 `DUCKDB_PATH=./data/activity_cache.duckdb`）。
- **幂等与错误**：同一地址并发同步时，应通过唯一约束与「以 latest_activity_ts 为起点」保证数据不重复、不丢；单次同步失败可保留上次 `latest_activity_ts`，下次重试继续。
- **部署**：单机运行或容器化；**仅依赖 DuckDB 嵌入式库**，无独立数据库进程，备份即拷贝 DuckDB 文件。

---

## 8. 附录：已知数据异常与调查记录

### 8.1 Condition 下 REDEEM share 新旧版本区分（示例）

**Condition ID**：`0xac11f0d8d88a006cc3df2bb1cd545dd3e17d21036adad887d5035530a3780669`  
**市场命题**：Counter-Strike: Legion vs THUNDER dOWNUNDER - Map 2 Winner

**现象**：同一用户、同一头寸（例如买入 100 share）可能先被数据源记录为 **REDEEM 50**（旧/错误），后续更正为 **REDEEM 100**（新/正确）。

**规则**（用于区分新旧或去重时参考）：

| REDEEM share | 含义 |
|--------------|------|
| **100**（与买入 share 一致） | **新**：正确、完整平仓记录，应以该条为准。 |
| **50**（仅为买入的一半） | **旧**：早期或错误版本，若同用户同 condition 已存在 redeem=100，应忽略或覆盖。 |

**数据依据**：在 `scripts/data/address-trades-from-jan.csv` 中，该 condition 下存在「买入 100、REDEEM 50」的记录（如地址 `0x9672d402...`、`0x38cc5cf506aff32b8e26c5d19c7b288561805c4f`）；正确数据应为「买入 100、REDEEM 100」。缓存后端若做去重或「以新替旧」逻辑时，可按「同一 conditionId + 同一 user + 同一头寸」下 **redeem share 与买入 share 一致** 的为准。

---

## 9. 总结

| 场景 | 起始时间 | 结束时间 |
|------|----------|----------|
| 新钱包首次拉取 | 0（或最小支持时间戳） | 当前时间 |
| 已有钱包增量更新 | 库内该地址最新 Activity 时间戳 | 当前时间 |

拉取时始终使用 **时间正序 + 每区间最多 3000 条 + 用本批最大时间作为下一批起点** 的方式与 Polymarket API 交互；本服务只负责缓存、去重、按地址查询与分页，为后续 Rust 实现提供清晰需求边界。
