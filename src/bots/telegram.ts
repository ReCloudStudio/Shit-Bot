import { Telegraf } from 'telegraf';
import { ProcessedTweet } from '../types';
import { getConfig } from '../config';
import { formatTweetHTML } from '../filters';
import { renderTweetImage } from '../renderer';

let bot: Telegraf | null = null;

export function getTelegramBot(): Telegraf | null {
  return bot;
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

export async function sendToTelegram(tweet: ProcessedTweet, asImage?: boolean): Promise<boolean> {
  const config = getConfig();
  const sendImage = asImage ?? config.sendAsImage;

  if (!bot) {
    console.error('Telegram not initialized');
    return false;
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const message = formatTweetHTML(tweet);

      if (sendImage) {
        const imageBuffer = await renderTweetImage(tweet);
        if (imageBuffer) {
          await bot.telegram.sendPhoto(
            config.telegram.chatId,
            { source: imageBuffer },
            {
              caption: message.substring(0, 1024),
              parse_mode: 'HTML',
            }
          );
          console.log(`Sent tweet ${tweet.id} as image to Telegram`);
          return true;
        }
      }

      if (tweet.mediaUrls.length > 0 && tweet.mediaUrls[0]) {
        const mediaUrl = tweet.mediaUrls[0];
        const isVideo = mediaUrl.includes('.mp4') || mediaUrl.includes('video');

        if (isVideo) {
          await bot.telegram.sendVideo(config.telegram.chatId, mediaUrl, {
            caption: message,
            parse_mode: 'HTML',
          });
        } else {
          await bot.telegram.sendPhoto(config.telegram.chatId, mediaUrl, {
            caption: message,
            parse_mode: 'HTML',
          });
        }
      } else {
        await bot.telegram.sendMessage(config.telegram.chatId, message, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: false },
        });
      }

      console.log(`Sent tweet ${tweet.id} to Telegram`);
      return true;
    } catch (error) {
      console.error(`Attempt ${attempt}/3 failed for tweet ${tweet.id}:`, (error as Error).message);
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  console.error(`Failed to send tweet ${tweet.id} to Telegram after 3 attempts`);
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
