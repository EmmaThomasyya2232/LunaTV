/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getBaseUrl(req: NextRequest): string {
  const envBase = (process.env.SITE_BASE || '').trim().replace(/\/$/, '');
  if (envBase) return envBase;
  const proto = (req.headers.get('x-forwarded-proto') || 'https')
    .split(',')[0]
    .trim();
  const host = (
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') ||
    ''
  )
    .split(',')[0]
    .trim();
  if (!host) return '';
  return `${proto}://${host}`;
}

function isPrivateHost(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const h = u.hostname;
    return (
      h === 'localhost' ||
      h === '0.0.0.0' ||
      h === '127.0.0.1' ||
      h.startsWith('10.') ||
      h.startsWith('172.16.') ||
      h.startsWith('172.17.') ||
      h.startsWith('172.18.') ||
      h.startsWith('172.19.') ||
      h.startsWith('172.2') || // 172.20-172.31 简化判断
      h.startsWith('192.168.')
    );
  } catch {
    return false;
  }
}

// 调用 health 端点检查 spider jar 健康状态
async function checkSpiderHealth(spider: string): Promise<{
  accessible: boolean;
  status?: number;
  contentLength?: string;
  lastModified?: string;
  error?: string;
}> {
  try {
    const cleanUrl = spider.split(';')[0];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(cleanUrl, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    clearTimeout(timeoutId);

    return {
      accessible: response.ok,
      status: response.status,
      contentLength: response.headers.get('content-length') || undefined,
      lastModified: response.headers.get('last-modified') || undefined,
    };
  } catch (error) {
    return {
      accessible: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function GET(req: NextRequest) {
  try {
    const baseUrl = getBaseUrl(req);
    if (!baseUrl) {
      return NextResponse.json(
        { ok: false, error: 'cannot determine base url' },
        { status: 500 }
      );
    }

    // 从请求中获取 token 参数并传递给 tvbox API
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');

    console.log('[Diagnose] Backend - Received token:', token ? '***' : 'none');

    const url = token
      ? `${baseUrl}/api/tvbox?token=${encodeURIComponent(token)}`
      : `${baseUrl}/api/tvbox`;

    const result: any = { ok: false, url };
    const issues: string[] = [];

    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json,text/plain' },
        cache: 'no-store',
      });
      const text = await res.text();

      result.status = res.status;
      result.contentType = res.headers.get('content-type') || '';
      result.size = text.length;

      if (!res.ok) {
        result.error = `tvbox api returned ${res.status}`;
        issues.push(result.error);
        result.issues = issues;
        return NextResponse.json(result, {
          headers: { 'cache-control': 'no-store' },
        });
      }

      let parsed: any = null;
      let parseError = '';
      try {
        parsed = JSON.parse(text);
      } catch (e: any) {
        parseError = e?.message || 'json parse error';
      }

      result.ok = true;
      result.hasJson = !!parsed;
      if (!parsed && res.headers.get('content-type')?.includes('json')) {
        issues.push('content-type is not text/plain');
      }
      if (!parsed) {
        issues.push(`json parse failed: ${parseError}`);
      }

      if (parsed) {
        const sites = Array.isArray(parsed.sites) ? parsed.sites : [];
        const lives = Array.isArray(parsed.lives) ? parsed.lives : [];
        const spider = parsed.spider || '';
        result.sitesCount = sites.length;
        result.livesCount = lives.length;
        result.parsesCount = Array.isArray(parsed.parses)
          ? parsed.parses.length
          : 0;

        // 传递 Spider 状态透明化字段
        if (parsed.spider_url) result.spider_url = parsed.spider_url;
        if (parsed.spider_md5) result.spider_md5 = parsed.spider_md5;
        if (parsed.spider_cached !== undefined)
          result.spider_cached = parsed.spider_cached;
        if (parsed.spider_real_size !== undefined)
          result.spider_real_size = parsed.spider_real_size;
        if (parsed.spider_tried !== undefined)
          result.spider_tried = parsed.spider_tried;
        if (parsed.spider_success !== undefined)
          result.spider_success = parsed.spider_success;
        if (parsed.spider_backup) result.spider_backup = parsed.spider_backup;
        if (parsed.spider_candidates)
          result.spider_candidates = parsed.spider_candidates;

        // 检查私网地址
        const privateApis = sites.filter(
          (s: any) => typeof s?.api === 'string' && isPrivateHost(s.api)
        ).length;
        result.privateApis = privateApis;
        if (privateApis > 0) {
          issues.push(`found ${privateApis} private api urls`);
        }
        if (typeof spider === 'string' && spider) {
          result.spider = spider;
          result.spiderPrivate = isPrivateHost(spider);
          if (result.spiderPrivate) {
            issues.push('spider url is private/not public');
          } else if (
            spider.startsWith('http://') ||
            spider.startsWith('https://')
          ) {
            // 使用增强的健康检查
            const healthCheck = await checkSpiderHealth(spider);
            result.spiderReachable = healthCheck.accessible;
            result.spiderStatus = healthCheck.status;
            result.spiderContentLength = healthCheck.contentLength;
            result.spiderLastModified = healthCheck.lastModified;

            if (!healthCheck.accessible) {
              issues.push(
                `spider unreachable: ${healthCheck.status || healthCheck.error}`
              );
            } else if (healthCheck.contentLength) {
              // 验证文件大小（spider jar 通常大于 100KB）
              const sizeKB = parseInt(healthCheck.contentLength) / 1024;
              result.spiderSizeKB = Math.round(sizeKB);
              if (sizeKB < 50) {
                issues.push(
                  `spider jar size suspicious: ${result.spiderSizeKB}KB (expected >100KB)`
                );
              }
            }
          }
        }
      }

      // 最终状态
      result.pass =
        result.ok && result.hasJson && (!issues || issues.length === 0);
      result.issues = issues;
      return NextResponse.json(result, {
        headers: { 'cache-control': 'no-store' },
      });
    } catch (e: any) {
      result.error = e?.message || 'fetch failed';
      result.issues = issues.concat(result.error);
      return NextResponse.json(result, {
        status: 200,
        headers: { 'cache-control': 'no-store' },
      });
    }
  } catch (e: any) {
    console.error('Diagnose failed', e);
    return NextResponse.json(
      { ok: false, error: e?.message || 'unknown error' },
      { status: 500 }
    );
  }
}
