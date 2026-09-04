import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { SimpleCrypto } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REQUEST_WINDOW_MS = 60_000;
const REQUEST_LIMIT = 12;
const requestHistory = new Map<string, number[]>();

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string | ChatContentPart[];
};

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

function getChatCompletionsUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  if (normalizedBaseUrl.endsWith('/chat/completions')) {
    return normalizedBaseUrl;
  }
  if (normalizedBaseUrl.endsWith('/v1')) {
    return `${normalizedBaseUrl}/chat/completions`;
  }
  return `${normalizedBaseUrl}/v1/chat/completions`;
}

function isAllowedRequest(userKey: string): boolean {
  const now = Date.now();
  const timestamps = (requestHistory.get(userKey) || []).filter(
    (timestamp) => now - timestamp < REQUEST_WINDOW_MS
  );
  if (timestamps.length >= REQUEST_LIMIT) {
    requestHistory.set(userKey, timestamps);
    return false;
  }
  timestamps.push(now);
  requestHistory.set(userKey, timestamps);
  return true;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as ChatMessage;
  if (message.role !== 'user' && message.role !== 'assistant') return false;
  if (typeof message.content === 'string') {
    return message.content.trim().length > 0 && message.content.length <= 4000;
  }
  if (
    !Array.isArray(message.content) ||
    message.role !== 'user' ||
    message.content.length !== 2
  ) {
    return false;
  }

  const [textPart, imagePart] = message.content as ChatContentPart[];
  return (
    textPart?.type === 'text' &&
    typeof textPart.text === 'string' &&
    textPart.text.trim().length > 0 &&
    textPart.text.length <= 4000 &&
    imagePart?.type === 'image_url' &&
    typeof imagePart.image_url?.url === 'string' &&
    /^data:image\/(jpeg|png|webp|gif);base64,/.test(imagePart.image_url.url) &&
    imagePart.image_url.url.length <= 2_800_000
  );
}

export async function POST(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userKey = authInfo.username || 'local-user';
  if (!isAllowedRequest(userKey)) {
    return NextResponse.json(
      { error: '请求过于频繁，请稍后再试' },
      { status: 429 }
    );
  }

  try {
    const body = (await request.json()) as {
      messages?: unknown;
      context?: unknown;
    };
    const messages = body.messages;
    if (
      !Array.isArray(messages) ||
      messages.length === 0 ||
      messages.length > 12 ||
      !messages.every(isChatMessage)
    ) {
      return NextResponse.json({ error: '对话内容格式错误' }, { status: 400 });
    }

    const context =
      typeof body.context === 'string'
        ? body.context.trim().slice(0, 1000)
        : '';
    const config = await getConfig();
    const aiConfig = config.AIRecommend;
    if (!aiConfig?.enabled || !aiConfig.baseUrl) {
      return NextResponse.json({ error: 'AI 助手暂未启用' }, { status: 503 });
    }

    const apiKey = getApiKey(aiConfig.apiKeyEncrypted);
    if (!apiKey) {
      return NextResponse.json(
        { error: '服务端尚未配置 AI_API_KEY' },
        { status: 503 }
      );
    }

    const systemPrompt = context
      ? `${aiConfig.systemPrompt}\n\n当前浏览页面信息：${context}`
      : aiConfig.systemPrompt;
    const response = await fetch(getChatCompletionsUrl(aiConfig.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_completion_tokens: aiConfig.maxCompletionTokens,
        stream: true,
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok || !response.body) {
      const details = await response.text().catch(() => '');
      return NextResponse.json(
        { error: 'AI 服务请求失败', details: details.slice(0, 500) },
        { status: response.status || 502 }
      );
    }

    return new Response(response.body, {
      headers: {
        'Content-Type':
          response.headers.get('Content-Type') || 'text/event-stream',
        'Cache-Control': 'no-cache, no-store',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 服务不可用';
    return NextResponse.json(
      { error: 'AI 服务不可用', details: message.slice(0, 300) },
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
