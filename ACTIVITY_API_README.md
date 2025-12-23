# Polymarket 用户活动 HTTP 服务

基于 FastAPI 的 Polymarket 用户活动查询 HTTP 服务。

## 功能特性

- ✅ 获取用户活动记录（支持分页）
- ✅ 循环获取所有历史活动记录
- ✅ **SQLite 缓存支持** - 减少 API 请求频率
- ✅ **增量数据同步** - 自动同步最新数据
- ✅ RESTful API 设计
- ✅ 自动生成 API 文档（Swagger UI）
- ✅ 完整的错误处理
- ✅ 类型验证和参数校验

## 安装依赖

```bash
pip install -r requirements.txt
```

## 启动服务

### 方式 1: 直接运行

```bash
python activity.py
```

### 方式 2: 使用 uvicorn

```bash
uvicorn activity:app --reload --host 0.0.0.0 --port 8000
```

服务启动后，访问：
- API 文档（Swagger UI）: http://localhost:8000/docs
- API 文档（ReDoc）: http://localhost:8000/redoc
- 根路径: http://localhost:8000/

## API 端点

### 1. 根路径

**GET** `/`

返回 API 基本信息。

**响应示例:**
```json
{
  "service": "Polymarket 用户活动 API",
  "version": "1.0.0",
  "endpoints": {
    "/activity": "获取用户活动（分页）",
    "/activity/all": "获取用户所有历史活动",
    "/health": "健康检查",
    "/docs": "API 文档（Swagger UI）"
  }
}
```

### 2. 健康检查

**GET** `/health`

检查服务健康状态。

**响应示例:**
```json
{
  "status": "healthy",
  "polymarket_api": "accessible"
}
```

### 3. 获取用户活动（分页或全部）

**GET** `/activity`

获取指定用户的活动记录，支持分页查询和获取所有历史记录。

**查询参数:**
- `user` (必需): 用户地址（0x开头的42位十六进制字符串）
- `limit` (可选): 返回数量限制（1-500为分页，默认100）。**设置为 0 或 -1 可获取所有历史记录**
- `offset` (可选): 偏移量（0-10000，默认0，仅在limit>0时有效）
- `sort_by` (可选): 排序字段（默认TIMESTAMP）
- `sort_direction` (可选): 排序方向，ASC 或 DESC（默认DESC）
- `use_cache` (可选): 是否使用缓存（默认True）

**请求示例:**

分页查询（获取前10条）:
```bash
curl "http://localhost:8000/activity?user=0x45deaaD70997b2998FBb9433B1819178e34B409C&limit=10&offset=0"
```

**获取所有历史记录:**
```bash
# 方式1: 使用 limit=0
curl "http://localhost:8000/activity?user=0x45deaaD70997b2998FBb9433B1819178e34B409C&limit=0"

# 方式2: 使用 limit=-1
curl "http://localhost:8000/activity?user=0x45deaaD70997b2998FBb9433B1819178e34B409C&limit=-1"
```

**响应示例:**
```json
{
  "success": true,
  "count": 10,
  "data": [
    {
      "proxyWallet": "0x45deaaD70997b2998FBb9433B1819178e34B409C",
      "timestamp": 1766470943,
      "conditionId": "0xe5e828881862659c7c8922c0ea7d800178347e1d267739a4cf1632bb5fc5e74d",
      "type": "TRADE",
      "size": 100,
      "usdcSize": 99.9,
      "transactionHash": "0x1121b6501b02d9d3105733173f58c867a63572575e4c5b1518d510ff46d0c9ca",
      "price": 0.999
    }
  ],
  "message": "成功获取 10 条活动记录"
}
```

### 4. 获取用户所有历史活动

**GET** `/activity/all`

循环获取指定用户的所有历史活动记录，支持缓存和增量更新。

**查询参数:**
- `user` (必需): 用户地址（0x开头的42位十六进制字符串）
- `sort_by` (可选): 排序字段（默认TIMESTAMP）
- `sort_direction` (可选): 排序方向，ASC 或 DESC（默认DESC）
- `batch_size` (可选): 每批获取的记录数（1-500，默认100）
- `max_records` (可选): 最大获取记录数限制（可选，None表示获取所有）
- `use_cache` (可选): 是否使用缓存（默认True）

**请求示例:**
```bash
curl "http://localhost:8000/activity/all?user=0x45deaaD70997b2998FBb9433B1819178e34B409C&batch_size=100"
```

**响应示例:**
```json
{
  "success": true,
  "count": 1250,
  "data": [
    // ... 所有活动记录
  ],
  "message": "成功获取所有 1250 条历史活动记录"
}
```

## 使用示例

### Python 示例

```python
import requests

# 获取用户活动（分页）
response = requests.get(
    "http://localhost:8000/activity",
    params={
        "user": "0x45deaaD70997b2998FBb9433B1819178e34B409C",
        "limit": 10,
        "offset": 0
    }
)
data = response.json()
print(f"获取了 {data['count']} 条记录")

# 获取所有历史活动
response = requests.get(
    "http://localhost:8000/activity/all",
    params={
        "user": "0x45deaaD70997b2998FBb9433B1819178e34B409C",
        "batch_size": 100
    }
)
data = response.json()
print(f"总共 {data['count']} 条历史记录")
```

### JavaScript 示例

```javascript
// 获取用户活动（分页）
fetch('http://localhost:8000/activity?user=0x45deaaD70997b2998FBb9433B1819178e34B409C&limit=10')
  .then(response => response.json())
  .then(data => {
    console.log(`获取了 ${data.count} 条记录`);
    console.log(data.data);
  });

// 获取所有历史活动
fetch('http://localhost:8000/activity/all?user=0x45deaaD70997b2998FBb9433B1819178e34B409C')
  .then(response => response.json())
  .then(data => {
    console.log(`总共 ${data.count} 条历史记录`);
  });
```

## 错误处理

API 使用标准的 HTTP 状态码：

- `200`: 成功
- `400`: 请求参数错误（如无效的用户地址格式）
- `500`: 服务器内部错误（如 Polymarket API 请求失败）

**错误响应格式:**
```json
{
  "success": false,
  "error": "错误描述",
  "detail": "详细错误信息"
}
```

## 开发

### 代码结构

```
activity.py              # 主服务文件
requirements.txt         # Python 依赖
ACTIVITY_API_README.md   # 本文档
```

### 修改配置

默认配置在 `activity.py` 文件底部：

```python
uvicorn.run(
    app,
    host="0.0.0.0",      # 监听地址
    port=8000,           # 端口
    reload=True          # 开发模式（自动重载）
)
```

## 缓存功能

### 缓存机制

服务使用 SQLite 数据库来缓存用户活动数据，具有以下特性：

1. **自动缓存**: 默认启用缓存（`use_cache=True`）
2. **增量更新**: 每次请求时自动同步最新数据到缓存
3. **数据去重**: 使用 `transactionHash` + `timestamp` 作为唯一标识
4. **性能优化**: 减少对 Polymarket API 的请求频率

### 缓存数据库

- **数据库文件**: `polymarket_cache.db`（自动创建）
- **存储位置**: 服务运行目录
- **表结构**: `user_activities` 表存储活动数据

### 缓存管理端点

#### 查看缓存统计

**GET** `/cache/stats`

查看缓存统计信息。

**查询参数:**
- `user` (可选): 用户地址，不提供则查看全局统计

**请求示例:**
```bash
curl "http://localhost:8000/cache/stats?user=0x45deaaD70997b2998FBb9433B1819178e34B409C"
```

**响应示例:**
```json
{
  "success": true,
  "stats": {
    "total_count": 1250,
    "oldest_timestamp": 1700000000,
    "newest_timestamp": 1701000000,
    "oldest_datetime": "2023-11-15T00:00:00",
    "newest_datetime": "2023-11-28T00:00:00",
    "last_updated": "2023-11-28T12:00:00"
  },
  "message": "缓存统计信息（用户）"
}
```

#### 清除用户缓存

**DELETE** `/cache/clear`

清除指定用户的缓存数据。

**查询参数:**
- `user` (必需): 用户地址

**请求示例:**
```bash
curl -X DELETE "http://localhost:8000/cache/clear?user=0x45deaaD70997b2998FBb9433B1819178e34B409C"
```

**响应示例:**
```json
{
  "success": true,
  "message": "已清除用户 0x45deaaD70997b2998FBb9433B1819178e34B409C 的缓存"
}
```

### 禁用缓存

如果不想使用缓存，可以在请求中添加 `use_cache=false` 参数：

```bash
curl "http://localhost:8000/activity?user=0x...&use_cache=false"
```

## 注意事项

1. **用户地址格式**: 必须是 0x 开头的 42 位十六进制字符串
2. **API 限制**: Polymarket API 的 offset 最大限制为 10000
3. **批量大小**: 建议 batch_size 设置为 100-500 之间，以获得最佳性能
4. **网络超时**: 默认请求超时时间为 30 秒
5. **缓存策略**: 
   - 缓存会自动更新，每次请求会获取最新数据并更新缓存
   - 如果 API 请求失败，会尝试从缓存返回数据
   - 缓存数据存储在本地 SQLite 数据库中
6. **生产环境**: 建议使用 gunicorn 或类似工具部署，并配置适当的日志和监控
7. **数据库维护**: SQLite 数据库文件会随着数据增长而增大，建议定期清理不需要的缓存

## 许可证

MIT License

