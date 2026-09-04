import { NextRequest, NextResponse } from 'next/server';

import { HomeAdvertisement } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

function isActive(advertisement: HomeAdvertisement, now: number): boolean {
  return (
    advertisement.enabled &&
    (!advertisement.startAt || advertisement.startAt <= now) &&
    (!advertisement.endAt || advertisement.endAt >= now)
  );
}

export async function GET(request: NextRequest) {
  try {
    const username = getAuthInfoFromCookie(request)?.username;
    const config = await getConfig();
    const homeAds = config.HomeAds || { enabled: false, items: [] };
    const now = Date.now();
    const advertisements = homeAds.enabled
      ? homeAds.items.filter(
          (advertisement) =>
            isActive(advertisement, now) &&
            (advertisement.audience === 'all' || Boolean(username))
        )
      : [];

    return NextResponse.json(
      { advertisements },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: '获取首页广告失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
