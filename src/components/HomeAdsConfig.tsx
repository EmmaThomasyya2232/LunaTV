'use client';

import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  AdminConfig,
  HomeAdsConfig,
  HomeAdvertisement,
} from '@/lib/admin.types';

interface HomeAdsConfigProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

const emptyConfig: HomeAdsConfig = { enabled: false, items: [] };

function newAdvertisement(): HomeAdvertisement {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    title: '首页推广',
    description: '',
    imageUrl: '',
    linkUrl: '',
    audience: 'all',
    device: 'all',
  };
}

function toDateTimeLocal(timestamp?: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function toTimestamp(value: string): number | undefined {
  return value ? new Date(value).getTime() : undefined;
}

const HomeAdsConfig = ({ config, refreshConfig }: HomeAdsConfigProps) => {
  const [homeAds, setHomeAds] = useState<HomeAdsConfig>(emptyConfig);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setHomeAds(config?.HomeAds || emptyConfig);
  }, [config]);

  const updateAdvertisement = (
    id: string,
    changes: Partial<HomeAdvertisement>
  ) => {
    setHomeAds((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === id ? { ...item, ...changes } : item
      ),
    }));
  };

  const moveAdvertisement = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= homeAds.items.length) return;

    setHomeAds((current) => {
      const items = [...current.items];
      [items[index], items[targetIndex]] = [items[targetIndex], items[index]];
      return { ...current, items };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/home-ads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(homeAds),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || '保存失败');
      setMessage('广告配置已保存');
      await refreshConfig();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='space-y-5'>
      <div className='flex items-center justify-between gap-4 border-b border-gray-200 pb-4 dark:border-gray-700'>
        <div>
          <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
            启用首页广告
          </h4>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            仅在首页内容流展示，不会插入播放器。
          </p>
        </div>
        <button
          type='button'
          aria-pressed={homeAds.enabled}
          onClick={() =>
            setHomeAds((current) => ({
              ...current,
              enabled: !current.enabled,
            }))
          }
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
            homeAds.enabled ? 'bg-green-600' : 'bg-gray-200 dark:bg-gray-700'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              homeAds.enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <div className='flex items-center justify-between gap-3'>
        <p className='text-sm text-gray-600 dark:text-gray-300'>
          已配置 {homeAds.items.length}/12 条广告
        </p>
        <button
          type='button'
          disabled={homeAds.items.length >= 12}
          onClick={() =>
            setHomeAds((current) => ({
              ...current,
              items: [...current.items, newAdvertisement()],
            }))
          }
          className='inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-400'
        >
          <Plus className='h-4 w-4' />
          添加广告
        </button>
      </div>

      {homeAds.items.map((advertisement, index) => (
        <div
          key={advertisement.id}
          className='grid gap-4 border border-gray-200 p-4 dark:border-gray-700 sm:grid-cols-[180px_1fr]'
        >
          <div
            className='min-h-28 rounded-md bg-gray-100 bg-cover bg-center dark:bg-gray-700'
            style={
              advertisement.imageUrl
                ? { backgroundImage: `url(${advertisement.imageUrl})` }
                : undefined
            }
          />
          <div className='space-y-3'>
            <div className='flex items-center justify-between gap-3'>
              <div className='flex items-center gap-3'>
                <p className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                  广告 {index + 1}
                </p>
                <label className='inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300'>
                  <input
                    type='checkbox'
                    checked={advertisement.enabled}
                    onChange={(event) =>
                      updateAdvertisement(advertisement.id, {
                        enabled: event.target.checked,
                      })
                    }
                    className='h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500'
                  />
                  启用
                </label>
              </div>
              <div className='flex items-center gap-1'>
                <button
                  type='button'
                  title='上移广告'
                  aria-label='上移广告'
                  disabled={index === 0}
                  onClick={() => moveAdvertisement(index, -1)}
                  className='rounded-md p-1.5 text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700'
                >
                  <ChevronUp className='h-4 w-4' />
                </button>
                <button
                  type='button'
                  title='下移广告'
                  aria-label='下移广告'
                  disabled={index === homeAds.items.length - 1}
                  onClick={() => moveAdvertisement(index, 1)}
                  className='rounded-md p-1.5 text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700'
                >
                  <ChevronDown className='h-4 w-4' />
                </button>
                <button
                  type='button'
                  title='删除广告'
                  aria-label='删除广告'
                  onClick={() =>
                    setHomeAds((current) => ({
                      ...current,
                      items: current.items.filter(
                        (item) => item.id !== advertisement.id
                      ),
                    }))
                  }
                  className='rounded-md p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30'
                >
                  <Trash2 className='h-4 w-4' />
                </button>
              </div>
            </div>
            <div className='grid gap-3 sm:grid-cols-2'>
              <input
                value={advertisement.title}
                maxLength={100}
                placeholder='广告标题'
                onChange={(event) =>
                  updateAdvertisement(advertisement.id, {
                    title: event.target.value,
                  })
                }
                className='w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
              />
              <input
                value={advertisement.linkUrl}
                type='url'
                placeholder='跳转链接（https://）'
                onChange={(event) =>
                  updateAdvertisement(advertisement.id, {
                    linkUrl: event.target.value,
                  })
                }
                className='w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
              />
            </div>
            <input
              value={advertisement.imageUrl}
              type='url'
              placeholder='横幅图片链接（https://）'
              onChange={(event) =>
                updateAdvertisement(advertisement.id, {
                  imageUrl: event.target.value,
                })
              }
              className='w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
            />
            <textarea
              value={advertisement.description}
              maxLength={280}
              rows={2}
              placeholder='广告说明（可选）'
              onChange={(event) =>
                updateAdvertisement(advertisement.id, {
                  description: event.target.value,
                })
              }
              className='w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
            />
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
              <select
                value={advertisement.audience}
                onChange={(event) =>
                  updateAdvertisement(advertisement.id, {
                    audience: event.target
                      .value as HomeAdvertisement['audience'],
                  })
                }
                className='rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
              >
                <option value='all'>全部访客</option>
                <option value='loggedIn'>仅登录用户</option>
              </select>
              <select
                value={advertisement.device}
                onChange={(event) =>
                  updateAdvertisement(advertisement.id, {
                    device: event.target.value as HomeAdvertisement['device'],
                  })
                }
                className='rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
              >
                <option value='all'>全部设备</option>
                <option value='desktop'>仅桌面端</option>
                <option value='mobile'>仅移动端</option>
              </select>
              <label className='text-xs text-gray-600 dark:text-gray-300'>
                开始时间
                <input
                  type='datetime-local'
                  value={toDateTimeLocal(advertisement.startAt)}
                  onChange={(event) =>
                    updateAdvertisement(advertisement.id, {
                      startAt: toTimestamp(event.target.value),
                    })
                  }
                  className='mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                />
              </label>
              <label className='text-xs text-gray-600 dark:text-gray-300'>
                结束时间
                <input
                  type='datetime-local'
                  value={toDateTimeLocal(advertisement.endAt)}
                  onChange={(event) =>
                    updateAdvertisement(advertisement.id, {
                      endAt: toTimestamp(event.target.value),
                    })
                  }
                  className='mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                />
              </label>
            </div>
          </div>
        </div>
      ))}

      {message && (
        <p className='text-sm text-gray-600 dark:text-gray-300'>{message}</p>
      )}

      <div className='flex justify-end'>
        <button
          type='button'
          disabled={saving}
          onClick={handleSave}
          className='rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-400'
        >
          {saving ? '保存中…' : '保存广告配置'}
        </button>
      </div>
    </div>
  );
};

export default HomeAdsConfig;
