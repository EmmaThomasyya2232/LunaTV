/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { createClient, RedisClientType } from 'redis';

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

// 连接配置接口
export interface RedisConnectionConfig {
  url: string;
  clientName: string; // 用于日志显示，如 "Redis" 或 "Pika"
}

// 添加Redis操作重试包装器
function createRetryWrapper(
  clientName: string,
  getClient: () => RedisClientType
) {
  return async function withRetry<T>(
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
          err.code === 'EPIPE';

        if (isConnectionError && !isLastAttempt) {
          console.log(
            `${clientName} operation failed, retrying... (${
              i + 1
            }/${maxRetries})`
          );
          console.error('Error:', err.message);

          // 等待一段时间后重试
          await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));

          // 尝试重新连接
          try {
            const client = getClient();
            if (!client.isOpen) {
              await client.connect();
            }
          } catch (reconnectErr) {
            console.error('Failed to reconnect:', reconnectErr);
          }

          continue;
        }

        throw err;
      }
    }

    throw new Error('Max retries exceeded');
  };
}

// 创建客户端的工厂函数
export function createRedisClient(
  config: RedisConnectionConfig,
  globalSymbol: symbol
): RedisClientType {
  let client: RedisClientType | undefined = (global as any)[globalSymbol];

  if (!client) {
    if (!config.url) {
      throw new Error(`${config.clientName}_URL env variable not set`);
    }

    // 创建客户端配置
    const clientConfig: any = {
      url: config.url,
      socket: {
        // 重连策略：指数退避，最大30秒
        reconnectStrategy: (retries: number) => {
          console.log(
            `${config.clientName} reconnection attempt ${retries + 1}`
          );
          if (retries > 10) {
            console.error(
              `${config.clientName} max reconnection attempts exceeded`
            );
            return false; // 停止重连
          }
          return Math.min(1000 * Math.pow(2, retries), 30000); // 指数退避，最大30秒
        },
        connectTimeout: 10000, // 10秒连接超时
        // 设置no delay，减少延迟
        noDelay: true,
      },
      // 添加其他配置
      pingInterval: 30000, // 30秒ping一次，保持连接活跃
    };

    client = createClient(clientConfig);

    // 添加错误事件监听
    client.on('error', (err) => {
      console.error(`${config.clientName} client error:`, err);
    });

    client.on('connect', () => {
      console.log(`${config.clientName} connected`);
    });

    client.on('reconnecting', () => {
      console.log(`${config.clientName} reconnecting...`);
    });

    client.on('ready', () => {
      console.log(`${config.clientName} ready`);
    });

    // 初始连接，带重试机制
    const connectWithRetry = async () => {
      try {
        await client!.connect();
        console.log(`${config.clientName} connected successfully`);
      } catch (err) {
        console.error(`${config.clientName} initial connection failed:`, err);
        console.log('Will retry in 5 seconds...');
        setTimeout(connectWithRetry, 5000);
      }
    };

    connectWithRetry();

    (global as any)[globalSymbol] = client;
  }

  return client;
}

// 抽象基类，包含所有通用的Redis操作逻辑
export abstract class BaseRedisStorage implements IStorage {
  protected client: RedisClientType;
  protected withRetry: <T>(
    operation: () => Promise<T>,
    maxRetries?: number
  ) => Promise<T>;

  constructor(config: RedisConnectionConfig, globalSymbol: symbol) {
    this.client = createRedisClient(config, globalSymbol);
    this.withRetry = createRetryWrapper(config.clientName, () => this.client);
  }

  // ---------- 播放记录 ----------
  private prHashKey(user: string) {
    return `u:${user}:pr`; // 一个用户的所有播放记录存在一个 Hash 中
  }

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const val = await this.withRetry(() =>
      this.client.hGet(this.prHashKey(userName), key)
    );
    return val ? (JSON.parse(val) as PlayRecord) : null;
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.hSet(this.prHashKey(userName), key, JSON.stringify(record))
    );
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    const all = await this.withRetry(() =>
      this.client.hGetAll(this.prHashKey(userName))
    );
    const result: Record<string, PlayRecord> = {};
    for (const [field, raw] of Object.entries(all)) {
      if (raw) {
        result[field] = JSON.parse(raw) as PlayRecord;
      }
    }
    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await this.withRetry(() => this.client.hDel(this.prHashKey(userName), key));
  }

  async deleteAllPlayRecords(userName: string): Promise<void> {
    await this.withRetry(() => this.client.del(this.prHashKey(userName)));
  }

  // ---------- 收藏 ----------
  private favHashKey(user: string) {
    return `u:${user}:fav`; // 一个用户的所有收藏存在一个 Hash 中
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const val = await this.withRetry(() =>
      this.client.hGet(this.favHashKey(userName), key)
    );
    return val ? (JSON.parse(val) as Favorite) : null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.hSet(this.favHashKey(userName), key, JSON.stringify(favorite))
    );
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const all = await this.withRetry(() =>
      this.client.hGetAll(this.favHashKey(userName))
    );
    const result: Record<string, Favorite> = {};
    for (const [field, raw] of Object.entries(all)) {
      if (raw) {
        result[field] = JSON.parse(raw) as Favorite;
      }
    }
    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await this.withRetry(() =>
      this.client.hDel(this.favHashKey(userName), key)
    );
  }

  async deleteAllFavorites(userName: string): Promise<void> {
    await this.withRetry(() => this.client.del(this.favHashKey(userName)));
  }

  // ---------- 用户注册 / 登录 ----------
  private userPwdKey(user: string) {
    return `u:${user}:pwd`;
  }

  async registerUser(userName: string, password: string): Promise<void> {
    const hashed = hashPassword(password);
    await this.withRetry(() =>
      this.client.set(this.userPwdKey(userName), hashed)
    );
    // 维护用户集合
    await this.withRetry(() => this.client.sAdd(this.usersSetKey(), userName));
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const stored = await this.withRetry(() =>
      this.client.get(this.userPwdKey(userName))
    );
    if (stored === null) return false;
    const storedStr = ensureString(stored);
    const ok = verifyPassword(password, storedStr);
    // 平滑迁移：如果是明文密码且验证通过，自动升级为加盐哈希
    if (ok && !isHashed(storedStr)) {
      const hashed = hashPassword(password);
      await this.withRetry(() =>
        this.client.set(this.userPwdKey(userName), hashed)
      );
    }
    return ok;
  }

  // 检查用户是否存在
  async checkUserExist(userName: string): Promise<boolean> {
    // 使用 EXISTS 判断 key 是否存在
    const exists = await this.withRetry(() =>
      this.client.exists(this.userPwdKey(userName))
    );
    return exists === 1;
  }

  // 修改用户密码
  async changePassword(userName: string, newPassword: string): Promise<void> {
    const hashed = hashPassword(newPassword);
    await this.withRetry(() =>
      this.client.set(this.userPwdKey(userName), hashed)
    );
  }

  // 删除用户及其所有数据
  async deleteUser(userName: string): Promise<void> {
    // 删除用户密码
    await this.withRetry(() => this.client.del(this.userPwdKey(userName)));

    // 从用户集合中移除
    await this.withRetry(() => this.client.sRem(this.usersSetKey(), userName));

    // 删除搜索历史
    await this.withRetry(() => this.client.del(this.shKey(userName)));

    // 删除播放记录（Hash key 直接删除）
    await this.withRetry(() => this.client.del(this.prHashKey(userName)));

    // 删除收藏夹（Hash key 直接删除）
    await this.withRetry(() => this.client.del(this.favHashKey(userName)));

    // 删除跳过片头片尾配置（Hash key 直接删除）
    await this.withRetry(() => this.client.del(this.skipHashKey(userName)));
  }

  // ---------- 搜索历史 ----------
  private shKey(user: string) {
    return `u:${user}:sh`; // u:username:sh
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const result = await this.withRetry(() =>
      this.client.lRange(this.shKey(userName), 0, -1)
    );
    // 确保返回的都是字符串类型
    return ensureStringArray(result as any[]);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = this.shKey(userName);
    // 先去重
    await this.withRetry(() => this.client.lRem(key, 0, ensureString(keyword)));
    // 插入到最前
    await this.withRetry(() => this.client.lPush(key, ensureString(keyword)));
    // 限制最大长度
    await this.withRetry(() =>
      this.client.lTrim(key, 0, SEARCH_HISTORY_LIMIT - 1)
    );
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = this.shKey(userName);
    if (keyword) {
      await this.withRetry(() =>
        this.client.lRem(key, 0, ensureString(keyword))
      );
    } else {
      await this.withRetry(() => this.client.del(key));
    }
  }

  // ---------- 获取全部用户 ----------
  private usersSetKey() {
    return 'sys:users';
  }

  async getAllUsers(): Promise<string[]> {
    const members = await this.withRetry(() =>
      this.client.sMembers(this.usersSetKey())
    );
    return ensureStringArray(members as any[]);
  }

  private onlineSessionsKey() {
    return 'sys:online:sessions';
  }

  async touchOnlineSession(
    userName: string,
    sessionId: string,
    timestamp: number
  ): Promise<void> {
    const member = `${encodeURIComponent(userName)}:${sessionId}`;
    await this.withRetry(() =>
      this.client.zAdd(this.onlineSessionsKey(), [
        { score: timestamp, value: member },
      ])
    );
  }

  async getOnlineUserCount(since: number): Promise<number> {
    const key = this.onlineSessionsKey();
    await this.withRetry(() => this.client.zRemRangeByScore(key, 0, since - 1));
    const sessions = await this.withRetry(() =>
      this.client.zRangeByScore(key, since, '+inf')
    );
    return new Set(
      sessions.map((session) => decodeURIComponent(session.split(':', 1)[0]))
    ).size;
  }

  // ---------- 管理员配置 ----------
  private adminConfigKey() {
    return 'admin:config';
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const val = await this.withRetry(() =>
      this.client.get(this.adminConfigKey())
    );
    return val ? (JSON.parse(val) as AdminConfig) : null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await this.withRetry(() =>
      this.client.set(this.adminConfigKey(), JSON.stringify(config))
    );
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
    const val = await this.withRetry(() =>
      this.client.hGet(this.skipHashKey(userName), this.skipField(source, id))
    );
    return val ? (JSON.parse(val) as SkipConfig) : null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.hSet(
        this.skipHashKey(userName),
        this.skipField(source, id),
        JSON.stringify(config)
      )
    );
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.hDel(this.skipHashKey(userName), this.skipField(source, id))
    );
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    const all = await this.withRetry(() =>
      this.client.hGetAll(this.skipHashKey(userName))
    );
    const configs: { [key: string]: SkipConfig } = {};
    for (const [field, raw] of Object.entries(all)) {
      if (raw) {
        configs[field] = JSON.parse(raw) as SkipConfig;
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
    const migrated = await this.withRetry(() =>
      this.client.get(this.migrationKey())
    );
    if (migrated === 'done') return;

    console.log('开始数据迁移：扁平 key → Hash 结构...');

    try {
      // 迁移播放记录：u:*:pr:* → u:username:pr (Hash)
      const prKeys = await this.withRetry(() => this.client.keys('u:*:pr:*'));
      if (prKeys.length > 0) {
        const oldPrKeys = prKeys.filter((k) => {
          const parts = k.split(':');
          return parts.length >= 4 && parts[2] === 'pr' && parts[3] !== '';
        });

        if (oldPrKeys.length > 0) {
          const values = await this.withRetry(() =>
            this.client.mGet(oldPrKeys)
          );
          for (let i = 0; i < oldPrKeys.length; i++) {
            const raw = values[i];
            if (!raw) continue;
            const match = oldPrKeys[i].match(/^u:(.+?):pr:(.+)$/);
            if (!match) continue;
            const [, userName, field] = match;
            await this.withRetry(() =>
              this.client.hSet(this.prHashKey(userName), field, raw)
            );
          }
          await this.withRetry(() => this.client.del(oldPrKeys));
          console.log(`迁移了 ${oldPrKeys.length} 条播放记录`);
        }
      }

      // 迁移收藏：u:*:fav:* → u:username:fav (Hash)
      const favKeys = await this.withRetry(() => this.client.keys('u:*:fav:*'));
      if (favKeys.length > 0) {
        const oldFavKeys = favKeys.filter((k) => {
          const parts = k.split(':');
          return parts.length >= 4 && parts[2] === 'fav' && parts[3] !== '';
        });

        if (oldFavKeys.length > 0) {
          const values = await this.withRetry(() =>
            this.client.mGet(oldFavKeys)
          );
          for (let i = 0; i < oldFavKeys.length; i++) {
            const raw = values[i];
            if (!raw) continue;
            const match = oldFavKeys[i].match(/^u:(.+?):fav:(.+)$/);
            if (!match) continue;
            const [, userName, field] = match;
            await this.withRetry(() =>
              this.client.hSet(this.favHashKey(userName), field, raw)
            );
          }
          await this.withRetry(() => this.client.del(oldFavKeys));
          console.log(`迁移了 ${oldFavKeys.length} 条收藏`);
        }
      }

      // 迁移 skipConfig：u:*:skip:* → u:username:skip (Hash)
      const skipKeys = await this.withRetry(() =>
        this.client.keys('u:*:skip:*')
      );
      if (skipKeys.length > 0) {
        const oldSkipKeys = skipKeys.filter((k) => {
          const parts = k.split(':');
          return parts.length >= 4 && parts[2] === 'skip' && parts[3] !== '';
        });

        if (oldSkipKeys.length > 0) {
          const values = await this.withRetry(() =>
            this.client.mGet(oldSkipKeys)
          );
          for (let i = 0; i < oldSkipKeys.length; i++) {
            const raw = values[i];
            if (!raw) continue;
            const match = oldSkipKeys[i].match(/^u:(.+?):skip:(.+)$/);
            if (!match) continue;
            const [, userName, field] = match;
            await this.withRetry(() =>
              this.client.hSet(this.skipHashKey(userName), field, raw)
            );
          }
          await this.withRetry(() => this.client.del(oldSkipKeys));
          console.log(`迁移了 ${oldSkipKeys.length} 条跳过配置`);
        }
      }

      // 迁移用户列表：从 KEYS u:*:pwd 构建 sys:users Set
      const userSetExists = await this.withRetry(() =>
        this.client.exists(this.usersSetKey())
      );
      if (!userSetExists) {
        const pwdKeys = await this.withRetry(() => this.client.keys('u:*:pwd'));
        const userNames = pwdKeys
          .map((k) => {
            const match = k.match(/^u:(.+?):pwd$/);
            return match ? match[1] : undefined;
          })
          .filter((u): u is string => typeof u === 'string');
        if (userNames.length > 0) {
          await this.withRetry(() =>
            this.client.sAdd(this.usersSetKey(), userNames)
          );
          console.log(`迁移了 ${userNames.length} 个用户到 Set`);
        }
      }

      // 标记迁移完成
      await this.withRetry(() => this.client.set(this.migrationKey(), 'done'));
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
    const migrated = await this.withRetry(() =>
      this.client.get(this.pwdMigrationKey())
    );
    if (migrated === 'done') return;

    console.log('开始密码迁移：明文 → 加盐哈希...');

    try {
      const pwdKeys = await this.withRetry(() => this.client.keys('u:*:pwd'));
      let count = 0;

      for (const key of pwdKeys) {
        const stored = await this.withRetry(() => this.client.get(key));
        if (stored === null) continue;
        const storedStr = ensureString(stored);
        // 跳过已经是哈希格式的
        if (isHashed(storedStr)) continue;
        // 将明文密码转为加盐哈希
        const hashed = hashPassword(storedStr);
        await this.withRetry(() => this.client.set(key, hashed));
        count++;
      }

      await this.withRetry(() =>
        this.client.set(this.pwdMigrationKey(), 'done')
      );
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
      await this.withRetry(() => this.client.del(this.adminConfigKey()));

      console.log('所有数据已清空');
    } catch (error) {
      console.error('清空数据失败:', error);
      throw new Error('清空数据失败');
    }
  }

  // ---------- 播放统计 ----------

  // 读取用户登入统计
  private async readLoginStats(userName: string): Promise<{
    loginCount: number;
    firstLoginTime: number;
    lastLoginTime: number;
    lastLoginDate: number;
  }> {
    try {
      const storedLoginStats = await this.withRetry(() =>
        this.client.get(`user_login_stats:${userName}`)
      );
      if (storedLoginStats) {
        const parsed = JSON.parse(storedLoginStats);
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
  }

  // 获取用户播放统计
  async getUserPlayStat(userName: string): Promise<UserPlayStat> {
    try {
      // 获取用户所有播放记录
      const playRecords = await this.getAllPlayRecords(userName);
      const records = Object.values(playRecords);

      const loginStats = await this.readLoginStats(userName);

      if (records.length === 0) {
        // 即使没有播放记录，也要返回登入统计
        return {
          username: userName,
          totalWatchTime: 0,
          totalPlays: 0,
          lastPlayTime: 0,
          recentRecords: [],
          avgWatchTime: 0,
          mostWatchedSource: '',
          // 新增字段
          totalMovies: 0,
          firstWatchDate: Date.now(),
          lastUpdateTime: Date.now(),
          // 登入统计字段
          loginCount: loginStats.loginCount,
          firstLoginTime: loginStats.firstLoginTime,
          lastLoginTime: loginStats.lastLoginTime,
          lastLoginDate: loginStats.lastLoginDate,
        };
      }

      // 计算统计数据
      const totalWatchTime = records.reduce(
        (sum, record) => sum + (record.play_time || 0),
        0
      );
      const totalPlays = records.length;
      const lastPlayTime = Math.max(...records.map((r) => r.save_time || 0));

      // 计算观看影片总数（去重）
      const totalMovies = new Set(
        records.map((r) => `${r.title}_${r.source_name}_${r.year}`)
      ).size;

      // 计算首次观看时间
      const firstWatchDate = Math.min(
        ...records.map((r) => r.save_time || Date.now())
      );

      // 最近10条记录，按时间排序
      const recentRecords = records
        .sort((a, b) => (b.save_time || 0) - (a.save_time || 0))
        .slice(0, 10);

      // 平均观看时长
      const avgWatchTime = totalPlays > 0 ? totalWatchTime / totalPlays : 0;

      // 最常观看的来源
      const sourceMap = new Map<string, number>();
      records.forEach((record) => {
        const sourceName = record.source_name || '未知来源';
        const count = sourceMap.get(sourceName) || 0;
        sourceMap.set(sourceName, count + 1);
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
  }

  // 获取内容热度统计
  async getContentStats(limit = 10): Promise<ContentStat[]> {
    try {
      const allUsers = await this.getAllUsers();
      const contentMap = new Map<
        string,
        {
          record: PlayRecord;
          playCount: number;
          totalWatchTime: number;
          users: Set<string>;
        }
      >();

      // 收集所有播放记录
      for (const username of allUsers) {
        const playRecords = await this.getAllPlayRecords(username);

        Object.entries(playRecords).forEach(([key, record]) => {
          const contentKey = key; // source+id

          if (!contentMap.has(contentKey)) {
            contentMap.set(contentKey, {
              record,
              playCount: 0,
              totalWatchTime: 0,
              users: new Set(),
            });
          }

          const content = contentMap.get(contentKey)!;
          content.playCount++;
          content.totalWatchTime += record.play_time || 0;
          content.users.add(username);
        });
      }

      // 转换为ContentStat数组并排序
      const contentStats: ContentStat[] = Array.from(contentMap.entries())
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

      return contentStats;
    } catch (error) {
      console.error('获取内容统计失败:', error);
      return [];
    }
  }

  // 更新播放统计（当用户播放时调用）
  async updatePlayStatistics(
    _userName: string,
    _source: string,
    _id: string,
    _watchTime: number
  ): Promise<void> {
    try {
      // 清除全站统计缓存，下次查询时重新计算
      await this.withRetry(() => this.client.del('play_stats_summary'));
    } catch (error) {
      console.error('更新播放统计失败:', error);
    }
  }

  // 更新用户登入统计
  async updateUserLoginStats(
    userName: string,
    loginTime: number,
    isFirstLogin?: boolean
  ): Promise<void> {
    try {
      const loginStatsKey = `user_login_stats:${userName}`;

      // 获取当前登入统计数据
      const currentStats = await this.withRetry(() =>
        this.client.get(loginStatsKey)
      );
      const loginStats = currentStats
        ? JSON.parse(currentStats)
        : {
            loginCount: 0,
            firstLoginTime: null,
            lastLoginTime: null,
            lastLoginDate: null,
          };

      // 更新统计数据
      loginStats.loginCount = (loginStats.loginCount || 0) + 1;
      loginStats.lastLoginTime = loginTime;
      loginStats.lastLoginDate = loginTime; // 保持兼容性

      // 如果是首次登入，记录首次登入时间
      if (isFirstLogin || !loginStats.firstLoginTime) {
        loginStats.firstLoginTime = loginTime;
      }

      // 保存更新后的统计数据
      await this.withRetry(() =>
        this.client.set(loginStatsKey, JSON.stringify(loginStats))
      );

      console.log(`用户 ${userName} 登入统计已更新`);
    } catch (error) {
      console.error(`更新用户 ${userName} 登入统计失败:`, error);
      throw error;
    }
  }
}
