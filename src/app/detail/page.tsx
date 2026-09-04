'use client';

import { ArrowLeft, Play, Star } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import PageLayout from '@/components/PageLayout';
import { getDoubanDetails } from '@/lib/douban.client';
import { processImageUrl } from '@/lib/utils';

type Detail = {
  title: string;
  poster: string;
  rate: string;
  year: string;
  directors?: string[];
  cast?: string[];
  genres?: string[];
  countries?: string[];
  languages?: string[];
  episodes?: number;
  episode_length?: number;
  first_aired?: string;
  plot_summary?: string;
};

function DetailPageClient() {
  const searchParams = useSearchParams();
  const title = searchParams.get('title') || '影视详情';
  const poster = searchParams.get('poster') || '';
  const year = searchParams.get('year') || '';
  const rate = searchParams.get('rate') || '';
  const doubanId = searchParams.get('douban_id') || '';
  const [detail, setDetail] = useState<Detail>({ title, poster, year, rate });
  const [isLoading, setIsLoading] = useState(Boolean(doubanId));

  useEffect(() => {
    if (!/^\d+$/.test(doubanId)) return;
    let cancelled = false;

    getDoubanDetails(doubanId)
      .then((result) => {
        if (!cancelled && result.code === 200 && result.data) {
          setDetail((current) => ({ ...current, ...result.data }));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [doubanId]);

  const playParams = new URLSearchParams();
  ['title', 'source', 'id', 'year', 'prefer', 'stitle', 'stype'].forEach(
    (key) => {
      const value = searchParams.get(key);
      if (value) playParams.set(key, value);
    }
  );
  const playUrl = `/play?${playParams.toString()}`;

  return (
    <PageLayout activePath='/detail'>
      <main className='mx-auto max-w-5xl px-4 py-6 sm:px-10 sm:py-10'>
        <Link
          href='/'
          className='mb-6 inline-flex items-center gap-1.5 text-sm text-gray-600 transition-colors hover:text-emerald-700 dark:text-gray-300 dark:hover:text-emerald-300'
        >
          <ArrowLeft className='h-4 w-4' />
          返回浏览
        </Link>

        <section className='grid gap-6 sm:grid-cols-[220px_1fr] sm:gap-8'>
          <div className='mx-auto w-full max-w-[220px]'>
            {detail.poster ? (
              <Image
                src={processImageUrl(detail.poster)}
                alt={detail.title}
                width={440}
                height={660}
                className='aspect-[2/3] w-full rounded-lg object-cover shadow-lg'
              />
            ) : (
              <div className='aspect-[2/3] w-full rounded-lg bg-gray-200 dark:bg-gray-800' />
            )}
          </div>

          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-3'>
              <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100 sm:text-3xl'>
                {detail.title}
              </h1>
              {detail.rate && (
                <span className='inline-flex items-center gap-1 text-sm font-medium text-amber-600 dark:text-amber-400'>
                  <Star className='h-4 w-4 fill-current' />
                  {detail.rate}
                </span>
              )}
            </div>

            <p className='mt-3 text-sm text-gray-500 dark:text-gray-400'>
              {[
                detail.year,
                detail.countries?.join(' / '),
                detail.genres?.join(' / '),
              ]
                .filter(Boolean)
                .join(' · ') || '影视信息加载中'}
            </p>

            <Link
              href={playUrl}
              className='mt-6 inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700'
            >
              <Play className='h-4 w-4 fill-current' />
              登录后播放
            </Link>

            {isLoading ? (
              <div className='mt-8 h-24 animate-pulse rounded-md bg-gray-100 dark:bg-gray-800' />
            ) : (
              <div className='mt-8 space-y-5 text-sm leading-7 text-gray-700 dark:text-gray-300'>
                {detail.plot_summary && <p>{detail.plot_summary}</p>}
                {(detail.directors?.length || detail.cast?.length) && (
                  <dl className='grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]'>
                    {detail.directors?.length && (
                      <>
                        <dt className='text-gray-500 dark:text-gray-400'>
                          导演
                        </dt>
                        <dd>{detail.directors.join(' / ')}</dd>
                      </>
                    )}
                    {detail.cast?.length && (
                      <>
                        <dt className='text-gray-500 dark:text-gray-400'>
                          主演
                        </dt>
                        <dd>{detail.cast.join(' / ')}</dd>
                      </>
                    )}
                  </dl>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </PageLayout>
  );
}

export default function DetailPage() {
  return (
    <Suspense
      fallback={<div className='min-h-screen bg-white dark:bg-black' />}
    >
      <DetailPageClient />
    </Suspense>
  );
}
