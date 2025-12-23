# 前端集成说明

前端代码已更新，现在优先使用本地 HTTP 服务来获取用户活动数据。

## 使用步骤

### 1. 启动后端服务

首先需要启动本地 HTTP 服务：

```bash
# 在项目根目录下
python activity.py
```

服务将在 `http://localhost:8000` 启动。

### 2. 启动前端应用

在另一个终端窗口启动前端：

```bash
npm run dev
```

前端通常会在 `http://localhost:5173` 启动（Vite 默认端口）。

### 3. 使用应用

1. 打开浏览器访问前端应用（通常是 `http://localhost:5173`）
2. 输入钱包地址（例如：`0x45deaaD70997b2998FBb9433B1819178e34B409C`）
3. 点击"查询"按钮
4. 应用会自动从本地 API 服务获取所有历史活动记录

## 工作原理

### API 调用流程

1. **优先使用本地 API**：前端首先尝试调用 `http://localhost:8000/activity?user=...&limit=-1`
2. **获取所有历史记录**：使用 `limit=-1` 参数获取所有历史活动数据
3. **数据转换**：将活动数据转换为前端需要的交易格式
4. **备用方案**：如果本地 API 不可用，会自动回退到 The Graph 和 CLOB API

### 数据转换

前端会将 API 返回的活动数据转换为 `PolymarketTransaction` 格式：

- `transactionHash` → `id`
- `timestamp` → `timestamp` (转换为毫秒)
- `conditionId` → `market`
- `title` → `marketQuestion`
- `size` → `amount`
- `usdcSize` → `totalCost`
- `price` → `price`
- `type` → `type` (BUY/SELL)

## 配置选项

### 修改 API 地址

如果需要使用不同的 API 地址，可以：

1. **通过环境变量**：创建 `.env` 文件
   ```
   VITE_API_BASE_URL=http://localhost:8000
   ```

2. **直接修改代码**：编辑 `src/services/polymarketApi.ts`
   ```typescript
   const LOCAL_API_BASE_URL = 'http://your-api-url:8000';
   ```

## 故障排除

### 问题：无法连接到本地 API 服务

**错误信息**：`无法连接到本地 API 服务，请确保服务已启动在 http://localhost:8000`

**解决方案**：
1. 确认后端服务已启动：`python activity.py`
2. 检查端口是否被占用
3. 确认防火墙设置允许本地连接

### 问题：CORS 错误

**错误信息**：`CORS policy: No 'Access-Control-Allow-Origin' header`

**解决方案**：
- 后端已配置 CORS 中间件，如果仍有问题，检查 `activity.py` 中的 CORS 配置

### 问题：数据格式不匹配

如果遇到数据转换问题：

1. 检查浏览器控制台的错误信息
2. 查看网络请求的响应数据格式
3. 根据实际情况调整 `transformActivityToTransaction` 函数

## 性能优化

- **缓存支持**：后端使用 SQLite 缓存，减少 API 请求
- **增量更新**：每次请求自动同步最新数据
- **超时设置**：前端请求超时设置为 60 秒，适应大量数据获取

## 备用方案

如果本地 API 服务不可用，前端会自动尝试：

1. The Graph 子图 API
2. Polymarket CLOB API

这样可以确保即使后端服务未启动，前端仍能正常工作（但可能无法获取完整历史数据）。

