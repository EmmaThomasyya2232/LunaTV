'use client';

import { UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

const SESSION_ID_STORAGE_KEY = 'luna-online-session-id';

function getSessionId(): string {
  const existingId = localStorage.getItem(SESSION_ID_STORAGE_KEY);
  if (existingId) return existingId;

  const sessionId =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(SESSION_ID_STORAGE_KEY, sessionId);
  return sessionId;
}

interface OnlineUserIndicatorProps {
  compact?: boolean;
}

export const OnlineUserIndicator = ({
  compact = false,
}: OnlineUserIndicatorProps) => {
  const [onlineUsers, setOnlineUsers] = useState<number | null>(null);

  useEffect(() => {
    if (!getAuthInfoFromBrowserCookie()?.username) return;

    const sessionId = getSessionId();
    let cancelled = false;

    const updatePresence = async () => {
      try {
        const response = await fetch('/api/online', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        if (!response.ok) return;

        const data = (await response.json()) as { onlineUsers: number };
        if (!cancelled) setOnlineUsers(data.onlineUsers);
      } catch {
        return;
      }
    };

    void updatePresence();
    const intervalId = window.setInterval(updatePresence, 30_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void updatePresence();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  if (onlineUsers === null) return null;

  return (
    <div
      aria-live='polite'
      className={`inline-flex h-8 items-center rounded-md text-xs font-medium text-emerald-700 dark:text-emerald-300 ${
        compact ? 'w-7 justify-center gap-1' : 'gap-1.5 px-2'
      }`}
      title='当前登录在线用户数'
    >
      <span className='h-2 w-2 rounded-full bg-emerald-500' />
      {compact ? (
        <span>{onlineUsers}</span>
      ) : (
        <>
          <UsersRound className='h-4 w-4' aria-hidden='true' />
          <span>{onlineUsers} 人在线</span>
        </>
      )}
    </div>
  );
};
