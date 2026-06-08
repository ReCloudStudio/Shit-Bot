import { ProcessedTweet } from './types';
import { getConfig } from './config';
import { fetchTweetImage } from './xToImageApi';

export async function initRenderer(): Promise<boolean> {
  const config = getConfig();
  if (config.xToImageApiUrl) {
    console.log(`X to Image API configured: ${config.xToImageApiUrl}`);
  } else {
    console.log('No X to Image API configured, image rendering disabled');
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
  console.log('Renderer shutdown');
}
