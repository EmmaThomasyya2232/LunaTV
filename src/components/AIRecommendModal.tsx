'use client';

import {
  ImagePlus,
  MessageCircleMore,
  Paperclip,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  image?: ImageAttachment;
};

type ImageAttachment = {
  dataUrl: string;
  name: string;
};

const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_STORED_MESSAGES = 40;
const CONVERSATION_DATABASE = 'lunatv-ai-conversations';
const CONVERSATION_STORE = 'conversations';
const CONVERSATION_LOCAL_STORAGE_PREFIX = 'lunatv-ai-conversation:';

const initialMessage: ChatMessage = {
  role: 'assistant',
  content: '想看什么类型的影视？我可以帮你找找。',
};

function getErrorMessage(payload: unknown): string {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    typeof payload.error === 'string'
  ) {
    return payload.error;
  }
  return 'AI 服务暂时不可用';
}

function openConversationDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CONVERSATION_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CONVERSATION_STORE)) {
        request.result.createObjectStore(CONVERSATION_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadConversation(key: string): Promise<ChatMessage[] | null> {
  const database = await openConversationDatabase();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(CONVERSATION_STORE, 'readonly')
      .objectStore(CONVERSATION_STORE)
      .get(key);
    request.onsuccess = () => {
      database.close();
      resolve(Array.isArray(request.result) ? request.result : null);
    };
    request.onerror = () => {
      database.close();
      reject(request.error);
    };
  });
}

function loadLocalConversation(key: string): ChatMessage[] | null {
  try {
    const value = localStorage.getItem(`${CONVERSATION_LOCAL_STORAGE_PREFIX}${key}`);
    const messages = value ? JSON.parse(value) : null;
    return Array.isArray(messages) ? messages : null;
  } catch {
    return null;
  }
}

function saveLocalConversation(key: string, messages: ChatMessage[]) {
  try {
    const textOnlyMessages = messages.map(({ image: _image, ...message }) => message);
    localStorage.setItem(
      `${CONVERSATION_LOCAL_STORAGE_PREFIX}${key}`,
      JSON.stringify(textOnlyMessages)
    );
  } catch {
    return;
  }
}

async function saveConversation(key: string, messages: ChatMessage[]) {
  const database = await openConversationDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(CONVERSATION_STORE, 'readwrite');
    transaction.objectStore(CONVERSATION_STORE).put(messages, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

function createRequestMessages(messages: ChatMessage[]) {
  return messages.map((message) => {
    if (!message.image) return { role: message.role, content: message.content };
    return {
      role: message.role,
      content: [
        { type: 'text', text: message.content },
        { type: 'image_url', image_url: { url: message.image.dataUrl } },
      ],
    };
  });
}

function getImageAttachment(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve({ dataUrl: reader.result, name: file.name || 'pasted-image' });
      } else {
        reject(new Error('读取图片失败，请重试'));
      }
    };
    reader.onerror = () => reject(new Error('读取图片失败，请重试'));
    reader.readAsDataURL(file);
  });
}

const AIRecommendModal = () => {
  const pathname = usePathname();
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [conversationKey, setConversationKey] = useState<string | null>(null);
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage]);
  const [image, setImage] = useState<ImageAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    const authInfo = getAuthInfoFromBrowserCookie();
    setIsAuthenticated(Boolean(authInfo));
    setIsEnabled(
      Boolean(
        (
          window as Window & {
            RUNTIME_CONFIG?: { ENABLE_AI_RECOMMEND?: boolean };
          }
        ).RUNTIME_CONFIG?.ENABLE_AI_RECOMMEND
      )
    );
    const key = `conversation:${authInfo?.username || 'local-user'}`;
    let cancelled = false;
    const localHistory = loadLocalConversation(key);
    const historyPromise = localHistory
      ? Promise.resolve(localHistory)
      : loadConversation(key);
    void historyPromise
      .then((history) => {
        if (!cancelled && history?.length) setMessages(history);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setConversationKey(key);
          setHasLoadedHistory(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!conversationKey || !hasLoadedHistory) return;
    const storedMessages = messages.slice(-MAX_STORED_MESSAGES);
    saveLocalConversation(conversationKey, storedMessages);
    void saveConversation(conversationKey, storedMessages).catch(() => undefined);
  }, [conversationKey, hasLoadedHistory, messages]);

  useEffect(() => {
    if (!isOpen || !shouldAutoScrollRef.current) return;
    const animationFrame = requestAnimationFrame(() => {
      const messageList = messageListRef.current;
      if (messageList) messageList.scrollTop = messageList.scrollHeight;
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [isOpen, messages]);

  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isStreaming) setIsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isStreaming]);

  const updateAssistantMessage = (content: string) => {
    setMessages((current) => [
      ...current.slice(0, -1),
      { role: 'assistant', content },
    ]);
  };

  const attachImage = async (file: File) => {
    if (
      !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(
        file.type
      )
    ) {
      setAttachmentError('仅支持 JPG、PNG、WebP 或 GIF 图片');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setAttachmentError('图片不能超过 2 MB');
      return;
    }

    try {
      setImage(await getImageAttachment(file));
      setAttachmentError(null);
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : '读取图片失败，请重试'
      );
    }
  };

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void attachImage(file);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageItem = Array.from(event.clipboardData.items).find((item) =>
      item.type.startsWith('image/')
    );
    const file = imageItem?.getAsFile();
    if (!file) return;

    event.preventDefault();
    void attachImage(file);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = input.trim() || (image ? '请分析这张图片。' : '');
    if (!question || isStreaming) return;

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: 'user', content: question, image: image || undefined },
    ];
    shouldAutoScrollRef.current = true;
    setMessages([...nextMessages, { role: 'assistant', content: '' }]);
    setInput('');
    setImage(null);
    setAttachmentError(null);
    setIsStreaming(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    let answer = '';

    try {
      const response = await fetch('/api/ai-recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: createRequestMessages(nextMessages),
          context: `用户正在浏览 ${pathname}`,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(
          getErrorMessage(await response.json().catch(() => null))
        );
      }

      const contentType = response.headers.get('Content-Type') || '';
      if (contentType.includes('application/json')) {
        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        answer = payload.choices?.[0]?.message?.content || 'AI 未返回内容';
        updateAssistantMessage(answer);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('AI 服务未返回可读取内容');

      const decoder = new TextDecoder();
      let buffer = '';
      let isComplete = false;
      while (!isComplete) {
        const { done, value } = await reader.read();
        if (done) {
          isComplete = true;
          continue;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const payload = line.trim();
          if (!payload.startsWith('data:')) continue;
          const data = payload.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const chunk = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const content = chunk.choices?.[0]?.delta?.content;
            if (content) {
              answer += content;
              updateAssistantMessage(answer);
            }
          } catch {
            continue;
          }
        }
      }

      if (!answer) updateAssistantMessage('AI 未返回内容');
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'AbortError'
          ? answer || '已停止生成'
          : error instanceof Error
          ? error.message
          : 'AI 服务暂时不可用';
      updateAssistantMessage(message);
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
    }
  };

  const stopStreaming = () => abortControllerRef.current?.abort();

  if (!isAuthenticated || !isEnabled) return null;

  return (
    <>
      <button
        type='button'
        title='AI 智能助手'
        aria-label='AI 智能助手'
        onClick={() => setIsOpen(true)}
        className='inline-flex h-10 w-10 items-center justify-center rounded-full text-emerald-700 transition-colors hover:bg-emerald-100/70 dark:text-emerald-300 dark:hover:bg-emerald-900/30'
      >
        <MessageCircleMore className='h-5 w-5' aria-hidden='true' />
      </button>

      {isOpen && (
        <div className='fixed inset-0 z-[1100] bg-black/30 backdrop-blur-sm sm:flex sm:items-center sm:justify-center sm:p-4'>
          <section
            role='dialog'
            aria-modal='true'
            aria-label='AI 智能助手'
            className='fixed inset-0 flex h-[100svh] min-h-[100dvh] w-full flex-col bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl dark:bg-gray-900 sm:relative sm:h-[min(680px,85vh)] sm:min-h-0 sm:max-w-xl sm:rounded-lg sm:pb-0'
          >
            <header className='flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700'>
              <h2 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                AI 智能助手
              </h2>
              <div className='flex items-center gap-1'>
                <button
                  type='button'
                  title='清除对话'
                  aria-label='清除对话'
                  disabled={isStreaming}
                  onClick={() => setMessages([initialMessage])}
                  className='rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800'
                >
                  <Trash2 className='h-4 w-4' />
                </button>
                <button
                  type='button'
                  title='关闭 AI 助手'
                  aria-label='关闭 AI 助手'
                  onClick={() => setIsOpen(false)}
                  className='rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                >
                  <X className='h-5 w-5' />
                </button>
              </div>
            </header>

            <div
              ref={messageListRef}
              className='flex-1 space-y-3 overflow-y-auto overscroll-contain p-4'
              onScroll={(event) => {
                const messageList = event.currentTarget;
                const remainingScroll =
                  messageList.scrollHeight -
                  messageList.scrollTop -
                  messageList.clientHeight;
                shouldAutoScrollRef.current = remainingScroll < 72;
              }}
            >
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`max-w-[88%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-6 ${
                    message.role === 'user'
                      ? 'ml-auto bg-emerald-600 text-white'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100'
                  }`}
                >
                  {message.image && (
                    <div
                      role='img'
                      aria-label={message.image.name}
                      className='mb-2 h-40 w-full rounded-md bg-cover bg-center'
                      style={{
                        backgroundImage: `url(${message.image.dataUrl})`,
                      }}
                    />
                  )}
                  {message.content || (isStreaming ? '正在思考...' : '')}
                </div>
              ))}
            </div>

            <div className='border-t border-gray-200 p-3 dark:border-gray-700'>
              <div className='mb-2 flex gap-2 overflow-x-auto pb-1'>
                {['推荐一部电影', '最近有什么好剧', '适合周末看的作品'].map(
                  (suggestion) => (
                    <button
                      key={suggestion}
                      type='button'
                      disabled={isStreaming}
                      onClick={() => setInput(suggestion)}
                      className='shrink-0 rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-600 transition-colors hover:border-emerald-500 hover:text-emerald-700 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:text-emerald-300'
                    >
                      {suggestion}
                    </button>
                  )
                )}
              </div>
              <form onSubmit={handleSubmit} className='flex items-end gap-2'>
                <input
                  ref={fileInputRef}
                  type='file'
                  accept='image/jpeg,image/png,image/webp,image/gif'
                  onChange={handleImageChange}
                  className='sr-only'
                />
                <button
                  type='button'
                  title='添加图片'
                  aria-label='添加图片'
                  disabled={isStreaming}
                  onClick={() => fileInputRef.current?.click()}
                  className='inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'
                >
                  <Paperclip className='h-4 w-4' />
                </button>
                <textarea
                  value={input}
                  maxLength={4000}
                  rows={2}
                  disabled={isStreaming}
                  onChange={(event) => setInput(event.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={
                    image ? '补充图片说明（可选）' : '输入想看的内容'
                  }
                  className='min-h-10 flex-1 resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                />
                {isStreaming ? (
                  <button
                    type='button'
                    title='停止生成'
                    aria-label='停止生成'
                    onClick={stopStreaming}
                    className='inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-700 text-white transition-colors hover:bg-gray-800'
                  >
                    <Square className='h-4 w-4 fill-current' />
                  </button>
                ) : (
                  <button
                    type='submit'
                    title='发送消息'
                    aria-label='发送消息'
                    disabled={!input.trim() && !image}
                    className='inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-400'
                  >
                    <Send className='h-4 w-4' />
                  </button>
                )}
              </form>
              {(image || attachmentError) && (
                <div className='mt-2 flex items-center gap-2 text-xs'>
                  {image && (
                    <div className='flex min-w-0 items-center gap-2 text-gray-600 dark:text-gray-300'>
                      <ImagePlus className='h-4 w-4 shrink-0' />
                      <span className='truncate'>{image.name}</span>
                      <button
                        type='button'
                        title='移除图片'
                        aria-label='移除图片'
                        onClick={() => setImage(null)}
                        className='rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800'
                      >
                        <X className='h-3.5 w-3.5' />
                      </button>
                    </div>
                  )}
                  {attachmentError && (
                    <span className='text-red-600'>{attachmentError}</span>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
};

export default AIRecommendModal;
