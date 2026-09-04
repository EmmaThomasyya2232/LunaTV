'use client';

import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';

import { HomeAdvertisement as HomeAdvertisementType } from '@/lib/admin.types';

function deviceClass(device: HomeAdvertisementType['device']): string {
  if (device === 'desktop') return 'hidden md:block';
  if (device === 'mobile') return 'block md:hidden';
  return 'block';
}

const HomeAdvertisement = () => {
  const [advertisements, setAdvertisements] = useState<HomeAdvertisementType[]>(
    []
  );
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const loadAdvertisements = async () => {
      try {
        const response = await fetch('/api/ads', { cache: 'no-store' });
        if (!response.ok) return;
        const data = (await response.json()) as {
          advertisements: HomeAdvertisementType[];
        };
        setAdvertisements(data.advertisements);
      } catch {
        return;
      }
    };

    void loadAdvertisements();
  }, []);

  useEffect(() => {
    if (advertisements.length < 2) return;
    const intervalId = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % advertisements.length);
    }, 8_000);
    return () => window.clearInterval(intervalId);
  }, [advertisements.length]);

  const advertisement = advertisements[activeIndex];
  if (!advertisement) return null;

  return (
    <section
      className={`mb-8 ${deviceClass(advertisement.device)}`}
      aria-label='推广'
    >
      <a
        href={advertisement.linkUrl}
        target='_blank'
        rel='noreferrer sponsored'
        className='group relative block min-h-36 overflow-hidden rounded-lg bg-gray-900 sm:min-h-44'
      >
        <div
          className='absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105'
          style={{ backgroundImage: `url(${advertisement.imageUrl})` }}
        />
        <div className='absolute inset-0 bg-black/45' />
        <div className='relative flex min-h-36 max-w-xl flex-col justify-end p-5 text-white sm:min-h-44 sm:p-6'>
          <span className='mb-2 text-xs font-medium text-white/80'>推广</span>
          <h2 className='text-xl font-bold'>{advertisement.title}</h2>
          {advertisement.description && (
            <p className='mt-1 line-clamp-2 text-sm text-white/90'>
              {advertisement.description}
            </p>
          )}
          <span className='mt-3 inline-flex items-center gap-1 text-sm font-medium'>
            查看详情
            <ExternalLink className='h-4 w-4' />
          </span>
        </div>
      </a>
    </section>
  );
};

export default HomeAdvertisement;
