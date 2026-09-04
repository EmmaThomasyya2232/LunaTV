import { NextRequest, NextResponse } from 'next/server';

import {
  HomeAdsConfig,
  HomeAdvertisement,
  HomeAdvertisementAudience,
  HomeAdvertisementDevice,
} from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { clearConfigCache, getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function isTimestamp(value: unknown): value is number | undefined {
  return (
    value === undefined || (typeof value === 'number' && Number.isFinite(value))
  );
}

function isAdvertisement(value: unknown): value is HomeAdvertisement {
  if (!value || typeof value !== 'object') return false;
  const advertisement = value as HomeAdvertisement;
  return (
    /^[A-Za-z0-9_-]{8,128}$/.test(advertisement.id) &&
    typeof advertisement.enabled === 'boolean' &&
    typeof advertisement.title === 'string' &&
    advertisement.title.trim().length > 0 &&
    advertisement.title.length <= 100 &&
    typeof advertisement.description === 'string' &&
    advertisement.description.length <= 280 &&
    isHttpUrl(advertisement.imageUrl) &&
    isHttpUrl(advertisement.linkUrl) &&
    ['all', 'loggedIn'].includes(
      advertisement.audience as HomeAdvertisementAudience
    ) &&
    ['all', 'desktop', 'mobile'].includes(
      advertisement.device as HomeAdvertisementDevice
    ) &&
    isTimestamp(advertisement.startAt) &&
    isTimestamp(advertisement.endAt) &&
    (!advertisement.startAt ||
      !advertisement.endAt ||
      advertisement.startAt <= advertisement.endAt)
  );
}

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储进行管理员配置' },
      { status: 400 }
    );
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as HomeAdsConfig;
    if (
      typeof payload?.enabled !== 'boolean' ||
      !Array.isArray(payload.items) ||
      payload.items.length > 12 ||
      !payload.items.every(isAdvertisement) ||
      new Set(payload.items.map((item) => item.id)).size !==
        payload.items.length
    ) {
      return NextResponse.json({ error: '广告配置格式错误' }, { status: 400 });
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

    config.HomeAds = {
      enabled: payload.enabled,
      items: payload.items.map((item) => ({
        ...item,
        title: item.title.trim(),
        description: item.description.trim(),
        imageUrl: item.imageUrl.trim(),
        linkUrl: item.linkUrl.trim(),
      })),
    };
    await db.saveAdminConfig(config);
    clearConfigCache();

    return NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: '保存首页广告失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
