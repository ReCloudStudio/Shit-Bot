import WebSocket from 'ws';
import { ProcessedTweet, OneBotConfig } from '@/types';
import { getConfig } from '@/config';
import { formatContentForPlatform } from '@/filters';
import { renderTweetImage } from '@/renderer';
import { getCachedImage } from '@/storage';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let messageId = 1;
let connected = false;

type MessageHandler = (message: OneBotMessage) => void | Promise<void>;
let messageHandler: MessageHandler | null = null;

export interface OneBotMessage {
  message_id: number;
  group_id?: number;
  user_id: number;
  message: string;
  raw_message?: string;
  sender?: {
    user_id: number;
    nickname?: string;
    card?: string;
  };
}

function callWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number = 15000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('请求超时')), timeoutMs);
    fn()
      .then((result) => { clearTimeout(timer); resolve(result); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

async function sendAction(action: string, params: Record<string, any> = {}): Promise<any> {
  const config = getConfig();
  const url = new URL(action, config.onebot.url);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.onebot.token) {
    headers['Authorization'] = `Bearer ${config.onebot.token}`;
  }

  const response = await callWithTimeout(() =>
    fetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, params }),
    }),
  );

  const data = await response.json() as any;
  if (data.retcode !== 0) {
    throw new Error(`OneBot API 错误: ${data.message || data.wording || data.retcode}`);
  }
  return data.data;
}

export async function sendToOneBot(
  tweet: ProcessedTweet,
  groupId: number,
  asImage: boolean = false,
  preRenderedImage?: Buffer | null,
  approvalId?: string,
): Promise<number | null> {
  const config = getConfig();
  const sendImage = asImage || config.sendAsImage;

  let imageBuffer: Buffer | null = preRenderedImage || null;

  if (sendImage && !imageBuffer) {
    imageBuffer = getCachedImage(tweet.id) || await renderTweetImage(tweet);
  }

  try {
    if (imageBuffer) {
      const base64 = imageBuffer.toString('base64');
      const imageSeg = `[CQ:image,file=base64://${base64}]`;
      const text = formatContentForPlatform(tweet.content, 'onebot');
      const footer = approvalId ? `\n\nID: ${approvalId}` : '';
      const msg = `${imageSeg}\n${text}${footer}`;

      const result = await sendAction('send_group_msg', {
        group_id: groupId,
        message: msg,
      });
      return result?.message_id || null;
    } else {
      const text = formatContentForPlatform(tweet.content, 'onebot');
      const link = `\n\n🔗 ${tweet.url}`;
      const footer = approvalId ? `\n\nID: ${approvalId}` : '';
      const msg = `${text}${link}${footer}`;

      const result = await sendAction('send_group_msg', {
        group_id: groupId,
        message: msg,
      });
      return result?.message_id || null;
    }
  } catch (error) {
    console.error(`[OneBot] 发送到群组 ${groupId} 失败:`, error);
    return null;
  }
}

export async function sendTextToOneBot(text: string, groupId: number): Promise<number | null> {
  try {
    const result = await sendAction('send_group_msg', {
      group_id: groupId,
      message: text,
    });
    return result?.message_id || null;
  } catch (error) {
    console.error(`[OneBot] 发送文本到群组 ${groupId} 失败:`, error);
    return null;
  }
}

export async function deleteOneBotMessage(messageId: number, groupId: number): Promise<boolean> {
  try {
    await sendAction('delete_msg', { message_id: messageId });
    return true;
  } catch (error) {
    console.error(`[OneBot] 撤回消息 ${messageId} 失败:`, error);
    return false;
  }
}

function connect(): void {
  const config = getConfig();
  if (!config.onebot.enabled || !config.onebot.url) return;

  const wsUrl = config.onebot.url.replace(/^http/, 'ws');
  console.log(`[OneBot] 正在连接 ${wsUrl}`);

  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    connected = true;
    console.log('[OneBot] WebSocket 已连接');

    if (config.onebot.secret) {
      const auth = { type: 'signal', op: 1, body: { token: config.onebot.secret } };
      ws!.send(JSON.stringify(auth));
    }

    heartbeatTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);
  });

  ws.on('message', (data) => {
    try {
      const event = JSON.parse(data.toString());
      if (event.message_type === 'group' && event.raw_message) {
        const msg: OneBotMessage = {
          message_id: event.message_id,
          group_id: event.group_id,
          user_id: event.user_id,
          message: event.message,
          raw_message: event.raw_message,
          sender: event.sender,
        };
        messageHandler?.(msg);
      }
    } catch {}
  });

  ws.on('close', () => {
    connected = false;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    console.log('[OneBot] WebSocket 已断开');
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[OneBot] WebSocket 错误:', err.message);
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  const interval = getConfig().onebot.reconnectInterval || 5000;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, interval);
}

export async function initOneBot(): Promise<boolean> {
  const config = getConfig();
  if (!config.onebot.enabled) {
    console.log('[OneBot] 已在配置中禁用');
    return false;
  }

  if (!config.onebot.url) {
    console.error('[OneBot] 未配置 URL');
    return false;
  }

  connect();
  return true;
}

export function setOneBotMessageHandler(handler: MessageHandler): void {
  messageHandler = handler;
}

export function isOneBotConnected(): boolean {
  return connected;
}

export function getOneBotMessageId(): number {
  return messageId++;
}

export async function shutdownOneBot(): Promise<void> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  connected = false;
  console.log('[OneBot] 已断开连接');
}
