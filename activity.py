"""
Polymarket 用户活动 HTTP 服务
基于 FastAPI 框架
"""

import requests
import sqlite3
import json
import os
from typing import List, Dict, Any, Optional
from datetime import datetime
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

# Polymarket Data-API 基础 URL
BASE_URL = "https://data-api.polymarket.com"

# SQLite 数据库文件路径
DB_FILE = "polymarket_cache.db"

# 创建 FastAPI 应用
app = FastAPI(
    title="Polymarket 用户活动 API",
    description="提供 Polymarket 用户活动查询服务的 HTTP API",
    version="1.0.0"
)

# 添加 CORS 中间件，允许前端跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境建议指定具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


# ==================== SQLite 缓存管理 ====================

class CacheManager:
    """SQLite 缓存管理器"""

    def __init__(self, db_file: str = DB_FILE):
        self.db_file = db_file
        self.init_database()

    def get_connection(self):
        """获取数据库连接"""
        conn = sqlite3.connect(self.db_file)
        conn.row_factory = sqlite3.Row  # 使结果可以通过列名访问
        return conn

    def init_database(self):
        """初始化数据库表"""
        conn = self.get_connection()
        cursor = conn.cursor()

        # 创建用户活动缓存表
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

        # 创建索引以提高查询性能
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

    def get_latest_timestamp(self, user: str) -> Optional[int]:
        """获取用户最新的活动时间戳"""
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT MAX(timestamp) as max_timestamp 
            FROM user_activities 
            WHERE user_address = ?
        """, (user.lower(),))

        result = cursor.fetchone()
        conn.close()

        return result['max_timestamp'] if result and result['max_timestamp'] else None

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

        # 构建排序 SQL
        order_by = f"timestamp {sort_direction}"
        if sort_by != "TIMESTAMP":
            # 如果排序字段不是 timestamp，需要从 JSON 中提取
            # 这里简化处理，主要按 timestamp 排序
            order_by = f"timestamp {sort_direction}"

        query = f"""
            SELECT activity_data 
            FROM user_activities 
            WHERE user_address = ?
            ORDER BY {order_by}
            LIMIT ? OFFSET ?
        """

        limit_value = limit if limit else 999999  # SQLite 不支持无限制
        cursor.execute(query, (user.lower(), limit_value, offset))

        results = cursor.fetchall()
        conn.close()

        # 解析 JSON 数据
        activities = []
        for row in results:
            try:
                activity = json.loads(row['activity_data'])
                activities.append(activity)
            except:
                continue

        return activities

    def save_activities(self, user: str, activities: List[Dict[str, Any]]):
        """保存活动数据到缓存"""
        if not activities:
            return

        conn = self.get_connection()
        cursor = conn.cursor()

        saved_count = 0
        for activity in activities:
            try:
                transaction_hash = activity.get('transactionHash', '')
                timestamp = activity.get('timestamp', 0)
                condition_id = activity.get('conditionId', '')
                activity_json = json.dumps(activity)

                # 使用 INSERT OR REPLACE 避免重复
                cursor.execute("""
                    INSERT OR REPLACE INTO user_activities 
                    (user_address, transaction_hash, timestamp, condition_id, activity_data, updated_at)
                    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """, (
                    user.lower(),
                    transaction_hash,
                    timestamp,
                    condition_id,
                    activity_json
                ))
                saved_count += 1
            except Exception as e:
                # 记录错误但继续处理其他记录
                print(f"保存活动数据时出错: {e}")
                continue

        conn.commit()
        conn.close()

        return saved_count

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

        cursor.execute("""
            DELETE FROM user_activities 
            WHERE user_address = ?
        """, (user.lower(),))

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


# 全局缓存管理器实例
cache_manager = CacheManager()


def _fetch_user_activity_from_api(
    user: str,
    limit: int = 100,
    offset: int = 0,
    sort_by: str = "TIMESTAMP",
    sort_direction: str = "DESC",
    exclude_deposits_withdrawals: bool = True
) -> List[Dict[str, Any]]:
    """
    从 Polymarket API 获取用户活动（内部函数）

        参数:
            user: 用户地址 (必需)
            limit: 返回数量限制 (默认: 100)
            offset: 偏移量 (默认: 0)
            sort_by: 排序字段 (默认: TIMESTAMP)
            sort_direction: 排序方向 (ASC, DESC)
            exclude_deposits_withdrawals: 是否排除存款和提现记录 (默认: True)

    返回:
        活动记录列表
        """
    params = {
        "user": user,
        "limit": limit,
        "offset": offset,
        "sortBy": sort_by,
        "sortDirection": sort_direction,
        "excludeDepositsWithdrawals": str(exclude_deposits_withdrawals).lower()
    }

    try:
        response = requests.get(
            f"{BASE_URL}/activity", params=params, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        raise HTTPException(
            status_code=500,
            detail=f"Polymarket API 请求失败: {str(e)}"
        )


def get_user_activity(
    user: str,
    limit: int = 100,
    offset: int = 0,
    sort_by: str = "TIMESTAMP",
    sort_direction: str = "DESC",
    use_cache: bool = True,
    exclude_deposits_withdrawals: bool = True
) -> List[Dict[str, Any]]:
    """
    获取用户活动（带缓存支持）

    参数:
        user: 用户地址 (必需)
        limit: 返回数量限制 (默认: 100)
        offset: 偏移量 (默认: 0)
        sort_by: 排序字段 (默认: TIMESTAMP)
        sort_direction: 排序方向 (ASC, DESC)
        use_cache: 是否使用缓存 (默认: True)
        exclude_deposits_withdrawals: 是否排除存款和提现记录 (默认: True)

    返回:
        活动记录列表
    """
    if not use_cache:
        # 不使用缓存，直接调用 API
        return _fetch_user_activity_from_api(
            user, limit, offset, sort_by, sort_direction, exclude_deposits_withdrawals
        )

    # 使用缓存逻辑
    # 1. 先获取最新的数据（从 offset=0 开始，获取足够多的数据以确保覆盖缓存）
    # 2. 更新缓存
    # 3. 从缓存中获取分页数据

    # 获取最新的数据来更新缓存（获取比请求更多的数据以确保缓存完整）
    cache_update_limit = max(limit + offset, 500)  # 至少获取500条来更新缓存

    try:
        # 从 API 获取最新数据
        latest_data = _fetch_user_activity_from_api(
            user=user,
            limit=cache_update_limit,
            offset=0,
            sort_by=sort_by,
            sort_direction=sort_direction,
            exclude_deposits_withdrawals=exclude_deposits_withdrawals
        )

        # 更新缓存
        if latest_data:
            cache_manager.save_activities(user, latest_data)

        # 从缓存获取分页数据
        cached_data = cache_manager.get_cached_activities(
            user=user,
            limit=limit,
            offset=offset,
            sort_by=sort_by,
            sort_direction=sort_direction
        )

        return cached_data

    except Exception as e:
        # 如果出错，尝试从缓存获取
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

        # 如果缓存也没有，抛出异常
        raise HTTPException(
            status_code=500,
            detail=f"获取用户活动失败: {str(e)}"
        )


def get_all_user_activity(
    user: str,
    sort_by: str = "TIMESTAMP",
    sort_direction: str = "DESC",
    batch_size: int = 100,
    max_records: Optional[int] = None,
    use_cache: bool = True,
    exclude_deposits_withdrawals: bool = True
) -> List[Dict[str, Any]]:
    """
    循环获取用户的所有历史活动记录（带缓存支持）

    参数:
        user: 用户地址 (必需)
        sort_by: 排序字段 (默认: TIMESTAMP)
        sort_direction: 排序方向 (ASC, DESC)
        batch_size: 每批获取的记录数 (默认: 100, 最大: 500)
        max_records: 最大获取记录数 (None 表示获取所有记录)
        use_cache: 是否使用缓存 (默认: True)
        exclude_deposits_withdrawals: 是否排除存款和提现记录 (默认: True)

    返回:
        所有活动记录的列表
    """
    if use_cache:
        # 先尝试从缓存获取
        cached_data = cache_manager.get_all_cached_activities(
            user=user,
            sort_by=sort_by,
            sort_direction=sort_direction
        )

        # 获取缓存中最新的时间戳
        latest_timestamp = cache_manager.get_latest_timestamp(user)

        # 如果缓存中有数据，只需要获取更新的数据
        # 但由于 API 不支持按时间戳过滤，我们需要获取最新的数据并合并
        try:
            # 获取最新的数据（从 offset=0 开始）
            latest_data = _fetch_user_activity_from_api(
                user=user,
                limit=500,  # 获取一批最新数据
                offset=0,
                sort_by=sort_by,
                sort_direction=sort_direction,
                exclude_deposits_withdrawals=exclude_deposits_withdrawals
            )

            if latest_data:
                # 更新缓存
                cache_manager.save_activities(user, latest_data)

                # 合并缓存数据和新数据，去重
                # 使用 transactionHash + timestamp 作为唯一标识
                seen = set()
                merged_data = []

                # 先添加新数据
                for item in latest_data:
                    key = (item.get('transactionHash', ''),
                           item.get('timestamp', 0))
                    if key not in seen:
                        seen.add(key)
                        merged_data.append(item)

                # 再添加缓存中不在新数据中的记录
                for item in cached_data:
                    key = (item.get('transactionHash', ''),
                           item.get('timestamp', 0))
                    if key not in seen:
                        seen.add(key)
                        merged_data.append(item)

                # 按时间戳排序
                merged_data.sort(
                    key=lambda x: x.get('timestamp', 0),
                    reverse=(sort_direction == "DESC")
                )

                # 应用最大记录数限制
                if max_records:
                    merged_data = merged_data[:max_records]

                return merged_data
            else:
                # 如果没有新数据，返回缓存数据
                if max_records:
                    return cached_data[:max_records]
                return cached_data

        except Exception as e:
            # 如果 API 请求失败，返回缓存数据
            if cached_data:
                if max_records:
                    return cached_data[:max_records]
                return cached_data
            raise HTTPException(
                status_code=500,
                detail=f"获取数据时出错: {str(e)}"
            )

    # 不使用缓存，直接循环获取所有数据
    all_activities = []
    offset = 0
    batch_size = min(batch_size, 500)  # API 限制最大 500

    while True:
        try:
            # 获取当前批次
            batch = _fetch_user_activity_from_api(
                user=user,
                limit=batch_size,
                offset=offset,
                sort_by=sort_by,
                sort_direction=sort_direction,
                exclude_deposits_withdrawals=exclude_deposits_withdrawals
            )

            # 如果没有数据，说明已经获取完所有记录
            if not batch or len(batch) == 0:
                break

            # 添加到总列表
            all_activities.extend(batch)

            # 如果返回的记录数少于 batch_size，说明已经是最后一批
            if len(batch) < batch_size:
                break

            # 如果设置了最大记录数限制
            if max_records and len(all_activities) >= max_records:
                all_activities = all_activities[:max_records]
                break

            # 更新偏移量，准备获取下一批
            offset += batch_size

            # 安全限制：防止无限循环（API 限制 offset 最大 10000）
            if offset > 10000:
                break

        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"获取数据时出错: {str(e)}"
            )

    return all_activities


@app.get("/", tags=["Root"])
async def root():
    """根路径，返回 API 信息"""
    return {
        "service": "Polymarket 用户活动 API",
        "version": "1.0.0",
        "features": {
            "caching": "SQLite 缓存支持",
            "incremental_update": "增量数据同步"
        },
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
    user: str = Query(..., description="用户地址（0x开头的42位十六进制字符串）",
                      examples=["0x45deaaD70997b2998FBb9433B1819178e34B409C"]),
    limit: Optional[int] = Query(
        100, ge=-1, le=500, description="返回数量限制（1-500为分页，0或-1表示获取所有记录）"),
    offset: int = Query(0, ge=0, le=10000,
                        description="偏移量（0-10000，仅在limit>0时有效）"),
    sort_by: str = Query("TIMESTAMP", description="排序字段"),
    sort_direction: str = Query(
        "DESC", pattern="^(ASC|DESC)$", description="排序方向（ASC 或 DESC）"),
    use_cache: bool = Query(True, description="是否使用缓存（默认True）"),
    exclude_deposits_withdrawals: bool = Query(True, description="是否排除存款和提现记录（默认True）")
):
    """
    获取用户活动记录（分页或全部）

    - **user**: 用户钱包地址（必需）
    - **limit**: 每页返回的记录数（默认100，最大500）。设置为 0 或 -1 表示获取所有历史记录
    - **offset**: 分页偏移量（默认0，仅在limit>0时有效）
    - **sort_by**: 排序字段（默认TIMESTAMP）
    - **sort_direction**: 排序方向，ASC 或 DESC（默认DESC）
    - **use_cache**: 是否使用缓存（默认True）
    - **exclude_deposits_withdrawals**: 是否排除存款和提现记录（默认True）
    """
    try:
        # 验证用户地址格式
        if not user.startswith("0x") or len(user) != 42:
            raise HTTPException(
                status_code=400,
                detail="无效的用户地址格式，必须是0x开头的42位十六进制字符串"
            )

        # 如果 limit 为 0 或 -1，获取所有记录
        if limit is None or limit == 0 or limit == -1:
            # 获取所有历史记录
            data = get_all_user_activity(
                user=user,
                sort_by=sort_by,
                sort_direction=sort_direction,
                batch_size=500,  # 使用最大批次大小以提高效率
                max_records=None,  # 不限制最大记录数
                use_cache=use_cache,
                exclude_deposits_withdrawals=exclude_deposits_withdrawals
            )
            message = f"成功获取所有 {len(data)} 条历史活动记录"
        else:
            # 分页查询
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
        raise HTTPException(
            status_code=500,
            detail=f"获取用户活动失败: {str(e)}"
        )


@app.get(
    "/activity/all",
    response_model=ActivityResponse,
    tags=["Activity"],
    summary="获取用户所有历史活动",
    description="循环获取指定用户的所有历史活动记录，支持缓存"
)
async def get_all_activity(
    user: str = Query(..., description="用户地址（0x开头的42位十六进制字符串）",
                      examples=["0x45deaaD70997b2998FBb9433B1819178e34B409C"]),
    sort_by: str = Query("TIMESTAMP", description="排序字段"),
    sort_direction: str = Query(
        "DESC", pattern="^(ASC|DESC)$", description="排序方向（ASC 或 DESC）"),
    batch_size: int = Query(100, ge=1, le=500, description="每批获取的记录数（1-500）"),
    max_records: Optional[int] = Query(
        None, ge=1, description="最大获取记录数（None表示获取所有）"),
    use_cache: bool = Query(True, description="是否使用缓存（默认True）"),
    exclude_deposits_withdrawals: bool = Query(True, description="是否排除存款和提现记录（默认True）")
):
    """
    获取用户所有历史活动记录

    此端点会自动循环分页获取所有历史记录，直到获取完所有数据或达到限制。

    - **user**: 用户钱包地址（必需）
    - **sort_by**: 排序字段（默认TIMESTAMP）
    - **sort_direction**: 排序方向，ASC 或 DESC（默认DESC）
    - **batch_size**: 每批获取的记录数（默认100，最大500）
    - **max_records**: 最大获取记录数限制（可选，None表示获取所有）
    - **exclude_deposits_withdrawals**: 是否排除存款和提现记录（默认True）
    """
    try:
        # 验证用户地址格式
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
        raise HTTPException(
            status_code=500,
            detail=f"获取用户活动失败: {str(e)}"
        )


@app.get(
    "/cache/stats",
    tags=["Cache"],
    summary="查看缓存统计",
    description="查看缓存统计信息，可以指定用户或查看全局统计"
)
async def get_cache_stats(
    user: Optional[str] = Query(None, description="用户地址（可选，不提供则查看全局统计）",
                                examples=["0x45deaaD70997b2998FBb9433B1819178e34B409C"])
):
    """获取缓存统计信息"""
    try:
        stats = cache_manager.get_cache_stats(user)

        # 格式化时间戳
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


@app.delete(
    "/cache/clear",
    tags=["Cache"],
    summary="清除用户缓存",
    description="清除指定用户的缓存数据"
)
async def clear_cache(
    user: str = Query(..., description="用户地址（0x开头的42位十六进制字符串）",
                      examples=["0x45deaaD70997b2998FBb9433B1819178e34B409C"])
):
    """清除指定用户的缓存"""
    try:
        # 验证用户地址格式
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
    # 运行服务
    # 使用: python activity.py
    # 或: uvicorn activity:app --reload --host 0.0.0.0 --port 8000
    uvicorn.run(
        "activity:app",  # 使用字符串形式以支持 reload
        host="0.0.0.0",
        port=8000,
        reload=True
    )
