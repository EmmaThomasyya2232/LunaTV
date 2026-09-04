import { NextRequest, NextResponse } from 'next/server';

import { AIRecommendConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { clearConfigCache, getConfig } from '@/lib/config';
import { SimpleCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isAIRecommendConfig(value: unknown): value is AIRecommendConfig {
  if (!value || typeof value !== 'object') return false;
  const config = value as AIRecommendConfig;
  return (
    typeof config.enabled === 'boolean' &&
    (config.baseUrl === '' || isHttpUrl(config.baseUrl)) &&
    typeof config.model === 'string' &&
    config.model.trim().length > 0 &&
    config.model.length <= 120 &&
    typeof config.systemPrompt === 'string' &&
    config.systemPrompt.trim().length > 0 &&
    config.systemPrompt.length <= 8000 &&
    Number.isInteger(config.maxCompletionTokens) &&
    config.maxCompletionTokens >= 128 &&
    config.maxCompletionTokens <= 8192
  );
}

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储进行 AI 配置' },
      { status: 400 }
    );
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as AIRecommendConfig & {
      apiKey?: unknown;
      clearApiKey?: unknown;
    };
    if (!isAIRecommendConfig(payload)) {
      return NextResponse.json({ error: 'AI 配置格式错误' }, { status: 400 });
    }
    if (
      payload.apiKey !== undefined &&
      (typeof payload.apiKey !== 'string' || payload.apiKey.length > 2000)
    ) {
      return NextResponse.json(
        { error: 'AI_API_KEY 格式错误' },
        { status: 400 }
      );
    }
    if (
      payload.clearApiKey !== undefined &&
      typeof payload.clearApiKey !== 'boolean'
    ) {
      return NextResponse.json(
        { error: '清除密钥参数格式错误' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    const user = config.UserConfig.Users.find(
      (entry) => entry.username === authInfo.username
    );
    if (
      authInfo.username !== process.env.USERNAME &&
      (!user || user.role !== 'admin' || user.banned)
    ) {
      return NextResponse.json({ error: '权限不足' }, { status: 403 });
    }

    const apiKey =
      typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';
    config.AIRecommend = {
      enabled: payload.enabled,
      baseUrl: payload.baseUrl.trim().replace(/\/+$/, ''),
      model: payload.model.trim(),
      systemPrompt: payload.systemPrompt.trim(),
      maxCompletionTokens: payload.maxCompletionTokens,
      apiKeyEncrypted: payload.clearApiKey
        ? undefined
        : apiKey
        ? SimpleCrypto.encrypt(apiKey, process.env.PASSWORD || '')
        : config.AIRecommend?.apiKeyEncrypted,
    };
    await db.saveAdminConfig(config);
    clearConfigCache();

    return NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: '保存 AI 配置失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
