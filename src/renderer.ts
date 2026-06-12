import { ProcessedTweet } from './types';
import { getConfig } from './config';
import { fetchTweetImage } from './xToImageApi';

export async function initRenderer(): Promise<boolean> {
  const config = getConfig();
  if (config.xToImageApiUrl) {
    console.log(`X to Image API 已配置: ${config.xToImageApiUrl}`);
  } else {
    console.log('未配置 X to Image API, 图片渲染已禁用');
  }
  return true;
}

export async function renderTweetImage(tweet: ProcessedTweet): Promise<Buffer | null> {
  const config = getConfig();

  if (config.xToImageApiUrl) {
    return fetchTweetImage(tweet);
  }

  return null;
}

export async function shutdownRenderer(): Promise<void> {
  console.log('渲染器已关闭');
}
