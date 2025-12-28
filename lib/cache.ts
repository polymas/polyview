import Database from 'better-sqlite3';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';

// Vercel 使用 /tmp 目录，因为文件系统是只读的（除了 /tmp）
const isVercel = process.env.VERCEL === '1';
const DB_FILE = process.env.DB_FILE || (
  isVercel 
    ? path.join('/tmp', 'polymarket_cache.db')
    : path.join(process.cwd(), 'polymarket_cache.db')
);

// 确保数据库目录存在
const dbDir = path.dirname(DB_FILE);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

let db: Database.Database | null = null;

function getDatabase(): Database.Database {
  if (!db) {
    db = new Database(DB_FILE);
    initDatabase(db);
  }
  return db;
}

function initDatabase(database: Database.Database) {
  database.exec(`
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
    );

    CREATE INDEX IF NOT EXISTS idx_user_timestamp 
    ON user_activities(user_address, timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_user_condition 
    ON user_activities(user_address, condition_id);
  `);
}

export class CacheManager {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
  }

  getCachedActivities(
    user: string,
    limit?: number | null,
    offset: number = 0,
    sortBy: string = 'TIMESTAMP',
    sortDirection: string = 'DESC'
  ): any[] {
    const orderBy = `timestamp ${sortDirection}`;
    const limitValue = limit ?? 999999;
    
    const query = `
      SELECT activity_data 
      FROM user_activities 
      WHERE user_address = ?
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;

    const results = this.db.prepare(query).all(user.toLowerCase(), limitValue, offset) as Array<{ activity_data: string }>;
    
    const activities: any[] = [];
    for (const row of results) {
      try {
        activities.push(JSON.parse(row.activity_data));
      } catch (e) {
        // 忽略解析错误
      }
    }

    return activities;
  }

  saveActivities(user: string, activities: any[]): void {
    if (!activities || activities.length === 0) return;

    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO user_activities 
      (user_address, transaction_hash, timestamp, condition_id, activity_data, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const insertMany = this.db.transaction((activities: any[]) => {
      for (const activity of activities) {
        try {
          insert.run(
            user.toLowerCase(),
            activity.transactionHash || '',
            activity.timestamp || 0,
            activity.conditionId || '',
            JSON.stringify(activity)
          );
        } catch (e) {
          // 保存活动数据时出错，忽略错误
        }
      }
    });

    insertMany(activities);
    
    // 自动清理半年前的旧数据
    this.autoCleanOldData();
  }

  getAllCachedActivities(
    user: string,
    sortBy: string = 'TIMESTAMP',
    sortDirection: string = 'DESC'
  ): any[] {
    return this.getCachedActivities(user, null, 0, sortBy, sortDirection);
  }

  clearUserCache(user: string): void {
    this.db.prepare('DELETE FROM user_activities WHERE user_address = ?').run(user.toLowerCase());
  }

  getCacheStats(user?: string): any {
    let result: any;
    
    if (user) {
      result = this.db.prepare(`
        SELECT 
          COUNT(*) as total_count,
          MIN(timestamp) as oldest_timestamp,
          MAX(timestamp) as newest_timestamp,
          MAX(updated_at) as last_updated
        FROM user_activities 
        WHERE user_address = ?
      `).get(user.toLowerCase()) as any;
    } else {
      result = this.db.prepare(`
        SELECT 
          COUNT(*) as total_count,
          COUNT(DISTINCT user_address) as user_count,
          MIN(timestamp) as oldest_timestamp,
          MAX(timestamp) as newest_timestamp
        FROM user_activities
      `).get() as any;
    }

    return result || {};
  }

  /**
   * 清理半年前（180天）的旧数据
   * @returns 删除的记录数
   */
  cleanOldData(days: number = 180): number {
    const cutoffTimestamp = Math.floor((Date.now() / 1000) - days * 24 * 60 * 60);
    const result = this.db.prepare(`
      DELETE FROM user_activities 
      WHERE timestamp < ?
    `).run(cutoffTimestamp);
    
    return result.changes || 0;
  }

  /**
   * 自动清理旧数据（在保存新数据时调用，避免频繁清理）
   */
  autoCleanOldData(): void {
    // 每次保存时，有 1% 的概率触发清理（避免频繁清理影响性能）
    if (Math.random() < 0.01) {
      this.cleanOldData(180);
    }
  }
}

export const cacheManager = new CacheManager();

