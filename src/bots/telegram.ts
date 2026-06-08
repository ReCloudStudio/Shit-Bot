import { Telegraf } from 'telegraf';
import { ProcessedTweet } from '../types';
import { getConfig } from '../config';
import { formatTweetHTML, escapeHTML } from '../filters';
import { renderTweetImage } from '../renderer';

let bot: Telegraf | null = null;

function callWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number = 15000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export function getTelegramBot(): Telegraf | null {
  return bot;
}

function buildAgentOpts(): { httpsAgent?: any; fetch?: any } | undefined {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxy) return undefined;

  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    return { httpsAgent: new HttpsProxyAgent(proxy) };
  } catch {
    console.warn('https-proxy-agent not installed, proxy will not be used');
    return undefined;
  }
}

export async function initTelegram(): Promise<boolean> {
  const config = getConfig();

  if (!config.telegram.enabled) {
    console.log('Telegram is disabled in config');
    return false;
  }

  try {
    const options: any = {};
    if (config.telegram.apiRoot) {
      options.telegram = { apiRoot: config.telegram.apiRoot };
    }

    const agentOpts = buildAgentOpts();
    if (agentOpts) {
      Object.assign(options.telegram || (options.telegram = {}), agentOpts);
    }

    bot = new Telegraf(config.telegram.token, options);

    bot.catch((err) => {
      console.error('Telegram bot error:', err);
    });

    await bot.telegram.getMe();
    console.log('Telegram bot connected');
    return true;
  } catch (error) {
    console.error('Failed to initialize Telegram:', error);
    bot = null;
    return false;
  }
}

export async function sendToTelegram(tweet: ProcessedTweet, targetChatId?: string, asImage?: boolean, preRenderedImage?: Buffer): Promise<boolean> {
  const config = getConfig();
  const sendImage = asImage ?? config.sendAsImage;
  const chatId = targetChatId || config.telegram.chatId;

  if (!bot) {
    console.error('Telegram not initialized');
    return false;
  }

  const message = formatTweetHTML(tweet);

  if (sendImage) {
    const imageSent = await trySendImage(chatId, tweet, message, preRenderedImage);
    if (imageSent) return true;
    console.warn(`Image send failed for tweet ${tweet.id}, falling back to text`);
  }

  if (tweet.mediaUrls.length > 0 && tweet.mediaUrls[0]) {
    const mediaSent = await trySendMedia(chatId, tweet, tweet.mediaUrls[0], message);
    if (mediaSent) return true;
  }

  const textSent = await trySendText(chatId, message, `tweet ${tweet.id}`);
  if (textSent) return true;

  console.error(`Failed to send tweet ${tweet.id} to Telegram after all attempts`);
  return false;
}

async function trySendImage(chatId: string, tweet: ProcessedTweet, message: string, preRenderedImage?: Buffer): Promise<boolean> {
  if (!bot) return false;

  const imageBuffer = preRenderedImage || await renderTweetImage(tweet);
  if (!imageBuffer) return false;

  const caption = `<b>@${escapeHTML(tweet.author)}</b>\n<a href="${tweet.url}">🔗 View on X</a>`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await callWithTimeout(() => bot!.telegram.sendPhoto(
        chatId,
        { source: imageBuffer },
        { caption, parse_mode: 'HTML' }
      ));
      console.log(`Sent tweet ${tweet.id} as image to Telegram (${chatId})`);
      return true;
    } catch (error) {
      console.error(`Image attempt ${attempt}/3 failed for tweet ${tweet.id}:`, (error as Error).message);
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
      }
    }
  }
  return false;
}

async function trySendMedia(chatId: string, tweet: ProcessedTweet, mediaUrl: string, message: string): Promise<boolean> {
  if (!bot) return false;

  const isVideo = mediaUrl.includes('.mp4') || mediaUrl.includes('video');

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (isVideo) {
        await callWithTimeout(() => bot!.telegram.sendVideo(chatId, mediaUrl, {
          caption: message.substring(0, 1024),
          parse_mode: 'HTML',
        }));
      } else {
        await callWithTimeout(() => bot!.telegram.sendPhoto(chatId, mediaUrl, {
          caption: message.substring(0, 1024),
          parse_mode: 'HTML',
        }));
      }
      console.log(`Sent tweet ${tweet.id} with media to Telegram (${chatId})`);
      return true;
    } catch (error) {
      console.error(`Media attempt ${attempt}/3 failed for tweet ${tweet.id}:`, (error as Error).message);
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
      }
    }
  }
  return false;
}

async function trySendText(chatId: string, message: string, label: string): Promise<boolean> {
  if (!bot) return false;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await callWithTimeout(() => bot!.telegram.sendMessage(chatId, message, {
        parse_mode: 'HTML',
      }));
      console.log(`Sent ${label} as text to Telegram (${chatId})`);
      return true;
    } catch (error) {
      console.error(`Text attempt ${attempt}/3 failed for ${label}:`, (error as Error).message);
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
      }
    }
  }
  return false;
}

export async function sendBatchToTelegram(tweets: ProcessedTweet[]): Promise<number> {
  let sent = 0;

  for (const tweet of tweets) {
    const success = await sendToTelegram(tweet);
    if (success) {
      sent++;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return sent;
}

export async function shutdownTelegram(): Promise<void> {
  if (bot) {
    bot.stop('Shutdown');
    bot = null;
    console.log('Telegram bot stopped');
  }
}
