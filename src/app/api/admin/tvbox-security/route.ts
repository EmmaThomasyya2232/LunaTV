/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 权限校验（仅 owner/admin 可操作）
async function checkAdminPermission(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const username = authInfo.username;

  if (username !== process.env.USERNAME) {
    const adminConfig = await getConfig();
    const userEntry = adminConfig.UserConfig.Users.find(
      (u) => u.username === username
    );
    if (!userEntry || (userEntry.role !== 'admin' && userEntry.role !== 'owner') || userEntry.banned) {
      return { error: NextResponse.json({ error: '权限不足' }, { status: 401 }) };
    }
  }

  return { username };
}

// 获取默认安全配置
function getDefaultSecurityConfig() {
  return {
    enableAuth: false,
    token: '',
    enableIpWhitelist: false,
    allowedIPs: [] as string[],
    enableRateLimit: false,
    rateLimit: 60,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { error } = await checkAdminPermission(request);
    if (error) return error;

    const config = await getConfig();
    const securityConfig = config.TVBoxSecurityConfig || getDefaultSecurityConfig();

    return NextResponse.json({ securityConfig });
  } catch (err) {
    console.error('获取TVBox安全配置失败:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储进行管理员配置' },
      { status: 400 }
    );
  }

  try {
    const { error, username } = await checkAdminPermission(request);
    if (error) return error;

    const body = (await request.json()) as Record<string, any>;
    const action = body.action as string | undefined;

    const adminConfig = await getConfig();

    // 🔑 用户专属 Token 管理动作
    if (action === 'set_user_tvbox_token') {
      const { targetUsername, token, enabledSources, showAdultContent } = body as {
        targetUsername?: string;
        token?: string;
        enabledSources?: string[];
        showAdultContent?: boolean;
      };

      if (!targetUsername) {
        return NextResponse.json({ error: '缺少目标用户名' }, { status: 400 });
      }

      const userEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === targetUsername
      );
      if (!userEntry) {
        return NextResponse.json({ error: '用户不存在' }, { status: 404 });
      }

      userEntry.tvboxToken = token || undefined;
      userEntry.tvboxEnabledSources =
        enabledSources && enabledSources.length > 0 ? enabledSources : undefined;
      userEntry.showAdultContent = showAdultContent === true;

      await db.saveAdminConfig(adminConfig);
      console.log(
        `[TVBox Security] 用户 ${username} 更新了 ${targetUsername} 的 TVBox Token`
      );

      return NextResponse.json({ ok: true });
    }

    // 默认动作：保存全局安全配置
    const { enableAuth, token, enableIpWhitelist, allowedIPs, enableRateLimit, rateLimit } =
      body as {
        enableAuth?: boolean;
        token?: string;
        enableIpWhitelist?: boolean;
        allowedIPs?: string[];
        enableRateLimit?: boolean;
        rateLimit?: number;
      };

    adminConfig.TVBoxSecurityConfig = {
      enableAuth: enableAuth === true,
      token: token || '',
      enableIpWhitelist: enableIpWhitelist === true,
      allowedIPs: Array.isArray(allowedIPs) ? allowedIPs : [],
      enableRateLimit: enableRateLimit === true,
      rateLimit: typeof rateLimit === 'number' && rateLimit > 0 ? rateLimit : 60,
    };

    // 如果启用Token验证但没有提供token，自动生成一个
    if (adminConfig.TVBoxSecurityConfig.enableAuth && !adminConfig.TVBoxSecurityConfig.token) {
      adminConfig.TVBoxSecurityConfig.token = crypto.randomUUID().replace(/-/g, '');
    }

    await db.saveAdminConfig(adminConfig);
    console.log(`[TVBox Security] 用户 ${username} 更新了 TVBox 安全配置`);

    return NextResponse.json({
      ok: true,
      securityConfig: adminConfig.TVBoxSecurityConfig,
    });
  } catch (err) {
    console.error('保存TVBox安全配置失败:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
