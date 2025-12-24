"""
Polymarket 用户活动 HTTP 服务
基于 FastAPI 框架
"""

# ==================== 导入模块 ====================
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import sqlite3
import json
import logging
import time
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# ==================== 配置模块 ====================
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_URL = "https://data-api.polymarket.com"
DB_FILE = "polymarket_cache.db"
BATCH_SIZE_DEFAULT = 100  # 默认批次大小
BATCH_SIZE_MAX = 100  # API 限制最大批次大小
CACHE_UPDATE_MIN = 100  # 缓存更新最小数量
THREE_MONTHS_DAYS = 90  # 3个月天数

# ==================== 应用初始化 ====================
app = FastAPI(
    title="Polymarket 用户活动 API",
    description="提供 Polymarket 用户活动查询服务的 HTTP API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==================== 数据模型 ====================


class ActivityResponse(BaseModel):
    """活动响应模型"""
    success: bool
    count: int
    data: List[Dict[str, Any]]
    message: Optional[str] = None


class ErrorResponse(BaseModel):
    """错误响应模型"""
    success: bool = False
    error: str
    detail: Optional[str] = None

# ==================== 缓存管理模块 ====================


class CacheManager:
    """SQLite 缓存管理器"""

    def __init__(self, db_file: str = DB_FILE):
        self.db_file = db_file
        self.init_database()

    def get_connection(self):
        """获取数据库连接"""
        conn = sqlite3.connect(self.db_file)
        conn.row_factory = sqlite3.Row
        return conn

    def init_database(self):
        """初始化数据库表"""
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_activities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_address TEXT NOT NULL,
                transaction_hash TEXT,
                timestamp INTEGER NOT NULL,
                condition_id TEXT,
                activity_data TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_address, transaction_hash, timestamp)
            )
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_user_timestamp 
            ON user_activities(user_address, timestamp DESC)
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_user_condition 
            ON user_activities(user_address, condition_id)
        """)

        conn.commit()
        conn.close()

    def get_cached_activities(
        self,
        user: str,
        limit: Optional[int] = None,
        offset: int = 0,
        sort_by: str = "TIMESTAMP",
        sort_direction: str = "DESC"
    ) -> List[Dict[str, Any]]:
        """从缓存获取用户活动"""
        conn = self.get_connection()
        cursor = conn.cursor()

        order_by = f"timestamp {sort_direction}"
        query = f"""
            SELECT activity_data 
            FROM user_activities 
            WHERE user_address = ?
            ORDER BY {order_by}
            LIMIT ? OFFSET ?
        """

        limit_value = limit if limit else 999999
        cursor.execute(query, (user.lower(), limit_value, offset))
        results = cursor.fetchall()
        conn.close()

        activities = []
        for row in results:
            try:
                activities.append(json.loads(row['activity_data']))
            except:
                continue

        return activities

    def save_activities(self, user: str, activities: List[Dict[str, Any]]):
        """保存活动数据到缓存"""
        if not activities:
            return

        conn = self.get_connection()
        cursor = conn.cursor()

        for activity in activities:
            try:
                cursor.execute("""
                    INSERT OR REPLACE INTO user_activities 
                    (user_address, transaction_hash, timestamp, condition_id, activity_data, updated_at)
                    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """, (
                    user.lower(),
                    activity.get('transactionHash', ''),
                    activity.get('timestamp', 0),
                    activity.get('conditionId', ''),
                    json.dumps(activity)
                ))
            except Exception as e:
                logger.warning(f"保存活动数据时出错: {e}")

        conn.commit()
        conn.close()

    def get_all_cached_activities(
        self,
        user: str,
        sort_by: str = "TIMESTAMP",
        sort_direction: str = "DESC"
    ) -> List[Dict[str, Any]]:
        """获取用户所有缓存的活动"""
        return self.get_cached_activities(
            user=user,
            limit=None,
            offset=0,
            sort_by=sort_by,
            sort_direction=sort_direction
        )

    def clear_user_cache(self, user: str):
        """清除指定用户的缓存"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM user_activities WHERE user_address = ?", (user.lower(),))
        conn.commit()
        conn.close()

    def get_cache_stats(self, user: Optional[str] = None) -> Dict[str, Any]:
        """获取缓存统计信息"""
        conn = self.get_connection()
        cursor = conn.cursor()

        if user:
            cursor.execute("""
                SELECT 
                    COUNT(*) as total_count,
                    MIN(timestamp) as oldest_timestamp,
                    MAX(timestamp) as newest_timestamp,
                    MAX(updated_at) as last_updated
                FROM user_activities 
                WHERE user_address = ?
            """, (user.lower(),))
        else:
            cursor.execute("""
                SELECT 
                    COUNT(*) as total_count,
                    COUNT(DISTINCT user_address) as user_count,
                    MIN(timestamp) as oldest_timestamp,
                    MAX(timestamp) as newest_timestamp
                FROM user_activities
            """)

        result = cursor.fetchone()
        conn.close()
        return dict(result) if result else {}


cache_manager = CacheManager()

# ==================== API 调用模块 ====================


def _create_session():
    """创建带重试策略的 requests session"""
    retry_strategy = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"]
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session = requests.Session()
    session.mount("https://", adapter)
    return session


def _normalize_timestamp(timestamp: int) -> int:
    """标准化时间戳（毫秒转秒）"""
    return timestamp // 1000 if timestamp > 1e10 else timestamp


def _fetch_user_activity_from_api(
    user: str,
    limit: int = BATCH_SIZE_DEFAULT,
    offset: int = 0,
    sort_by: str = "TIMESTAMP",
    sort_direction: str = "DESC",
    exclude_deposits_withdrawals: bool = True
) -> List[Dict[str, Any]]:
    """从 Polymarket API 获取用户活动"""
    params = {
        "user": user,
        "limit": limit,
        "offset": offset,
        "sortBy": sort_by,
        "sortDirection": sort_direction,
        "excludeDepositsWithdrawals": str(exclude_deposits_withdrawals).lower()
    }

    session = _create_session()
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json",
    }

    max_retries = 3
    retry_delay = 2

    for attempt in range(max_retries):
        try:
            response = session.get(
                f"{BASE_URL}/v1/activity",
                params=params,
                headers=headers,
                timeout=(10, 30)
            )
            response.raise_for_status()
            result = response.json()

            # 首次请求保存日志
            if offset == 0 and result and isinstance(result, list) and len(result) > 0:
                try:
                    log_file = f"api_debug_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
                    with open(log_file, 'w', encoding='utf-8') as f:
                        f.write("=" * 80 + "\n")
                        f.write(f"首次{BATCH_SIZE_DEFAULT}条数据请求和响应日志\n")
                        f.write(
                            f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                        f.write("=" * 80 + "\n\n")
                        f.write("请求信息:\n")
                        f.write("-" * 80 + "\n")
                        f.write(f"URL: {BASE_URL}/v1/activity\n")
                        f.write(
                            f"参数: {json.dumps(params, indent=2, ensure_ascii=False)}\n")
                        f.write(
                            f"Headers: {json.dumps(headers, indent=2, ensure_ascii=False)}\n")
                        f.write("\n响应信息:\n")
                        f.write("-" * 80 + "\n")
                        f.write(f"状态码: {response.status_code}\n")
                        f.write(f"返回记录数: {len(result)}\n")
                        f.write("\n完整响应数据:\n")
                        f.write("-" * 80 + "\n")
                        f.write(json.dumps(result, indent=2, ensure_ascii=False))
                    logger.info(f"已保存首次请求日志到: {log_file}")
                except Exception as e:
                    logger.warning(f"保存请求日志失败: {str(e)}")

            return result

        except requests.exceptions.ConnectionError as e:
            if attempt < max_retries - 1:
                time.sleep(retry_delay * (attempt + 1))
            else:
                raise HTTPException(
                    status_code=500,
                    detail=f"Polymarket API 连接失败，已重试 {max_retries} 次: {str(e)}"
                )
        except requests.exceptions.Timeout as e:
            if attempt < max_retries - 1:
                time.sleep(retry_delay * (attempt + 1))
            else:
                raise HTTPException(
                    status_code=500,
                    detail=f"Polymarket API 请求超时，已重试 {max_retries} 次: {str(e)}"
                )
        except requests.exceptions.RequestException as e:
            raise HTTPException(
                status_code=500,
                detail=f"Polymarket API 请求失败: {str(e)}"
            )

# ==================== 业务逻辑模块 ====================


def _filter_recent_data(data: List[Dict[str, Any]], days: int = THREE_MONTHS_DAYS) -> List[Dict[str, Any]]:
    """过滤出最近N天的数据"""
    cutoff_timestamp = int((datetime.now() - timedelta(days=days)).timestamp())
    filtered = []
    for item in data:
        timestamp = _normalize_timestamp(item.get('timestamp', 0))
        if timestamp >= cutoff_timestamp:
            filtered.append(item)
        else:
            break  # 数据已排序，遇到旧数据即可停止
    return filtered


def _deduplicate_by_key(data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """使用 (transactionHash, conditionId) 去重"""
    seen = set()
    unique = []
    for item in data:
        key = (item.get('transactionHash', ''), item.get('conditionId', ''))
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


def get_user_activity(
    user: str,
    limit: int = BATCH_SIZE_DEFAULT,
    offset: int = 0,
    sort_by: str = "TIMESTAMP",
    sort_direction: str = "DESC",
    use_cache: bool = True,
    exclude_deposits_withdrawals: bool = True
) -> List[Dict[str, Any]]:
    """获取用户活动（带缓存支持）"""
    if not use_cache:
        return _fetch_user_activity_from_api(
            user, limit, offset, sort_by, sort_direction, exclude_deposits_withdrawals
        )

    cache_update_limit = max(limit + offset, CACHE_UPDATE_MIN)

    try:
        latest_data = _fetch_user_activity_from_api(
            user=user,
            limit=cache_update_limit,
            offset=0,
            sort_by=sort_by,
            sort_direction=sort_direction,
            exclude_deposits_withdrawals=exclude_deposits_withdrawals
        )

        if latest_data:
            cache_manager.save_activities(user, latest_data)

        return cache_manager.get_cached_activities(
            user=user,
            limit=limit,
            offset=offset,
            sort_by=sort_by,
            sort_direction=sort_direction
        )

    except Exception as e:
        try:
            cached_data = cache_manager.get_cached_activities(
                user=user,
                limit=limit,
                offset=offset,
                sort_by=sort_by,
                sort_direction=sort_direction
            )
            if cached_data:
                return cached_data
        except:
            pass

        raise HTTPException(
            status_code=500,
            detail=f"获取用户活动失败: {str(e)}"
        )


def get_all_user_activity(
    user: str,
    sort_by: str = "TIMESTAMP",
    sort_direction: str = "DESC",
    batch_size: int = BATCH_SIZE_DEFAULT,
    max_records: Optional[int] = None,
    use_cache: bool = True,
    exclude_deposits_withdrawals: bool = True
) -> List[Dict[str, Any]]:
    """循环获取用户的所有历史活动记录"""
    batch_size = min(batch_size, BATCH_SIZE_MAX)
    cutoff_timestamp = int(
        (datetime.now() - timedelta(days=THREE_MONTHS_DAYS)).timestamp())

    # 获取缓存数据
    cached_data = cache_manager.get_all_cached_activities(
        user=user,
        sort_by=sort_by,
        sort_direction=sort_direction
    ) if use_cache else []

    all_activities = []
    offset = 0

    # 如果有缓存，检查是否需要继续获取
    if cached_data:
        try:
            first_batch = _fetch_user_activity_from_api(
                user=user,
                limit=batch_size,
                offset=0,
                sort_by=sort_by,
                sort_direction=sort_direction,
                exclude_deposits_withdrawals=exclude_deposits_withdrawals
            )

            if first_batch:
                filtered_batch = _filter_recent_data(
                    first_batch, THREE_MONTHS_DAYS)
                if filtered_batch:
                    cached_keys = {
                        (item.get('transactionHash', ''),
                         item.get('conditionId', ''))
                        for item in _filter_recent_data(cached_data, THREE_MONTHS_DAYS)
                    }
                    first_batch_keys = {
                        (item.get('transactionHash', ''),
                         item.get('conditionId', ''))
                        for item in filtered_batch
                    }

                    if first_batch_keys.issubset(cached_keys):
                        logger.info("缓存已是最新，直接使用缓存数据")
                        all_activities = []
                    else:
                        all_activities.extend(filtered_batch)
                        offset += batch_size
        except Exception as e:
            logger.warning(f"获取第一批数据失败，将使用缓存: {str(e)}")

    # 循环获取数据
    last_batch_min_timestamp = None
    while True:
        try:
            batch = _fetch_user_activity_from_api(
                user=user,
                limit=batch_size,
                offset=offset,
                sort_by=sort_by,
                sort_direction=sort_direction,
                exclude_deposits_withdrawals=exclude_deposits_withdrawals
            )

            if not batch or len(batch) == 0:
                break

            filtered_batch = _filter_recent_data(batch, THREE_MONTHS_DAYS)
            if not filtered_batch:
                break

            # 检测时间逆序
            if last_batch_min_timestamp is not None and filtered_batch:
                first_timestamp = _normalize_timestamp(
                    filtered_batch[0].get('timestamp', 0))
                if first_timestamp > last_batch_min_timestamp:
                    logger.warning("检测到时间逆序，停止获取")
                    break

            unique_batch = _deduplicate_by_key(filtered_batch)
            all_activities.extend(unique_batch)

            if unique_batch:
                last_batch_min_timestamp = min(
                    _normalize_timestamp(item.get('timestamp', 0))
                    for item in unique_batch
                )

            # 增量保存缓存
            if use_cache and unique_batch:
                try:
                    cache_manager.save_activities(user, unique_batch)
                except Exception as e:
                    logger.warning(f"保存缓存失败: {str(e)}")

            if max_records and len(all_activities) >= max_records:
                all_activities = all_activities[:max_records]
                break

            offset += batch_size
            if offset > 10000:
                break

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"获取数据时出错: {str(e)}", exc_info=True)
            raise HTTPException(
                status_code=500,
                detail=f"获取数据时出错: {str(e)}"
            )

    # 合并缓存和API数据
    if cached_data:
        merged_data = _deduplicate_by_key(all_activities)
        cached_recent = _filter_recent_data(cached_data, THREE_MONTHS_DAYS)
        cached_keys = {
            (item.get('transactionHash', ''), item.get('conditionId', ''))
            for item in merged_data
        }

        for item in cached_recent:
            key = (item.get('transactionHash', ''),
                   item.get('conditionId', ''))
            if key not in cached_keys:
                merged_data.append(item)

        merged_data.sort(
            key=lambda x: _normalize_timestamp(x.get('timestamp', 0)),
            reverse=(sort_direction == "DESC")
        )

        if max_records:
            merged_data = merged_data[:max_records]

        return merged_data

    return all_activities

# ==================== 路由模块 ====================


@app.get("/", tags=["Root"])
async def root():
    """根路径，返回 API 信息"""
    return {
        "service": "Polymarket 用户活动 API",
        "version": "1.0.0",
        "endpoints": {
            "/activity": "获取用户活动（分页）",
            "/activity/all": "获取用户所有历史活动",
            "/cache/stats": "查看缓存统计",
            "/cache/clear": "清除用户缓存",
            "/health": "健康检查",
            "/docs": "API 文档（Swagger UI）"
        }
    }


@app.get("/health", tags=["Health"])
async def health_check():
    """健康检查端点"""
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        return {
            "status": "healthy",
            "polymarket_api": "accessible" if response.status_code == 200 else "unavailable"
        }
    except:
        return {
            "status": "healthy",
            "polymarket_api": "unavailable"
        }


@app.get(
    "/activity",
    response_model=ActivityResponse,
    tags=["Activity"],
    summary="获取用户活动（分页或全部）",
    description="获取指定用户的活动记录，支持分页查询和获取所有历史记录"
)
async def get_activity(
    user: str = Query(..., description="用户地址（0x开头的42位十六进制字符串）"),
    limit: Optional[int] = Query(
        100, ge=-1, le=500, description="返回数量限制（1-500为分页，0或-1表示获取所有记录）"),
    offset: int = Query(0, ge=0, le=10000,
                        description="偏移量（0-10000，仅在limit>0时有效）"),
    sort_by: str = Query("TIMESTAMP", description="排序字段"),
    sort_direction: str = Query(
        "DESC", pattern="^(ASC|DESC)$", description="排序方向"),
    use_cache: bool = Query(True, description="是否使用缓存（默认True）"),
    exclude_deposits_withdrawals: bool = Query(True, description="是否排除存款和提现记录")
):
    """获取用户活动记录（分页或全部）"""
    try:
        if not user.startswith("0x") or len(user) != 42:
            raise HTTPException(
                status_code=400,
                detail="无效的用户地址格式，必须是0x开头的42位十六进制字符串"
            )

        if limit is None or limit == 0 or limit == -1:
            data = get_all_user_activity(
                user=user,
                sort_by=sort_by,
                sort_direction=sort_direction,
                batch_size=BATCH_SIZE_DEFAULT,
                max_records=None,
                use_cache=use_cache,
                exclude_deposits_withdrawals=exclude_deposits_withdrawals
            )
            message = f"成功获取所有 {len(data)} 条历史活动记录"
        else:
            if limit < 1:
                raise HTTPException(
                    status_code=400,
                    detail="limit 参数无效，必须大于0（或使用0/-1获取所有记录）"
                )

            data = get_user_activity(
                user=user,
                limit=limit,
                offset=offset,
                sort_by=sort_by,
                sort_direction=sort_direction,
                use_cache=use_cache,
                exclude_deposits_withdrawals=exclude_deposits_withdrawals
            )
            message = f"成功获取 {len(data)} 条活动记录（offset: {offset}, limit: {limit}）"

        return ActivityResponse(
            success=True,
            count=len(data),
            data=data,
            message=message
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取用户活动失败: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"获取用户活动失败: {str(e)}"
        )


@app.get(
    "/activity/all",
    response_model=ActivityResponse,
    tags=["Activity"],
    summary="获取用户所有历史活动"
)
async def get_all_activity(
    user: str = Query(..., description="用户地址（0x开头的42位十六进制字符串）"),
    sort_by: str = Query("TIMESTAMP", description="排序字段"),
    sort_direction: str = Query(
        "DESC", pattern="^(ASC|DESC)$", description="排序方向"),
    batch_size: int = Query(
        BATCH_SIZE_DEFAULT, ge=1, le=BATCH_SIZE_MAX, description=f"每批获取的记录数（1-{BATCH_SIZE_MAX}，默认{BATCH_SIZE_DEFAULT}）"),
    max_records: Optional[int] = Query(None, ge=1, description="最大获取记录数"),
    use_cache: bool = Query(True, description="是否使用缓存"),
    exclude_deposits_withdrawals: bool = Query(True, description="是否排除存款和提现记录")
):
    """获取用户所有历史活动记录"""
    try:
        if not user.startswith("0x") or len(user) != 42:
            raise HTTPException(
                status_code=400,
                detail="无效的用户地址格式，必须是0x开头的42位十六进制字符串"
            )

        data = get_all_user_activity(
            user=user,
            sort_by=sort_by,
            sort_direction=sort_direction,
            batch_size=batch_size,
            max_records=max_records,
            use_cache=use_cache,
            exclude_deposits_withdrawals=exclude_deposits_withdrawals
        )

        return ActivityResponse(
            success=True,
            count=len(data),
            data=data,
            message=f"成功获取所有 {len(data)} 条历史活动记录"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取用户活动失败: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"获取用户活动失败: {str(e)}"
        )


@app.get("/cache/stats", tags=["Cache"], summary="查看缓存统计")
async def get_cache_stats(
    user: Optional[str] = Query(None, description="用户地址（可选）")
):
    """获取缓存统计信息"""
    try:
        stats = cache_manager.get_cache_stats(user)

        if 'oldest_timestamp' in stats and stats['oldest_timestamp']:
            stats['oldest_datetime'] = datetime.fromtimestamp(
                stats['oldest_timestamp']
            ).isoformat()
        if 'newest_timestamp' in stats and stats['newest_timestamp']:
            stats['newest_datetime'] = datetime.fromtimestamp(
                stats['newest_timestamp']
            ).isoformat()

        return {
            "success": True,
            "stats": stats,
            "message": f"缓存统计信息（{'用户' if user else '全局'}）"
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"获取缓存统计失败: {str(e)}"
        )


@app.delete("/cache/clear", tags=["Cache"], summary="清除用户缓存")
async def clear_cache(
    user: str = Query(..., description="用户地址（0x开头的42位十六进制字符串）")
):
    """清除指定用户的缓存"""
    try:
        if not user.startswith("0x") or len(user) != 42:
            raise HTTPException(
                status_code=400,
                detail="无效的用户地址格式，必须是0x开头的42位十六进制字符串"
            )

        cache_manager.clear_user_cache(user)
        return {
            "success": True,
            "message": f"已清除用户 {user} 的缓存"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"清除缓存失败: {str(e)}"
        )


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """全局异常处理器"""
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": "服务器内部错误",
            "detail": str(exc)
        }
    )


if __name__ == "__main__":
    import os
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8002"))
    uvicorn.run(
        "activity:app",
        host=host,
        port=port,
        reload=True
    )
