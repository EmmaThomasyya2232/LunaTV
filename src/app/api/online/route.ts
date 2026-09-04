import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { ONLINE_PRESENCE_WINDOW_MS } from '@/lib/online';

export const runtime = 'nodejs';

function getAuthenticatedUsername(request: NextRequest): string | null {
  return getAuthInfoFromCookie(request)?.username || null;
}

function onlineSince(): number {
  return Date.now() - ONLINE_PRESENCE_WINDOW_MS;
}

export async function GET(request: NextRequest) {
  if (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  ) {
    return NextResponse.json(
      { error: '当前存储类型不支持在线状态统计' },
      { status: 400 }
    );
  }

  if (!getAuthenticatedUsername(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const onlineUsers = await db.getOnlineUserCount(onlineSince());
    return NextResponse.json(
      { onlineUsers },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: '获取在线人数失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  ) {
    return NextResponse.json(
      { error: '当前存储类型不支持在线状态统计' },
      { status: 400 }
    );
  }

  const username = getAuthenticatedUsername(request);
  if (!username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { sessionId } = await request.json();
    if (
      typeof sessionId !== 'string' ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(sessionId)
    ) {
      return NextResponse.json({ error: '会话标识格式错误' }, { status: 400 });
    }

    await db.touchOnlineSession(username, sessionId);
    const onlineUsers = await db.getOnlineUserCount(onlineSince());
    return NextResponse.json(
      { onlineUsers },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: '更新在线状态失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
