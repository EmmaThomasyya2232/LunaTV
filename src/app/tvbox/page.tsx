/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Activity, Copy, RefreshCw, Shield, Tv, Wrench } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import PageLayout from '@/components/PageLayout';

interface SecurityConfig {
  enableAuth: boolean;
  token: string;
  enableIpWhitelist: boolean;
  allowedIPs: string[];
  enableRateLimit: boolean;
  rateLimit: number;
}

interface DiagnosisResult {
  status?: number;
  contentType?: string;
  hasJson?: boolean;
  size?: number;
  sitesCount?: number;
  livesCount?: number;
  parsesCount?: number;
  spider?: string;
  spiderReachable?: boolean;
  spiderStatus?: number;
  spiderSizeKB?: number;
  spider_md5?: string;
  spider_url?: string;
  spider_success?: boolean;
  spider_cached?: boolean;
  privateApis?: number;
  issues?: string[];
  pass?: boolean;
  error?: string;
}

const MODES = [
  { key: '', label: '📊 标准模式', desc: '完整配置（IJK/广告过滤/DoH），适合大多数用户' },
  { key: 'safe', label: '🔒 精简模式', desc: '仅核心字段，兼容性问题首选' },
  { key: 'fast', label: '⚡ 快速模式', desc: '优化源切换速度，适合频繁换源' },
  { key: 'yingshicang', label: '🎬 影视仓模式', desc: '专为影视仓优化，含播放规则' },
];

export default function TVBoxConfigPage() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [securityConfig, setSecurityConfig] = useState<SecurityConfig>({
    enableAuth: false,
    token: '',
    enableIpWhitelist: false,
    allowedIPs: [],
    enableRateLimit: false,
    rateLimit: 60,
  });
  const [userToken, setUserToken] = useState('');
  const [newIp, setNewIp] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [activeMode, setActiveMode] = useState('');
  const [format, setFormat] = useState<'json' | 'base64'>('json');
  const [copied, setCopied] = useState('');
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/tvbox-config');
      if (res.ok) {
        const data = await res.json();
        setUserToken(data.userToken || '');
        if (data.securityConfig) setSecurityConfig(data.securityConfig);
      }
      // 尝试管理端接口，判断是否为管理员
      const adminRes = await fetch('/api/admin/tvbox-security');
      if (adminRes.ok) {
        const adminData = await adminRes.json();
        setIsAdmin(true);
        if (adminData.securityConfig) setSecurityConfig(adminData.securityConfig);
      }
    } catch (e) {
      console.error('获取TVBox配置失败:', e);
    } finally {
      setLoading(false);
    }
  };

  // 生成的订阅链接
  const subUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (format !== 'json') params.set('format', format);
    if (activeMode) params.set('mode', activeMode);
    const effectiveToken = userToken || (securityConfig.enableAuth ? securityConfig.token : '');
    if (effectiveToken) params.set('token', effectiveToken);
    const qs = params.toString();
    return `${origin}/api/tvbox${qs ? `?${qs}` : ''}`;
  }, [origin, format, activeMode, userToken, securityConfig]);

  const handleCopy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    } catch (e) {
      console.error('复制失败:', e);
    }
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch('/api/admin/tvbox-security', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(securityConfig),
      });
      const data = await res.json();
      if (res.ok) {
        setSaveMsg('✓ 保存成功');
        if (data.securityConfig) setSecurityConfig(data.securityConfig);
      } else {
        setSaveMsg(`✗ ${data.error || '保存失败'}`);
      }
    } catch (e) {
      setSaveMsg('✗ 保存失败');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 3000);
    }
  };

  const handleDiagnose = async () => {
    setDiagnosing(true);
    setDiagnosis(null);
    try {
      const effectiveToken = userToken || (securityConfig.enableAuth ? securityConfig.token : '');
      const url = effectiveToken
        ? `/api/tvbox/diagnose?token=${encodeURIComponent(effectiveToken)}`
        : '/api/tvbox/diagnose';
      const res = await fetch(url);
      const data = await res.json();
      setDiagnosis(data);
    } catch (e) {
      setDiagnosis({ error: '诊断请求失败' });
    } finally {
      setDiagnosing(false);
    }
  };

  if (loading) {
    return (
      <PageLayout activePath='/tvbox'>
        <div className='flex items-center justify-center min-h-screen'>
          <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/tvbox'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 max-w-[95%] mx-auto space-y-6'>
        {/* 页面标题 */}
        <div className='flex items-center gap-3'>
          <Tv className='w-8 h-8 text-green-500' />
          <div>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
              TVBox 配置
            </h1>
            <p className='text-sm text-gray-500 dark:text-gray-400'>
              将本站视频源无缝导入 TVBox / 影视仓等播放器
            </p>
          </div>
        </div>

        {/* 订阅链接 */}
        <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-5 space-y-4'>
          <h2 className='font-semibold text-gray-900 dark:text-gray-100'>
            订阅配置
          </h2>

          {/* 模式选择 */}
          <div className='grid grid-cols-2 md:grid-cols-4 gap-2'>
            {MODES.map((mode) => (
              <button
                key={mode.key || 'standard'}
                onClick={() => setActiveMode(mode.key)}
                title={mode.desc}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeMode === mode.key
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <p className='text-xs text-gray-500 dark:text-gray-400'>
            {MODES.find((m) => m.key === activeMode)?.desc}
          </p>

          {/* 格式选择 */}
          <div className='flex items-center gap-2'>
            <span className='text-sm text-gray-600 dark:text-gray-400'>返回格式：</span>
            {(['json', 'base64'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  format === f
                    ? 'bg-green-500/20 text-green-700 dark:text-green-400'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                }`}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>

          {/* 链接展示 */}
          <div className='flex items-center gap-2'>
            <input
              readOnly
              value={subUrl}
              className='flex-1 px-3 py-2 text-sm font-mono bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-800 dark:text-gray-200 overflow-x-auto'
            />
            <button
              onClick={() => handleCopy(subUrl, 'sub')}
              className='flex items-center gap-1 px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors flex-shrink-0'
            >
              <Copy className='w-4 h-4' />
              {copied === 'sub' ? '已复制' : '复制'}
            </button>
          </div>

          {/* 使用说明 */}
          <div className='text-xs text-gray-500 dark:text-gray-400 space-y-1 bg-gray-50 dark:bg-gray-900 rounded-lg p-3'>
            <p>使用方法：打开 TVBox → 设置 → 配置地址 → 粘贴上方链接并确认导入。</p>
            <p>接口地址：<code className='font-mono'>/api/tvbox</code>（无需登录，凭 token 鉴权）</p>
            <p>搜索接口：<code className='font-mono'>/api/tvbox/search?source=源key&amp;wd=关键词</code></p>
          </div>
        </div>

        {/* 管理员区域 */}
        {isAdmin && (
          <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-5 space-y-4'>
            <div className='flex items-center gap-2'>
              <Shield className='w-5 h-5 text-green-500' />
              <h2 className='font-semibold text-gray-900 dark:text-gray-100'>
                安全配置（管理员）
              </h2>
            </div>

            <label className='flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300'>
              <input
                type='checkbox'
                checked={securityConfig.enableAuth}
                onChange={(e) =>
                  setSecurityConfig((prev) => ({ ...prev, enableAuth: e.target.checked }))
                }
                className='rounded accent-green-500'
              />
              启用 Token 验证（推荐）
            </label>

            {securityConfig.enableAuth && (
              <div className='flex items-center gap-2'>
                <input
                  value={securityConfig.token}
                  onChange={(e) =>
                    setSecurityConfig((prev) => ({ ...prev, token: e.target.value }))
                  }
                  placeholder='留空保存时自动生成'
                  className='flex-1 px-3 py-2 text-sm font-mono bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg'
                />
                <button
                  onClick={() => handleCopy(securityConfig.token, 'token')}
                  className='px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 rounded-lg'
                >
                  {copied === 'token' ? '已复制' : '复制'}
                </button>
              </div>
            )}

            <label className='flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300'>
              <input
                type='checkbox'
                checked={securityConfig.enableIpWhitelist}
                onChange={(e) =>
                  setSecurityConfig((prev) => ({
                    ...prev,
                    enableIpWhitelist: e.target.checked,
                  }))
                }
                className='rounded accent-green-500'
              />
              启用 IP 白名单
            </label>

            {securityConfig.enableIpWhitelist && (
              <div className='space-y-2'>
                <div className='flex flex-wrap gap-2'>
                  {securityConfig.allowedIPs.map((ip) => (
                    <span
                      key={ip}
                      className='inline-flex items-center gap-1 px-2 py-1 text-xs font-mono bg-gray-100 dark:bg-gray-700 rounded'
                    >
                      {ip}
                      <button
                        onClick={() =>
                          setSecurityConfig((prev) => ({
                            ...prev,
                            allowedIPs: prev.allowedIPs.filter((i) => i !== ip),
                          }))
                        }
                        className='text-red-500 hover:text-red-700'
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className='flex items-center gap-2'>
                  <input
                    value={newIp}
                    onChange={(e) => setNewIp(e.target.value)}
                    placeholder='IP 或 CIDR，如 192.168.1.0/24'
                    className='flex-1 px-3 py-2 text-sm font-mono bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg'
                  />
                  <button
                    onClick={() => {
                      if (newIp.trim()) {
                        setSecurityConfig((prev) => ({
                          ...prev,
                          allowedIPs: [...prev.allowedIPs, newIp.trim()],
                        }));
                        setNewIp('');
                      }
                    }}
                    className='px-3 py-2 text-sm bg-green-500 text-white rounded-lg'
                  >
                    添加
                  </button>
                </div>
              </div>
            )}

            <label className='flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300'>
              <input
                type='checkbox'
                checked={securityConfig.enableRateLimit}
                onChange={(e) =>
                  setSecurityConfig((prev) => ({
                    ...prev,
                    enableRateLimit: e.target.checked,
                  }))
                }
                className='rounded accent-green-500'
              />
              启用访问频率限制
            </label>

            {securityConfig.enableRateLimit && (
              <div className='flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300'>
                <span>每分钟最多</span>
                <input
                  type='number'
                  min={1}
                  value={securityConfig.rateLimit}
                  onChange={(e) =>
                    setSecurityConfig((prev) => ({
                      ...prev,
                      rateLimit: parseInt(e.target.value) || 60,
                    }))
                  }
                  className='w-20 px-2 py-1 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded'
                />
                <span>次请求</span>
              </div>
            )}

            <div className='flex items-center gap-3'>
              <button
                onClick={handleSave}
                disabled={saving}
                className='px-4 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white rounded-lg text-sm font-medium transition-colors'
              >
                {saving ? '保存中...' : '保存配置'}
              </button>
              {saveMsg && (
                <span className='text-sm text-gray-600 dark:text-gray-400'>{saveMsg}</span>
              )}
            </div>
          </div>
        )}

        {/* 诊断工具 */}
        <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-5 space-y-4'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <Activity className='w-5 h-5 text-green-500' />
              <h2 className='font-semibold text-gray-900 dark:text-gray-100'>配置诊断</h2>
            </div>
            <button
              onClick={handleDiagnose}
              disabled={diagnosing}
              className='flex items-center gap-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white rounded-lg text-sm font-medium transition-colors'
            >
              {diagnosing ? (
                <RefreshCw className='w-4 h-4 animate-spin' />
              ) : (
                <Wrench className='w-4 h-4' />
              )}
              {diagnosing ? '诊断中...' : '开始诊断'}
            </button>
          </div>

          {diagnosis && (
            <div className='space-y-2 text-sm'>
              {diagnosis.error ? (
                <div className='p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg'>
                  {diagnosis.error}
                </div>
              ) : (
                <>
                  <div className='grid grid-cols-2 md:grid-cols-4 gap-2'>
                    <div className='p-3 bg-gray-50 dark:bg-gray-900 rounded-lg'>
                      <div className='text-xs text-gray-500'>状态码</div>
                      <div className='font-medium'>{diagnosis.status ?? 'N/A'}</div>
                    </div>
                    <div className='p-3 bg-gray-50 dark:bg-gray-900 rounded-lg'>
                      <div className='text-xs text-gray-500'>影视源</div>
                      <div className='font-medium'>{diagnosis.sitesCount ?? 'N/A'}</div>
                    </div>
                    <div className='p-3 bg-gray-50 dark:bg-gray-900 rounded-lg'>
                      <div className='text-xs text-gray-500'>直播源</div>
                      <div className='font-medium'>{diagnosis.livesCount ?? 'N/A'}</div>
                    </div>
                    <div className='p-3 bg-gray-50 dark:bg-gray-900 rounded-lg'>
                      <div className='text-xs text-gray-500'>Spider 可达</div>
                      <div
                        className={`font-medium ${
                          diagnosis.spiderReachable
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {diagnosis.spiderReachable ? '✓ 正常' : '✗ 异常'}
                      </div>
                    </div>
                  </div>
                  {diagnosis.spider && (
                    <div className='p-3 bg-gray-50 dark:bg-gray-900 rounded-lg font-mono text-xs break-all'>
                      Spider: {diagnosis.spider}
                      {diagnosis.spider_md5 && ` (md5: ${diagnosis.spider_md5})`}
                    </div>
                  )}
                  {diagnosis.issues && diagnosis.issues.length > 0 && (
                    <div className='p-3 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 rounded-lg'>
                      {diagnosis.issues.map((issue, i) => (
                        <p key={i}>⚠ {issue}</p>
                      ))}
                    </div>
                  )}
                  {diagnosis.pass && (
                    <div className='p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-lg'>
                      ✓ 配置健康，所有检查项通过
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
