/* eslint-disable no-console */
import { NextResponse } from 'next/server';

import { getSpiderJar } from '@/lib/spiderJar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 本地 Spider JAR 代理端点
 * 当所有远程 jar 候选源失败时，TVBox 将回退到该端点获取 jar
 */
export async function GET() {
  try {
    const jarInfo = await getSpiderJar();

    return new NextResponse(new Uint8Array(jarInfo.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/java-archive',
        'Content-Length': String(jarInfo.buffer.length),
        'X-Spider-Source': jarInfo.source,
        'X-Spider-Md5': jarInfo.md5,
        'X-Spider-Success': String(jarInfo.success),
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('[SpiderJar Proxy] Failed to serve jar:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
