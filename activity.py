"""
Polymarket 用户活动 HTTP 服务
基于 FastAPI 框架
"""

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import sqlite3
import json
import os
import logging
import time
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta, timedelta
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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

    # 配置重试策略
    retry_strategy = Retry(
        total=3,  # 最多重试3次
        backoff_factor=1,  # 重试间隔：1秒、2秒、4秒
        status_forcelist=[429, 500, 502, 503, 504],  # 这些状态码会触发重试
        allowed_methods=["GET"]
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)

    # 创建 session 并配置重试
    session = requests.Session()
    session.mount("https://", adapter)

    # 设置请求头
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json",
    }

    max_retries = 3
    retry_delay = 2  # 秒

    for attempt in range(max_retries):
        try:
            request_url = f"{BASE_URL}/v1/activity"
            request_log = f"请求 Polymarket API (尝试 {attempt + 1}/{max_retries}): {request_url}\n参数: {params}\nHeaders: {headers}\n"
            logger.info(request_log.strip())

            response = session.get(
                request_url,
                params=params,
                headers=headers,
                timeout=(10, 30)  # (连接超时, 读取超时)
            )
            response.raise_for_status()
            result = response.json()

            response_log = f"API 返回 {len(result) if isinstance(result, list) else 'N/A'} 条记录\n状态码: {response.status_code}\n响应头: {dict(response.headers)}\n"
            logger.info(response_log.strip())

            # 如果是首次请求（offset=0）且返回了数据，保存请求和响应日志到文件
            if offset == 0 and result and isinstance(result, list) and len(result) > 0:
                try:
                    import json
                    from datetime import datetime
                    log_file = f"api_debug_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
                    with open(log_file, 'w', encoding='utf-8') as f:
                        f.write("=" * 80 + "\n")
                        f.write(f"首次500条数据请求和响应日志\n")
                        f.write(
                            f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                        f.write("=" * 80 + "\n\n")
                        f.write("请求信息:\n")
                        f.write("-" * 80 + "\n")
                        f.write(f"URL: {request_url}\n")
                        f.write(
                            f"参数: {json.dumps(params, indent=2, ensure_ascii=False)}\n")
                        f.write(
                            f"Headers: {json.dumps(headers, indent=2, ensure_ascii=False)}\n")
                        f.write("\n响应信息:\n")
                        f.write("-" * 80 + "\n")
                        f.write(f"状态码: {response.status_code}\n")
                        f.write(
                            f"响应头: {json.dumps(dict(response.headers), indent=2, ensure_ascii=False)}\n")
                        f.write(f"返回记录数: {len(result)}\n")
                        f.write("\n响应数据 (前10条):\n")
                        f.write("-" * 80 + "\n")
                        f.write(json.dumps(
                            result[:10], indent=2, ensure_ascii=False))
                        f.write("\n\n完整响应数据:\n")
                        f.write("-" * 80 + "\n")
                        f.write(json.dumps(result, indent=2, ensure_ascii=False))
                    logger.info(f"已保存首次请求日志到: {log_file}")
                except Exception as e:
                    logger.warning(f"保存请求日志失败: {str(e)}")

            return result
        except requests.exceptions.ConnectionError as e:
            logger.warning(f"连接错误 (尝试 {attempt + 1}/{max_retries}): {str(e)}")
            if attempt < max_retries - 1:
                wait_time = retry_delay * (attempt + 1)
                logger.info(f"等待 {wait_time} 秒后重试...")
                time.sleep(wait_time)
            else:
                logger.error(f"所有重试都失败了: {str(e)}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Polymarket API 连接失败，已重试 {max_retries} 次: {str(e)}"
                )
        except requests.exceptions.Timeout as e:
            logger.warning(f"请求超时 (尝试 {attempt + 1}/{max_retries}): {str(e)}")
            if attempt < max_retries - 1:
                wait_time = retry_delay * (attempt + 1)
                logger.info(f"等待 {wait_time} 秒后重试...")
                time.sleep(wait_time)
            else:
                logger.error(f"所有重试都失败了: {str(e)}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Polymarket API 请求超时，已重试 {max_retries} 次: {str(e)}"
                )
        except requests.exceptions.RequestException as e:
            logger.error(f"Polymarket API 请求失败: {str(e)}")
            if hasattr(e, 'response') and e.response is not None:
                logger.error(f"响应状态码: {e.response.status_code}")
                logger.error(f"响应内容: {e.response.text[:500]}")  # 只记录前500字符
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
    batch_size: int = 500,
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
        batch_size: 每批获取的记录数 (默认: 500, 最大: 500)
        max_records: 最大获取记录数 (None 表示获取所有记录)
        use_cache: 是否使用缓存 (默认: True)
        exclude_deposits_withdrawals: 是否排除存款和提现记录 (默认: True)

    返回:
        所有活动记录的列表
    """
    # 初始化缓存数据变量（无论是否使用缓存，都尝试获取缓存数据用于合并）
    cached_data = []
    # 先尝试从缓存获取（用于后续合并）
    cached_data = cache_manager.get_all_cached_activities(
        user=user,
        sort_by=sort_by,
        sort_direction=sort_direction
    )

    # 计算3个月前的时间戳（秒级）
    three_months_ago = datetime.now() - timedelta(days=90)
    three_months_ago_timestamp = int(three_months_ago.timestamp())

    # 如果有缓存，先获取第一批数据，检查是否已经拉完所有数据
    all_activities = []
    offset = 0
    batch_size = min(batch_size, 500)  # API 限制最大 500

    if cached_data and len(cached_data) > 0:
        logger.info(f"缓存中有 {len(cached_data)} 条记录，先获取第一批数据检查是否需要继续...")

        # 获取第一批数据
        try:
            first_batch = _fetch_user_activity_from_api(
                user=user,
                limit=batch_size,
                offset=0,
                sort_by=sort_by,
                sort_direction=sort_direction,
                exclude_deposits_withdrawals=exclude_deposits_withdrawals
            )

            if first_batch and len(first_batch) > 0:
                # 过滤出近3个月的数据
                filtered_first_batch = []
                for item in first_batch:
                    timestamp = item.get('timestamp', 0)
                    if timestamp > 1e10:
                        timestamp = timestamp // 1000
                    if timestamp >= three_months_ago_timestamp:
                        filtered_first_batch.append(item)

                if filtered_first_batch:
                    # 检查第一批数据是否都在缓存中
                    # 使用 (transactionHash, conditionId) 作为唯一键
                    cached_keys = set()
                    for item in cached_data:
                        timestamp = item.get('timestamp', 0)
                        if timestamp > 1e10:
                            timestamp = timestamp // 1000
                        if timestamp >= three_months_ago_timestamp:
                            key = (item.get('transactionHash', ''),
                                   item.get('conditionId', ''))
                            cached_keys.add(key)

                    first_batch_in_cache = True
                    for item in filtered_first_batch:
                        key = (item.get('transactionHash', ''),
                               item.get('conditionId', ''))
                        if key not in cached_keys:
                            first_batch_in_cache = False
                            break

                    if first_batch_in_cache:
                        logger.info("第一批数据全部在缓存中，说明缓存已是最新，直接使用缓存数据")
                        # 直接使用缓存数据，不需要继续请求
                        all_activities = []  # 不添加任何新数据，后续会合并缓存
                    else:
                        logger.info("第一批数据不在缓存中，需要继续获取新数据")
                        # 继续正常的循环获取流程
                        all_activities.extend(filtered_first_batch)
                        offset += batch_size
                else:
                    logger.info("第一批数据都超过3个月，直接使用缓存数据")
                    all_activities = []
            else:
                logger.info("第一批数据为空，直接使用缓存数据")
                all_activities = []
        except Exception as e:
            logger.warning(f"获取第一批数据失败，将使用缓存: {str(e)}")
            all_activities = []
    else:
        logger.info("缓存为空，开始循环获取所有数据")
        cached_data = []  # 确保是空列表

    logger.info(
        f"开始循环获取所有数据，batch_size={batch_size}, max_records={max_records}")
    logger.info(
        f"只获取近3个月的数据（时间戳 >= {three_months_ago_timestamp}，日期 >= {three_months_ago.strftime('%Y-%m-%d')}）")

    # 记录上一批数据的最后时间戳（用于检测时间逆序）
    last_batch_min_timestamp = None  # 上一批数据中最小的（最晚的）时间戳

    # 如果 all_activities 为空且 cached_data 不为空，说明缓存已是最新，跳过循环
    if len(all_activities) == 0 and cached_data and len(cached_data) > 0:
        logger.info("跳过循环获取，直接使用缓存数据")
    else:
        # 继续循环获取数据
        while True:
            try:
                # 获取当前批次
                logger.info(
                    f"获取第 {offset // batch_size + 1} 批数据，offset={offset}")
                batch = _fetch_user_activity_from_api(
                    user=user,
                    limit=batch_size,
                    offset=offset,
                    sort_by=sort_by,
                    sort_direction=sort_direction,
                    exclude_deposits_withdrawals=exclude_deposits_withdrawals
                )

                # 检查返回的数据格式
                if not isinstance(batch, list):
                    logger.error(f"API 返回的数据格式错误，期望列表，实际: {type(batch)}")
                    raise ValueError(f"API 返回的数据格式错误: {type(batch)}")

                # 如果没有数据，说明已经获取完所有记录
                if not batch or len(batch) == 0:
                    logger.info("没有更多数据，停止获取")
                    break

                # 过滤出近3个月的数据
                filtered_batch = []
                for item in batch:
                    timestamp = item.get('timestamp', 0)
                    # 如果时间戳是毫秒级，转换为秒级
                    if timestamp > 1e10:
                        timestamp = timestamp // 1000

                    if timestamp >= three_months_ago_timestamp:
                        filtered_batch.append(item)
                    else:
                        # 由于数据是按时间戳降序排列的，一旦遇到3个月前的数据，后面的数据都会更早
                        logger.info(f"遇到3个月前的数据（时间戳: {timestamp}），停止获取")
                        break

                # 如果过滤后没有数据，说明已经超过3个月的范围
                if not filtered_batch:
                    logger.info("当前批次的数据都超过3个月，停止获取")
                    break

                # 检测时间逆序：由于数据是按时间倒序排列（DESC），如果当前批次的第一条时间戳比上一批的最后一条更大，说明时间逆序了
                if last_batch_min_timestamp is not None and len(filtered_batch) > 0:
                    current_batch_first_timestamp = filtered_batch[0].get(
                        'timestamp', 0)
                    if current_batch_first_timestamp > 1e10:
                        current_batch_first_timestamp = current_batch_first_timestamp // 1000

                    # 由于数据是按时间倒序排列（DESC），正常情况下：
                    # - 第一批：时间戳从大到小（例如：1766479927, 1766479897, ...）
                    # - 第二批：时间戳应该继续从大到小，且第一条应该 <= 上一批的最后一条（例如：1766479000, 1766478900, ...）
                    # 如果当前批次的第一条时间戳比上一批的最后一条更大，说明时间逆序了（API返回了重复或错误的数据）
                    if current_batch_first_timestamp > last_batch_min_timestamp:
                        logger.warning(
                            f"检测到时间逆序：当前批次第一条时间戳 {current_batch_first_timestamp} "
                            f"大于上一批最后时间戳 {last_batch_min_timestamp}，停止获取")
                        break

                # 去重后再添加到总列表（避免 API 返回重复数据）
                # 使用 (transactionHash, conditionId) 作为唯一键
                seen_in_batch = set()
                unique_filtered_batch = []
                for item in filtered_batch:
                    key = (item.get('transactionHash', ''),
                           item.get('conditionId', ''))
                    if key not in seen_in_batch:
                        seen_in_batch.add(key)
                        unique_filtered_batch.append(item)

                if len(unique_filtered_batch) < len(filtered_batch):
                    logger.warning(
                        f"当前批次有 {len(filtered_batch) - len(unique_filtered_batch)} 条重复数据")

                # 更新上一批的最小时间戳（当前批次的最后一条，即时间戳最小的）
                if unique_filtered_batch:
                    current_batch_min_timestamp = min(
                        item.get('timestamp', 0) if item.get('timestamp', 0) <= 1e10
                        else item.get('timestamp', 0) // 1000
                        for item in unique_filtered_batch
                    )
                    last_batch_min_timestamp = current_batch_min_timestamp

                # 添加到总列表
                all_activities.extend(unique_filtered_batch)
                logger.info(
                    f"已获取 {len(all_activities)} 条记录，当前批次返回 {len(batch)} 条，过滤后 {len(filtered_batch)} 条，去重后 {len(unique_filtered_batch)} 条")

                # 增量保存到缓存（每批都保存，避免数据丢失）
                if use_cache and unique_filtered_batch:
                    try:
                        cache_manager.save_activities(
                            user, unique_filtered_batch)
                        logger.debug(
                            f"已保存 {len(unique_filtered_batch)} 条记录到缓存")
                    except Exception as e:
                        logger.warning(f"保存缓存失败: {str(e)}")

                # 如果过滤后的数据少于原始数据，说明已经遇到3个月前的数据，停止获取
                if len(filtered_batch) < len(batch):
                    logger.info("已遇到3个月前的数据，停止获取")
                    break

                # 如果设置了最大记录数限制
                if max_records and len(all_activities) >= max_records:
                    all_activities = all_activities[:max_records]
                    logger.info(f"达到最大记录数限制 {max_records}")
                    break

                # 更新偏移量，准备获取下一批
                offset += batch_size

                # 安全限制：防止无限循环（API 限制 offset 最大 10000）
                if offset > 10000:
                    logger.warning("达到 offset 上限 10000，停止获取")
                    break

                # 注意：只有当返回空数组时才停止，不要因为返回数据少于 batch_size 就停止
                # 因为 API 可能在某些 offset 返回的数据少于 limit，但后续 offset 还有数据

            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"获取数据时出错: {str(e)}", exc_info=True)
                raise HTTPException(
                    status_code=500,
                    detail=f"获取数据时出错: {str(e)}"
                )

    logger.info(f"最终获取 {len(all_activities)} 条记录")

    # 合并 API 数据和缓存数据（无论是否使用缓存，都合并以确保数据完整）
    if cached_data and len(cached_data) > 0:
        logger.info(
            f"合并缓存数据（{len(cached_data)} 条）和 API 数据（{len(all_activities)} 条）")

        # 计算3个月前的时间戳（秒级）
        three_months_ago = datetime.now() - timedelta(days=90)
        three_months_ago_timestamp = int(three_months_ago.timestamp())

        # 使用 transactionHash + conditionId 作为唯一标识去重
        seen = set()
        merged_data = []
        api_added_count = 0
        cache_added_count = 0
        api_duplicate_count = 0
        cache_filtered_count = 0

        # 先添加 API 获取的数据（已经过滤过3个月）
        for item in all_activities:
            key = (item.get('transactionHash', ''),
                   item.get('conditionId', ''))
            if key not in seen:
                seen.add(key)
                merged_data.append(item)
                api_added_count += 1
            else:
                api_duplicate_count += 1

        logger.info(
            f"API 数据：添加 {api_added_count} 条，重复 {api_duplicate_count} 条")

        # 再添加缓存中不在 API 数据中的记录，同时过滤掉3个月前的数据
        for item in cached_data:
            timestamp = item.get('timestamp', 0)
            # 如果时间戳是毫秒级，转换为秒级
            if timestamp > 1e10:
                timestamp = timestamp // 1000

            # 只添加近3个月的数据
            if timestamp >= three_months_ago_timestamp:
                key = (item.get('transactionHash', ''),
                       item.get('conditionId', ''))
                if key not in seen:
                    seen.add(key)
                    merged_data.append(item)
                    cache_added_count += 1
            else:
                cache_filtered_count += 1

        logger.info(
            f"缓存数据：添加 {cache_added_count} 条，过滤（超过3个月）{cache_filtered_count} 条")

        # 按时间戳排序
        merged_data.sort(
            key=lambda x: x.get('timestamp', 0),
            reverse=(sort_direction == "DESC")
        )

        logger.info(
            f"合并后共有 {len(merged_data)} 条记录（API: {api_added_count}, 缓存: {cache_added_count}）")

        # 缓存已经在循环中增量保存了，这里不需要再次保存
        # 但为了确保数据完整性，可以再次保存一次（去重后不会重复）
        if all_activities:
            try:
                cache_manager.save_activities(user, all_activities)
                logger.debug("已更新完整缓存")
            except Exception as e:
                logger.warning(f"更新缓存失败: {str(e)}")

        # 应用最大记录数限制
        if max_records:
            merged_data = merged_data[:max_records]

        return merged_data

    # 如果没有缓存或缓存为空，直接返回 API 数据
    # 缓存已经在循环中增量保存了
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
    exclude_deposits_withdrawals: bool = Query(
        True, description="是否排除存款和提现记录（默认True）")
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
                batch_size=500,  # 每次获取500条记录
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
        logger.error(f"获取用户活动失败: {str(e)}", exc_info=True)
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
    batch_size: int = Query(
        500, ge=1, le=500, description="每批获取的记录数（1-500，默认500）"),
    max_records: Optional[int] = Query(
        None, ge=1, description="最大获取记录数（None表示获取所有）"),
    use_cache: bool = Query(True, description="是否使用缓存（默认True）"),
    exclude_deposits_withdrawals: bool = Query(
        True, description="是否排除存款和提现记录（默认True）")
):
    """
    获取用户所有历史活动记录

    此端点会自动循环分页获取所有历史记录，直到获取完所有数据或达到限制。

    - **user**: 用户钱包地址（必需）
    - **sort_by**: 排序字段（默认TIMESTAMP）
    - **sort_direction**: 排序方向，ASC 或 DESC（默认DESC）
    - **batch_size**: 每批获取的记录数（默认500，最大500）
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
        logger.error(f"获取用户活动失败: {str(e)}", exc_info=True)
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
