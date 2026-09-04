'use client';

import { ChevronDown, PlugZap, Save, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AdminConfig, AIRecommendConfig as AIConfig } from '@/lib/admin.types';

interface AIRecommendConfigProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

const defaultConfig: AIConfig = {
  enabled: false,
  baseUrl: '',
  model: 'gpt-5-mini',
  systemPrompt:
    '你是 LunaTV 的影视推荐助手。请根据用户需求给出简洁、可靠的影视推荐；不确定的信息请明确说明。',
  maxCompletionTokens: 1024,
};

const AIRecommendConfig = ({
  config,
  refreshConfig,
}: AIRecommendConfigProps) => {
  const [aiConfig, setAIConfig] = useState<AIConfig>(defaultConfig);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);

  useEffect(() => {
    setAIConfig(config?.AIRecommend || defaultConfig);
    setApiKey('');
    setClearApiKey(false);
  }, [config]);

  useEffect(() => {
    if (!isModelPickerOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isModelPickerOpen]);

  const updateConfig = (changes: Partial<AIConfig>) => {
    setAIConfig((current) => ({ ...current, ...changes }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/ai-recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...aiConfig, apiKey, clearApiKey }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || '保存失败');
      setMessage('AI 配置已保存');
      setApiKey('');
      setClearApiKey(false);
      await refreshConfig();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleFetchModels = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/ai-recommend/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: aiConfig.baseUrl, apiKey }),
      });
      const data = (await response.json()) as {
        error?: string;
        models?: string[];
      };
      if (!response.ok) throw new Error(data.error || '连接失败');
      setModels(data.models || []);
      setMessage(
        data.models?.length
          ? `已获取 ${data.models.length} 个模型，可从输入框选择或手动填写`
          : '连接成功，服务未返回模型列表，可手动填写模型名'
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '连接失败');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className='space-y-5'>
      <div className='flex items-center justify-between gap-4 border-b border-gray-200 pb-4 dark:border-gray-700'>
        <div>
          <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
            启用 AI 智能助手
          </h4>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            仅登录用户可见。密钥会加密保存，读取配置时不会返回明文。
          </p>
        </div>
        <button
          type='button'
          aria-pressed={aiConfig.enabled}
          onClick={() => updateConfig({ enabled: !aiConfig.enabled })}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
            aiConfig.enabled ? 'bg-green-600' : 'bg-gray-200 dark:bg-gray-700'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              aiConfig.enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <div className='grid gap-4 sm:grid-cols-2'>
        <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          CLIProxyAPI 地址
          <input
            type='url'
            value={aiConfig.baseUrl}
            onChange={(event) => updateConfig({ baseUrl: event.target.value })}
            placeholder='http://cli-proxy-api:8317/v1'
            className='mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          />
        </label>
        <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          默认模型
          <div className='mt-1 flex gap-2'>
            <input
              value={aiConfig.model}
              onChange={(event) => updateConfig({ model: event.target.value })}
              placeholder='gpt-5-mini 或 o3'
              className='min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
            />
            <button
              type='button'
              disabled={models.length === 0}
              onClick={() => setIsModelPickerOpen(true)}
              title={models.length ? '选择已获取的模型' : '请先获取模型'}
              className='inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
              aria-label='选择已获取的模型'
            >
              <ChevronDown className='h-4 w-4' />
            </button>
          </div>
        </label>
        <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          AI_API_KEY
          <input
            type='password'
            autoComplete='new-password'
            value={apiKey}
            disabled={clearApiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setClearApiKey(false);
            }}
            placeholder={
              aiConfig.apiKeyConfigured
                ? '已配置，留空保持不变'
                : '输入 API Key'
            }
            className='mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          />
          {aiConfig.apiKeyConfigured && (
            <label className='mt-2 flex items-center gap-2 text-xs font-normal text-gray-600 dark:text-gray-400'>
              <input
                type='checkbox'
                checked={clearApiKey}
                onChange={(event) => setClearApiKey(event.target.checked)}
                className='h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500'
              />
              移除已保存的密钥
            </label>
          )}
        </label>
      </div>

      <label className='block text-sm font-medium text-gray-700 dark:text-gray-300'>
        系统提示词
        <textarea
          rows={5}
          maxLength={8000}
          value={aiConfig.systemPrompt}
          onChange={(event) =>
            updateConfig({ systemPrompt: event.target.value })
          }
          className='mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
        />
      </label>

      <label className='block max-w-52 text-sm font-medium text-gray-700 dark:text-gray-300'>
        最大生成 Token
        <input
          type='number'
          min={128}
          max={8192}
          value={aiConfig.maxCompletionTokens}
          onChange={(event) =>
            updateConfig({ maxCompletionTokens: Number(event.target.value) })
          }
          className='mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
        />
      </label>

      {message && (
        <p className='text-sm text-gray-600 dark:text-gray-300'>{message}</p>
      )}

      <div className='flex flex-wrap justify-end gap-2'>
        <button
          type='button'
          disabled={testing}
          onClick={handleFetchModels}
          className='inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
        >
          <PlugZap className='h-4 w-4' />
          {testing ? '获取中...' : '获取模型'}
        </button>
        <button
          type='button'
          disabled={saving}
          onClick={handleSave}
          className='inline-flex items-center gap-1.5 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-400'
        >
          <Save className='h-4 w-4' />
          {saving ? '保存中...' : '保存 AI 配置'}
        </button>
      </div>

      {isModelPickerOpen && (
        <div className='fixed inset-0 z-[1100] flex items-end bg-black/30 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4'>
          <button
            type='button'
            aria-label='关闭模型选择'
            className='absolute inset-0 cursor-default'
            onClick={() => setIsModelPickerOpen(false)}
          />
          <section
            role='dialog'
            aria-modal='true'
            aria-label='选择 AI 模型'
            className='relative flex max-h-[70dvh] w-full flex-col bg-white shadow-2xl dark:bg-gray-900 sm:max-w-md sm:rounded-lg'
          >
            <header className='flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700'>
              <h3 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                选择模型
              </h3>
              <button
                type='button'
                title='关闭模型选择'
                aria-label='关闭模型选择'
                onClick={() => setIsModelPickerOpen(false)}
                className='rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
              >
                <X className='h-5 w-5' />
              </button>
            </header>
            <div className='overflow-y-auto overscroll-contain p-2'>
              {models.map((model) => (
                <button
                  key={model}
                  type='button'
                  onClick={() => {
                    updateConfig({ model });
                    setIsModelPickerOpen(false);
                  }}
                  className={`w-full rounded-md px-3 py-3 text-left text-sm transition-colors ${
                    aiConfig.model === model
                      ? 'bg-emerald-50 font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
                      : 'text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {model}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default AIRecommendConfig;
