import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { SimpleCrypto } from '@/lib/crypto';

export const runtime = 'nodejs';

function getModelsUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  if (normalizedBaseUrl.endsWith('/v1')) return `${normalizedBaseUrl}/models`;
  return `${normalizedBaseUrl}/v1/models`;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

  const aiConfig = config.AIRecommend;
  const apiKey = getApiKey(aiConfig?.apiKeyEncrypted);
  if (!aiConfig?.baseUrl || !apiKey) {
    return NextResponse.json(
      { error: '请先配置 AI 地址和 AI_API_KEY' },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(getModelsUrl(aiConfig.baseUrl), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(
        { error: '连接 AI 服务失败' },
        { status: response.status || 502 }
      );
    }

    const models = Array.isArray(data?.data)
      ? data.data
          .map((model: { id?: unknown }) => model.id)
          .filter((id: unknown): id is string => typeof id === 'string')
          .slice(0, 50)
      : [];
    return NextResponse.json({ ok: true, models });
  } catch {
    return NextResponse.json(
      { error: 'AI 服务连接超时或不可用' },
      { status: 502 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

  try {
    const payload = (await request.json()) as {
      baseUrl?: unknown;
      apiKey?: unknown;
    };
    if (!isHttpUrl(payload.baseUrl)) {
      return NextResponse.json(
        { error: '请填写有效的 AI 服务地址' },
        { status: 400 }
      );
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

    const suppliedApiKey =
      typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';
    const apiKey =
      suppliedApiKey || getApiKey(config.AIRecommend?.apiKeyEncrypted);
    if (!apiKey) {
      return NextResponse.json(
        { error: '请先填写或保存 AI_API_KEY' },
        { status: 400 }
      );
    }

    const response = await fetch(getModelsUrl(payload.baseUrl), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(
        { error: '获取模型列表失败' },
        { status: response.status || 502 }
      );
    }

    const models = Array.isArray(data?.data)
      ? data.data
          .map((model: { id?: unknown }) => model.id)
          .filter((id: unknown): id is string => typeof id === 'string')
          .slice(0, 50)
      : [];
    return NextResponse.json({ ok: true, models });
  } catch {
    return NextResponse.json(
      { error: 'AI 服务连接超时或不可用' },
      { status: 502 }
    );
  }
}

function getApiKey(encryptedApiKey?: string): string | null {
  if (process.env.AI_API_KEY) return process.env.AI_API_KEY;
  if (!encryptedApiKey || !process.env.PASSWORD) return null;
  try {
    return SimpleCrypto.decrypt(encryptedApiKey, process.env.PASSWORD);
  } catch {
    return null;
  }
}
