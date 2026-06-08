import { ProcessedTweet } from './types';
import { getConfig } from './config';

export async function fetchTweetImage(tweet: ProcessedTweet): Promise<Buffer | null> {
  const config = getConfig();

  if (!config.xToImageApiUrl) {
    return null;
  }

  try {
    const url = new URL('/api/convert', config.xToImageApiUrl);
    url.searchParams.set('url', tweet.url);
    url.searchParams.set('theme', config.xToImageApiTheme || 'dark');

    const headers: Record<string, string> = {};
    if (config.xToImageApiToken) {
      headers['Authorization'] = `Bearer ${config.xToImageApiToken}`;
    }

    const response = await fetch(url.toString(), { headers });

    if (!response.ok) {
      console.error(`X to Image API returned ${response.status}: ${response.statusText}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error(`Failed to fetch tweet image from X to Image API for ${tweet.id}:`, error);
    return null;
  }
}
