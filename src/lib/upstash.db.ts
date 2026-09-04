/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { Redis } from '@upstash/redis';

import { AdminConfig } from './admin.types';
import { hashPassword, isHashed, verifyPassword } from './password';
import {
  ContentStat,
  Favorite,
  IStorage,
  PlayRecord,
  SkipConfig,
  UserPlayStat,
} from './types';

// 搜索历史最大条数
const SEARCH_HISTORY_LIMIT = 20;

// 数据类型转换辅助函数
function ensureString(value: any): string {
  return String(value);
}

function ensureStringArray(value: any[]): string[] {
  return value.map((item) => String(item));
}

// 添加Upstash Redis操作重试包装器
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (err: any) {
      const isLastAttempt = i === maxRetries - 1;
      const isConnectionError =
        err.message?.includes('Connection') ||
        err.message?.includes('ECONNREFUSED') ||
        err.message?.includes('ENOTFOUND') ||
        err.code === 'ECONNRESET' ||
        err.code === 'EPIPE' ||
        err.name === 'UpstashError';

      if (isConnectionError && !isLastAttempt) {
        console.log(
          `Upstash Redis operation failed, retrying... (${i + 1}/${maxRetries})`
        );
        console.error('Error:', err.message);

        // 等待一段时间后重试
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }

      throw err;
    }
  }

  throw new Error('Max retries exceeded');
}

export class UpstashRedisStorage implements IStorage {
  private client: Redis;

  constructor() {
    this.client = getUpstashRedisClient();
  }

  // ---------- 播放记录 ----------
  private prHashKey(user: string) {
    return `u:${user}:pr`; // 一个用户的所有播放记录存在一个 Hash 中
  }

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const val = await withRetry(() =>
      this.client.hget(this.prHashKey(userName), key)
    );
    return val ? (val as PlayRecord) : null;
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    await withRetry(() =>
      this.client.hset(this.prHashKey(userName), { [key]: record })
    );
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    const all = await withRetry(() =>
      this.client.hgetall(this.prHashKey(userName))
    );
    if (!all || Object.keys(all).length === 0) return {};
    const result: Record<string, PlayRecord> = {};
    for (const [field, value] of Object.entries(all)) {
      if (value) {
        result[field] = value as PlayRecord;
      }
    }
    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await withRetry(() => this.client.hdel(this.prHashKey(userName), key));
  }

  async deleteAllPlayRecords(userName: string): Promise<void> {
    await withRetry(() => this.client.del(this.prHashKey(userName)));
  }

  // ---------- 收藏 ----------
  private favHashKey(user: string) {
    return `u:${user}:fav`; // 一个用户的所有收藏存在一个 Hash 中
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const val = await withRetry(() =>
      this.client.hget(this.favHashKey(userName), key)
    );
    return val ? (val as Favorite) : null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await withRetry(() =>
      this.client.hset(this.favHashKey(userName), { [key]: favorite })
    );
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const all = await withRetry(() =>
      this.client.hgetall(this.favHashKey(userName))
    );
    if (!all || Object.keys(all).length === 0) return {};
    const result: Record<string, Favorite> = {};
    for (const [field, value] of Object.entries(all)) {
      if (value) {
        result[field] = value as Favorite;
      }
    }
    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await withRetry(() => this.client.hdel(this.favHashKey(userName), key));
  }

  async deleteAllFavorites(userName: string): Promise<void> {
    await withRetry(() => this.client.del(this.favHashKey(userName)));
  }

  // ---------- 用户注册 / 登录 ----------
  private userPwdKey(user: string) {
    return `u:${user}:pwd`;
  }

  async registerUser(userName: string, password: string): Promise<void> {
    const hashed = hashPassword(password);
    await withRetry(() => this.client.set(this.userPwdKey(userName), hashed));
    // 维护用户集合
    await withRetry(() => this.client.sadd(this.usersSetKey(), userName));
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const stored = await withRetry(() =>
      this.client.get(this.userPwdKey(userName))
    );
    if (stored === null) return false;
    const storedStr = ensureString(stored as any);
    const ok = verifyPassword(password, storedStr);
    // 平滑迁移：如果是明文密码且验证通过，自动升级为加盐哈希
    if (ok && !isHashed(storedStr)) {
      const hashed = hashPassword(password);
      await withRetry(() => this.client.set(this.userPwdKey(userName), hashed));
    }
    return ok;
  }

  // 检查用户是否存在
  async checkUserExist(userName: string): Promise<boolean> {
    // 使用 EXISTS 判断 key 是否存在
    const exists = await withRetry(() =>
      this.client.exists(this.userPwdKey(userName))
    );
    return exists === 1;
  }

  // 修改用户密码
  async changePassword(userName: string, newPassword: string): Promise<void> {
    const hashed = hashPassword(newPassword);
    await withRetry(() => this.client.set(this.userPwdKey(userName), hashed));
  }

  // 删除用户及其所有数据
  async deleteUser(userName: string): Promise<void> {
    // 删除用户密码
    await withRetry(() => this.client.del(this.userPwdKey(userName)));

    // 从用户集合中移除
    await withRetry(() => this.client.srem(this.usersSetKey(), userName));

    // 删除搜索历史
    await withRetry(() => this.client.del(this.shKey(userName)));

    // 删除播放记录（Hash key 直接删除）
    await withRetry(() => this.client.del(this.prHashKey(userName)));

    // 删除收藏夹（Hash key 直接删除）
    await withRetry(() => this.client.del(this.favHashKey(userName)));

    // 删除跳过片头片尾配置（Hash key 直接删除）
    await withRetry(() => this.client.del(this.skipHashKey(userName)));
  }

  // ---------- 搜索历史 ----------
  private shKey(user: string) {
    return `u:${user}:sh`; // u:username:sh
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const result = await withRetry(() =>
      this.client.lrange(this.shKey(userName), 0, -1)
    );
    // 确保返回的都是字符串类型
    return ensureStringArray(result as any[]);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = this.shKey(userName);
    // 先去重
    await withRetry(() => this.client.lrem(key, 0, ensureString(keyword)));
    // 插入到最前
    await withRetry(() => this.client.lpush(key, ensureString(keyword)));
    // 限制最大长度
    await withRetry(() => this.client.ltrim(key, 0, SEARCH_HISTORY_LIMIT - 1));
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = this.shKey(userName);
    if (keyword) {
      await withRetry(() => this.client.lrem(key, 0, ensureString(keyword)));
    } else {
      await withRetry(() => this.client.del(key));
    }
  }

  // ---------- 获取全部用户 ----------
  private usersSetKey() {
    return 'sys:users';
  }

  async getAllUsers(): Promise<string[]> {
    const members = await withRetry(() =>
      this.client.smembers(this.usersSetKey())
    );
    return ensureStringArray(members as any[]);
  }

  async touchOnlineSession(
    userName: string,
    sessionId: string,
    timestamp: number
  ): Promise<void> {
    const member = `${encodeURIComponent(userName)}:${sessionId}`;
    await withRetry(() =>
      this.client.zadd('sys:online:sessions', { score: timestamp, member })
    );
  }

  async getOnlineUserCount(since: number): Promise<number> {
    const key = 'sys:online:sessions';
    await withRetry(() => this.client.zremrangebyscore(key, 0, since - 1));
    const sessions = (await withRetry(() =>
      this.client.zrange(key, since, '+inf', { byScore: true })
    )) as string[];
    return new Set(
      sessions.map((session) => decodeURIComponent(session.split(':', 1)[0]))
    ).size;
  }

  // ---------- 管理员配置 ----------
  private adminConfigKey() {
    return 'admin:config';
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const val = await withRetry(() => this.client.get(this.adminConfigKey()));
    return val ? (val as AdminConfig) : null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await withRetry(() => this.client.set(this.adminConfigKey(), config));
  }

  // ---------- 跳过片头片尾配置 ----------
  private skipHashKey(user: string) {
    return `u:${user}:skip`; // 一个用户的所有跳过配置存在一个 Hash 中
  }

  private skipField(source: string, id: string) {
    return `${source}+${id}`;
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    const val = await withRetry(() =>
      this.client.hget(this.skipHashKey(userName), this.skipField(source, id))
    );
    return val ? (val as SkipConfig) : null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    await withRetry(() =>
      this.client.hset(this.skipHashKey(userName), {
        [this.skipField(source, id)]: config,
      })
    );
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    await withRetry(() =>
      this.client.hdel(this.skipHashKey(userName), this.skipField(source, id))
    );
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    const all = await withRetry(() =>
      this.client.hgetall(this.skipHashKey(userName))
    );
    if (!all || Object.keys(all).length === 0) return {};
    const configs: { [key: string]: SkipConfig } = {};
    for (const [field, value] of Object.entries(all)) {
      if (value) {
        configs[field] = value as SkipConfig;
      }
    }
    return configs;
  }

  // ---------- 数据迁移：旧扁平 key → Hash 结构 ----------
  private migrationKey() {
    return 'sys:migration:hash_v2';
  }

  async migrateData(): Promise<void> {
    // 检查是否已迁移
    const migrated = await withRetry(() =>
      this.client.get(this.migrationKey())
    );
    if (migrated === 'done') return;

    console.log('开始数据迁移：扁平 key → Hash 结构...');

    try {
      // 迁移播放记录：u:*:pr:* → u:username:pr (Hash)
      const prKeys: string[] = await withRetry(() =>
        this.client.keys('u:*:pr:*')
      );
      if (prKeys.length > 0) {
        const oldPrKeys = prKeys.filter((k) => {
          const parts = k.split(':');
          return parts.length >= 4 && parts[2] === 'pr' && parts[3] !== '';
        });

        for (const oldKey of oldPrKeys) {
          const match = oldKey.match(/^u:(.+?):pr:(.+)$/);
          if (!match) continue;
          const [, userName, field] = match;
          const value = await withRetry(() => this.client.get(oldKey));
          if (value) {
            await withRetry(() =>
              this.client.hset(this.prHashKey(userName), { [field]: value })
            );
            await withRetry(() => this.client.del(oldKey));
          }
        }
        if (oldPrKeys.length > 0) {
          console.log(`迁移了 ${oldPrKeys.length} 条播放记录`);
        }
      }

      // 迁移收藏：u:*:fav:* → u:username:fav (Hash)
      const favKeys: string[] = await withRetry(() =>
        this.client.keys('u:*:fav:*')
      );
      if (favKeys.length > 0) {
        const oldFavKeys = favKeys.filter((k) => {
          const parts = k.split(':');
          return parts.length >= 4 && parts[2] === 'fav' && parts[3] !== '';
        });

        for (const oldKey of oldFavKeys) {
          const match = oldKey.match(/^u:(.+?):fav:(.+)$/);
          if (!match) continue;
          const [, userName, field] = match;
          const value = await withRetry(() => this.client.get(oldKey));
          if (value) {
            await withRetry(() =>
              this.client.hset(this.favHashKey(userName), { [field]: value })
            );
            await withRetry(() => this.client.del(oldKey));
          }
        }
        if (oldFavKeys.length > 0) {
          console.log(`迁移了 ${oldFavKeys.length} 条收藏`);
        }
      }

      // 迁移 skipConfig：u:*:skip:* → u:username:skip (Hash)
      const skipKeys: string[] = await withRetry(() =>
        this.client.keys('u:*:skip:*')
      );
      if (skipKeys.length > 0) {
        const oldSkipKeys = skipKeys.filter((k) => {
          const parts = k.split(':');
          return parts.length >= 4 && parts[2] === 'skip' && parts[3] !== '';
        });

        for (const oldKey of oldSkipKeys) {
          const match = oldKey.match(/^u:(.+?):skip:(.+)$/);
          if (!match) continue;
          const [, userName, field] = match;
          const value = await withRetry(() => this.client.get(oldKey));
          if (value) {
            await withRetry(() =>
              this.client.hset(this.skipHashKey(userName), { [field]: value })
            );
            await withRetry(() => this.client.del(oldKey));
          }
        }
        if (oldSkipKeys.length > 0) {
          console.log(`迁移了 ${oldSkipKeys.length} 条跳过配置`);
        }
      }

      // 迁移用户列表：从 KEYS u:*:pwd 构建 sys:users Set
      const userSetExists = await withRetry(() =>
        this.client.exists(this.usersSetKey())
      );
      if (!userSetExists) {
        const pwdKeys: string[] = await withRetry(() =>
          this.client.keys('u:*:pwd')
        );
        const userNames = pwdKeys
          .map((k) => {
            const match = k.match(/^u:(.+?):pwd$/);
            return match ? match[1] : undefined;
          })
          .filter((u): u is string => typeof u === 'string');
        if (userNames.length > 0) {
          await withRetry(() =>
            this.client.sadd(this.usersSetKey(), userNames)
          );
          console.log(`迁移了 ${userNames.length} 个用户到 Set`);
        }
      }

      // 标记迁移完成
      await withRetry(() => this.client.set(this.migrationKey(), 'done'));
      console.log('数据迁移完成');
    } catch (error) {
      console.error('数据迁移失败:', error);
    }
  }

  // ---------- 密码迁移：明文 → 加盐哈希 ----------
  private pwdMigrationKey() {
    return 'sys:migration:pwd_hash_v1';
  }

  async migratePasswords(): Promise<void> {
    const migrated = await withRetry(() =>
      this.client.get(this.pwdMigrationKey())
    );
    if (migrated === 'done') return;

    console.log('开始密码迁移：明文 → 加盐哈希...');

    try {
      const pwdKeys: string[] = await withRetry(() =>
        this.client.keys('u:*:pwd')
      );
      let count = 0;

      for (const key of pwdKeys) {
        const stored = await withRetry(() => this.client.get(key));
        if (stored === null) continue;
        const storedStr = ensureString(stored as any);
        // 跳过已经是哈希格式的
        if (isHashed(storedStr)) continue;
        // 将明文密码转为加盐哈希
        const hashed = hashPassword(storedStr);
        await withRetry(() => this.client.set(key, hashed));
        count++;
      }

      await withRetry(() => this.client.set(this.pwdMigrationKey(), 'done'));
      console.log(`密码迁移完成，共迁移 ${count} 个用户`);
    } catch (error) {
      console.error('密码迁移失败:', error);
    }
  }

  // 清空所有数据
  async clearAllData(): Promise<void> {
    try {
      // 获取所有用户
      const allUsers = await this.getAllUsers();

      // 删除所有用户及其数据
      for (const username of allUsers) {
        await this.deleteUser(username);
      }

      // 删除管理员配置
      await withRetry(() => this.client.del(this.adminConfigKey()));

      console.log('所有数据已清空');
    } catch (error) {
      console.error('清空数据失败:', error);
      throw new Error('清空数据失败');
    }
  }
}

// 单例 Upstash Redis 客户端
function getUpstashRedisClient(): Redis {
  const globalKey = Symbol.for('__MOONTV_UPSTASH_REDIS_CLIENT__');
  let client: Redis | undefined = (global as any)[globalKey];

  if (!client) {
    const upstashUrl = process.env.UPSTASH_URL;
    const upstashToken = process.env.UPSTASH_TOKEN;

    if (!upstashUrl || !upstashToken) {
      throw new Error(
        'UPSTASH_URL and UPSTASH_TOKEN env variables must be set'
      );
    }

    // 创建 Upstash Redis 客户端
    client = new Redis({
      url: upstashUrl,
      token: upstashToken,
      // 可选配置
      retry: {
        retries: 3,
        backoff: (retryCount: number) =>
          Math.min(1000 * Math.pow(2, retryCount), 30000),
      },
    });

    console.log('Upstash Redis client created successfully');

    (global as any)[globalKey] = client;
  }

  return client;
}

// Upstash 存储的播放统计扩展（附加到 UpstashRedisStorage 原型上）
/* eslint-disable @typescript-eslint/no-explicit-any */
const UpstashStatsExt = {
  async readLoginStats(userName: string): Promise<{
    loginCount: number;
    firstLoginTime: number;
    lastLoginTime: number;
    lastLoginDate: number;
  }> {
    const self = this as any;
    try {
      const storedLoginStats = await withRetry(() =>
        self.client.get(`user_login_stats:${userName}`)
      );
      if (storedLoginStats) {
        const parsed =
          typeof storedLoginStats === 'string'
            ? JSON.parse(storedLoginStats)
            : storedLoginStats;
        return {
          loginCount: parsed.loginCount || 0,
          firstLoginTime: parsed.firstLoginTime || 0,
          lastLoginTime: parsed.lastLoginTime || 0,
          lastLoginDate: parsed.lastLoginDate || parsed.lastLoginTime || 0,
        };
      }
    } catch (error) {
      console.error(`获取用户 ${userName} 登入统计失败:`, error);
    }
    return {
      loginCount: 0,
      firstLoginTime: 0,
      lastLoginTime: 0,
      lastLoginDate: 0,
    };
  },

  async getUserPlayStat(userName: string): Promise<UserPlayStat> {
    const self = this as any;
    try {
      const playRecords = await self.getAllPlayRecords(userName);
      const records = Object.values(playRecords) as PlayRecord[];

      const loginStats = await UpstashStatsExt.readLoginStats.call(
        this,
        userName
      );

      if (records.length === 0) {
        return {
          username: userName,
          totalWatchTime: 0,
          totalPlays: 0,
          lastPlayTime: 0,
          recentRecords: [],
          avgWatchTime: 0,
          mostWatchedSource: '',
          totalMovies: 0,
          firstWatchDate: Date.now(),
          lastUpdateTime: Date.now(),
          loginCount: loginStats.loginCount,
          firstLoginTime: loginStats.firstLoginTime,
          lastLoginTime: loginStats.lastLoginTime,
          lastLoginDate: loginStats.lastLoginDate,
        };
      }

      const totalWatchTime = records.reduce(
        (sum, record) => sum + (record.play_time || 0),
        0
      );
      const totalPlays = records.length;
      const lastPlayTime = Math.max(...records.map((r) => r.save_time || 0));
      const totalMovies = new Set(
        records.map((r) => `${r.title}_${r.source_name}_${r.year}`)
      ).size;
      const firstWatchDate = Math.min(
        ...records.map((r) => r.save_time || Date.now())
      );
      const recentRecords = [...records]
        .sort((a, b) => (b.save_time || 0) - (a.save_time || 0))
        .slice(0, 10);
      const avgWatchTime = totalPlays > 0 ? totalWatchTime / totalPlays : 0;

      const sourceMap = new Map<string, number>();
      records.forEach((record) => {
        const sourceName = record.source_name || '未知来源';
        sourceMap.set(sourceName, (sourceMap.get(sourceName) || 0) + 1);
      });
      const mostWatchedSource =
        sourceMap.size > 0
          ? Array.from(sourceMap.entries()).reduce((a, b) =>
              a[1] > b[1] ? a : b
            )[0]
          : '';

      return {
        username: userName,
        totalWatchTime,
        totalPlays,
        lastPlayTime,
        recentRecords,
        avgWatchTime,
        mostWatchedSource,
        totalMovies,
        firstWatchDate,
        lastUpdateTime: Date.now(),
        loginCount: loginStats.loginCount,
        firstLoginTime: loginStats.firstLoginTime,
        lastLoginTime: loginStats.lastLoginTime,
        lastLoginDate: loginStats.lastLoginDate,
      };
    } catch (error) {
      console.error(`获取用户 ${userName} 播放统计失败:`, error);
      return {
        username: userName,
        totalWatchTime: 0,
        totalPlays: 0,
        lastPlayTime: 0,
        recentRecords: [],
        avgWatchTime: 0,
        mostWatchedSource: '',
      };
    }
  },

  async getContentStats(limit = 10): Promise<ContentStat[]> {
    const self = this as any;
    try {
      const allUsers = await self.getAllUsers();
      const contentMap = new Map<
        string,
        {
          record: PlayRecord;
          playCount: number;
          totalWatchTime: number;
          users: Set<string>;
        }
      >();

      for (const username of allUsers) {
        const playRecords = await self.getAllPlayRecords(username);
        Object.entries(playRecords as Record<string, PlayRecord>).forEach(
          ([key, record]) => {
            if (!contentMap.has(key)) {
              contentMap.set(key, {
                record,
                playCount: 0,
                totalWatchTime: 0,
                users: new Set(),
              });
            }
            const content = contentMap.get(key)!;
            content.playCount++;
            content.totalWatchTime += record.play_time || 0;
            content.users.add(username);
          }
        );
      }

      return Array.from(contentMap.entries())
        .map(([key, data]) => {
          const [source, id] = key.split('+');
          return {
            source,
            id,
            title: data.record.title,
            source_name: data.record.source_name,
            cover: data.record.cover,
            year: data.record.year,
            playCount: data.playCount,
            totalWatchTime: data.totalWatchTime,
            averageWatchTime:
              data.playCount > 0 ? data.totalWatchTime / data.playCount : 0,
            lastPlayed: data.record.save_time,
            uniqueUsers: data.users.size,
          };
        })
        .sort((a, b) => b.playCount - a.playCount)
        .slice(0, limit);
    } catch (error) {
      console.error('获取内容统计失败:', error);
      return [];
    }
  },

  async updatePlayStatistics(
    _userName: string,
    _source: string,
    _id: string,
    _watchTime: number
  ): Promise<void> {
    const self = this as any;
    try {
      await withRetry(() => self.client.del('play_stats_summary'));
    } catch (error) {
      console.error('更新播放统计失败:', error);
    }
  },

  async updateUserLoginStats(
    userName: string,
    loginTime: number,
    isFirstLogin?: boolean
  ): Promise<void> {
    const self = this as any;
    try {
      const loginStatsKey = `user_login_stats:${userName}`;
      const currentStats = await withRetry(() =>
        self.client.get(loginStatsKey)
      );
      const loginStats = currentStats
        ? typeof currentStats === 'string'
          ? JSON.parse(currentStats)
          : currentStats
        : {
            loginCount: 0,
            firstLoginTime: null,
            lastLoginTime: null,
            lastLoginDate: null,
          };

      loginStats.loginCount = (loginStats.loginCount || 0) + 1;
      loginStats.lastLoginTime = loginTime;
      loginStats.lastLoginDate = loginTime;
      if (isFirstLogin || !loginStats.firstLoginTime) {
        loginStats.firstLoginTime = loginTime;
      }

      await withRetry(() =>
        self.client.set(loginStatsKey, JSON.stringify(loginStats))
      );
      console.log(`用户 ${userName} 登入统计已更新`);
    } catch (error) {
      console.error(`更新用户 ${userName} 登入统计失败:`, error);
      throw error;
    }
  },
};

// 将统计方法混入 UpstashRedisStorage
for (const [methodName, methodFn] of Object.entries(UpstashStatsExt)) {
  const proto = UpstashRedisStorage.prototype as any;
  if (!proto[methodName]) {
    proto[methodName] = methodFn;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
