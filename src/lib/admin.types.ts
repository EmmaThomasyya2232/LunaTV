export interface AdminConfig {
  ConfigSubscribtion: {
    URL: string;
    AutoUpdate: boolean;
    LastCheck: string;
  };
  ConfigFile: string;
  SiteConfig: {
    SiteName: string;
    Announcement: string;
    SearchDownstreamMaxPage: number;
    SiteInterfaceCacheTime: number;
    DoubanProxyType: string;
    DoubanProxy: string;
    DoubanImageProxyType: string;
    DoubanImageProxy: string;
    DisableYellowFilter: boolean;
    FluidSearch: boolean;
    EnableWebLive: boolean;
  };
  UserConfig: {
    AllowRegister?: boolean; // 是否允许用户注册，默认 true
    AutoCleanupInactiveUsers?: boolean; // 是否自动清理非活跃用户，默认 false
    InactiveUserDays?: number; // 非活跃用户保留天数，默认 7
    Users: {
      username: string;
      role: 'user' | 'admin' | 'owner';
      banned?: boolean;
      enabledApis?: string[]; // 优先级高于tags限制
      tags?: string[]; // 多 tags 取并集限制
      createdAt?: number; // 用户创建时间（时间戳，播放统计使用）
      tvboxToken?: string; // 用户专属的 TVBox Token
      tvboxEnabledSources?: string[]; // 该用户可访问的视频源（留空=所有源）
      showAdultContent?: boolean; // 是否允许该用户访问成人内容源
    }[];
    Tags?: {
      name: string;
      enabledApis: string[];
    }[];
  };
  SourceConfig: {
    key: string;
    name: string;
    api: string;
    detail?: string;
    from: 'config' | 'custom';
    disabled?: boolean;
  }[];
  CustomCategories: {
    name?: string;
    type: 'movie' | 'tv';
    query: string;
    from: 'config' | 'custom';
    disabled?: boolean;
  }[];
  LiveConfig?: {
    key: string;
    name: string;
    url: string;  // m3u 地址
    ua?: string;
    epg?: string; // 节目单
    from: 'config' | 'custom';
    channelNumber?: number;
    disabled?: boolean;
  }[];
  TVBoxSecurityConfig?: {
    enableAuth: boolean; // 是否启用Token验证
    token: string; // 访问Token
    enableIpWhitelist: boolean; // 是否启用IP白名单
    allowedIPs: string[]; // 允许的IP地址列表
    enableRateLimit: boolean; // 是否启用频率限制
    rateLimit: number; // 每分钟允许的请求次数
  };
}

export interface AdminConfigResult {
  Role: 'owner' | 'admin';
  Config: AdminConfig;
}
