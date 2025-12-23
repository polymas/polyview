#!/usr/bin/env python3
"""
检查 API 返回数据的重复情况
拉取数据并标记重复，保存到 TSV 文件
"""

import csv
import json
from datetime import datetime
from collections import defaultdict
import urllib.request
import urllib.parse
import time

# 使用与 activity.py 相同的逻辑
BASE_URL = "https://data-api.polymarket.com"

def fetch_activities_with_offset(user: str, limit: int = 500, offset: int = 0):
    """获取活动数据（带 offset 信息）"""
    params = {
        "user": user,
        "limit": limit,
        "offset": offset,
        "sortBy": "TIMESTAMP",
        "sortDirection": "DESC",
        "excludeDepositsWithdrawals": "true"
    }
    
    url = f"{BASE_URL}/v1/activity?" + urllib.parse.urlencode(params)
    
    # 添加 headers（模拟浏览器请求）
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json",
    }
    
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.loads(response.read().decode())
            return data
    except urllib.error.HTTPError as e:
        if e.code == 429:
            print(f"Rate limited at offset={offset}, waiting 5 seconds...")
            time.sleep(5)
            return fetch_activities_with_offset(user, limit, offset)
        else:
            print(f"HTTP Error {e.code} at offset={offset}: {e.reason}")
            return []
    except Exception as e:
        print(f"Error at offset={offset}: {e}")
        return []

def check_duplicates(user: str):
    """检查重复数据并保存到 TSV"""
    print("正在直接从 API 获取数据以记录 offset 信息...")
    all_activities = []
    offset = 0
    batch_size = 500
    
    while len(all_activities) < 15000:
        print(f"获取 offset={offset} 的数据...")
        batch = fetch_activities_with_offset(user, limit=batch_size, offset=offset)
        
        if not batch or len(batch) == 0:
            print(f"offset={offset} 时没有更多数据")
            break
        
        for item in batch:
            item['_offset'] = offset
            item['_batch_index'] = len(all_activities)
            all_activities.append(item)
        
        print(f"offset={offset}: 获取了 {len(batch)} 条，累计 {len(all_activities)} 条")
        
        offset += batch_size
        if offset > 15000:
            print("达到 offset 上限")
            break
        
        # 避免请求过快
        time.sleep(0.5)
    
    if not all_activities:
        print("没有获取到数据")
        return
    
    print(f"\n总共获取 {len(all_activities)} 条数据（带 offset 信息）")
    
    # 分析重复
    key_to_items = defaultdict(list)
    
    for idx, item in enumerate(all_activities):
        transaction_hash = item.get('transactionHash', '')
        timestamp = item.get('timestamp', 0)
        key = (transaction_hash, timestamp)
        
        key_to_items[key].append({
            'index': idx,
            'item': item,
            'offset': item.get('_offset', 0)
        })
    
    # 标记重复
    results = []
    
    for idx, item in enumerate(all_activities):
        transaction_hash = item.get('transactionHash', '')
        timestamp = item.get('timestamp', 0)
        key = (transaction_hash, timestamp)
        
        # 检查是否重复
        items_with_same_key = key_to_items[key]
        is_duplicate = len(items_with_same_key) > 1
        
        # 找到第一次出现的位置和 offset
        first_occurrence = items_with_same_key[0]
        first_occurrence_idx = first_occurrence['index']
        first_occurrence_offset = first_occurrence['offset']
        is_first_occurrence = idx == first_occurrence_idx
        
        current_offset = item.get('_offset', 0)
        batch_number = current_offset // batch_size
        
        # 标记重复信息
        duplicate_marker = ""
        duplicate_with = ""
        if is_duplicate:
            if is_first_occurrence:
                duplicate_marker = f"原始（重复{len(items_with_same_key)}次）"
            else:
                duplicate_marker = f"重复（与第{first_occurrence_idx+1}条重复，首次出现在offset={first_occurrence_offset}）"
                duplicate_with = f"第{first_occurrence_idx+1}条"
        
        # 准备数据
        row = {
            '序号': idx + 1,
            '是否重复': '是' if is_duplicate else '否',
            '重复标记': duplicate_marker,
            '与哪条重复': duplicate_with,
            '重复次数': len(items_with_same_key) if is_duplicate else '',
            '当前offset': current_offset,
            '批次号': batch_number,
            '首次出现offset': first_occurrence_offset if is_duplicate else '',
            '首次出现批次': first_occurrence_offset // batch_size if is_duplicate else '',
            'transactionHash': transaction_hash,
            'timestamp': timestamp,
            'conditionId': item.get('conditionId', ''),
            'type': item.get('type', ''),
            'size': item.get('size', ''),
            'usdcSize': item.get('usdcSize', ''),
            'price': item.get('price', ''),
            'side': item.get('side', ''),
            'outcome': item.get('outcome', ''),
            'outcomeIndex': item.get('outcomeIndex', ''),
            'asset': item.get('asset', ''),
            'title': item.get('title', ''),
            '时间': datetime.fromtimestamp(timestamp).strftime('%Y-%m-%d %H:%M:%S') if timestamp and timestamp > 0 else '',
        }
        
        results.append(row)
    
    # 保存到 TSV
    output_file = f"duplicate_check_{user[:10]}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.tsv"
    
    if results:
        fieldnames = [
            '序号', '是否重复', '重复标记', '与哪条重复', '重复次数',
            '当前offset', '批次号', '首次出现offset', '首次出现批次',
            'transactionHash', 'timestamp', 'conditionId', 'type', 'size', 
            'usdcSize', 'price', 'side', 'outcome', 'outcomeIndex', 'asset', 'title', '时间'
        ]
        
        with open(output_file, 'w', encoding='utf-8', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter='\t')
            writer.writeheader()
            writer.writerows(results)
        
        print(f"\n数据已保存到: {output_file}")
        print(f"总记录数: {len(results)}")
        
        # 统计重复情况
        duplicate_count = sum(1 for r in results if r['是否重复'] == '是')
        unique_count = len(results) - duplicate_count
        
        print(f"唯一记录: {unique_count} 条")
        print(f"重复记录: {duplicate_count} 条")
        
        # 统计重复最多的记录
        duplicate_stats = defaultdict(int)
        for r in results:
            if r['重复次数']:
                duplicate_stats[r['重复次数']] += 1
        
        if duplicate_stats:
            print("\n重复次数统计:")
            for count, num in sorted(duplicate_stats.items(), reverse=True)[:10]:
                print(f"  重复{count}次: {num} 条记录")
        
        # 显示一些重复示例
        print("\n重复记录示例（前10条）:")
        count = 0
        for r in results:
            if r['是否重复'] == '是' and r['重复标记'].startswith('重复'):
                print(f"  第{r['序号']}条 (offset={r['当前offset']}): {r['transactionHash'][:20]}... timestamp={r['timestamp']} {r['重复标记']}")
                count += 1
                if count >= 10:
                    break
        
        # 统计哪些 offset 返回了重复数据
        offset_duplicates = defaultdict(int)
        for r in results:
            if r['是否重复'] == '是' and r['重复标记'].startswith('重复'):
                offset_duplicates[r['当前offset']] += 1
        
        if offset_duplicates:
            print("\n哪些 offset 返回了重复数据（前10个）:")
            for offset_val, count in sorted(offset_duplicates.items(), key=lambda x: x[1], reverse=True)[:10]:
                print(f"  offset={offset_val}: {count} 条重复")
    else:
        print("没有数据可保存")

if __name__ == "__main__":
    user = "0x45deaaD70997b2998FBb9433B1819178e34B409C"
    check_duplicates(user)
