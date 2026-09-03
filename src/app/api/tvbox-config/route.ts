/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 普通用户也可以访问的 TVBox 配置接口
// 只返回 TVBox 安全配置，不返回完整的管理配置
export async function GET(request: NextRequest) {
  try {
    // 检查用户是否登录
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 获取配置
    const config = await getConfig();
    const securityConfig = config.TVBoxSecurityConfig || {
      enableAuth: false,
      token: '',
      enableIpWhitelist: false,
      allowedIPs: [],
      enableRateLimit: false,
      rateLimit: 60,
    };

    // 🔑 获取当前用户的专属配置
    const currentUser = config.UserConfig.Users.find(
      (u) => u.username === authInfo.username
    );
    const userTvboxToken = currentUser?.tvboxToken || '';
    const userEnabledSources = currentUser?.tvboxEnabledSources || [];

    // 获取所有可用源（用于管理界面选择）
    const allSources = (config.SourceConfig || [])
      .filter((s) => !s.disabled)
      .map((s) => ({ key: s.key, name: s.name }));

    // 只返回 TVBox 安全配置和站点名称（不返回其他敏感信息）
    return NextResponse.json({
      securityConfig: securityConfig,
      siteName: config.SiteConfig?.SiteName || 'LunaTV',
      // 🔑 用户专属信息
      userToken: userTvboxToken,
      userEnabledSources: userEnabledSources,
      allSources: allSources,
    });
  } catch (error) {
    console.error('获取 TVBox 配置失败:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
