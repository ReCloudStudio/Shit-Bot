import Parser from 'rss-parser';
import { Tweet, UserConfig } from '../types';
import { getConfig } from '../config';
import { isAlreadySent, isTooOld, markAsSent } from '../storage';

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'media'],
      ['description', 'description'],
    ],
  },
});

let currentInstanceIndex = 0;

function getNextInstance(): string {
  const config = getConfig();
  const instance = config.nitterInstances[currentInstanceIndex % config.nitterInstances.length];
  currentInstanceIndex++;
  return instance;
}

async function fetchWithFallback(username: string): Promise<any> {
  const config = getConfig();
  const errors: Error[] = [];

  for (let i = 0; i < config.nitterInstances.length; i++) {
    const instance = getNextInstance();
    const rssUrl = `${instance}/${username}/rss`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(rssUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; shit-bot/1.0)',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();
      const feed = await parser.parseString(text);
      console.log(`Successfully fetched from ${instance}`);
      return feed;
    } catch (error) {
      errors.push(error as Error);
      console.warn(`Failed to fetch from ${instance}: ${(error as Error).message}`);
    }
  }

  throw new Error(`All nitter instances failed for @${username}: ${errors.map(e => e.message).join(', ')}`);
}

function isErrorMessage(content: string): boolean {
  const errorPatterns = [
    'RSS reader not yet whitelist',
    'whitelist',
    'Please send an email',
  ];
  return errorPatterns.some(pattern => content.toLowerCase().includes(pattern.toLowerCase()));
}

export async function fetchTweetsForUser(user: UserConfig): Promise<Tweet[]> {
  const config = getConfig();

  try {
    const feed = await fetchWithFallback(user.username);
    const tweets: Tweet[] = [];

    for (const item of feed.items.slice(0, config.maxPostsPerFetch)) {
      const content = cleanContent(item.contentSnippet || item.content || '');
      
      if (isErrorMessage(content)) {
        console.warn(`Received whitelist error for @${user.username}, skipping`);
        continue;
      }

      const tweetId = extractTweetId(item.link || item.guid || '');
      
      if (isAlreadySent(tweetId)) {
        continue;
      }

      const rawUrl = item.link || '';
      const publishedDate = item.pubDate ? new Date(item.pubDate) : new Date();
      
      if (isNaN(publishedDate.getTime()) || isTooOld(publishedDate, config.maxTweetAgeMinutes)) {
        continue;
      }

      const tweet: Tweet = {
        id: tweetId,
        author: user.username,
        authorName: user.displayName || user.username,
        content: content,
        url: convertToTwitterUrl(rawUrl, user.username) || `https://x.com/${user.username}`,
        publishedAt: publishedDate,
        mediaUrls: extractMediaUrls(item),
        isRetweet: isRetweet(content),
        isReply: isReply(content),
      };

      tweets.push(tweet);
    }

    return tweets;
  } catch (error) {
    console.error(`Error fetching tweets for @${user.username}:`, error);
    return [];
  }
}

export async function fetchAllTweets(): Promise<Map<string, Tweet[]>> {
  const config = getConfig();
  const results = new Map<string, Tweet[]>();

  for (const user of config.users) {
    const tweets = await fetchTweetsForUser(user);
    results.set(user.username, tweets);
    
    if (tweets.length > 0) {
      console.log(`Fetched ${tweets.length} new tweets from @${user.username}`);
    }
  }

  return results;
}

function extractTweetId(url: string): string {
  const match = url.match(/status\/(\d+)/);
  if (match) return match[1];
  
  const nitterMatch = url.match(/\/([^\/]+)\/status\/(\d+)/);
  if (nitterMatch) return nitterMatch[2];
  
  const guidMatch = url.match(/(\d{10,})/);
  if (guidMatch) return guidMatch[1];
  
  return url;
}

function convertToTwitterUrl(nitterUrl: string, username: string): string {
  if (!nitterUrl || nitterUrl.includes('/rss')) {
    return '';
  }
  
  const statusMatch = nitterUrl.match(/\/status\/(\d+)/);
  if (statusMatch) {
    return `https://x.com/${username}/status/${statusMatch[1]}`;
  }
  
  return nitterUrl;
}

function cleanContent(content: string): string {
  return content
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function extractMediaUrls(item: any): string[] {
  const urls: string[] = [];

  if (item.media && item.media.$) {
    urls.push(item.media.$.url);
  }

  const content = item.content || '';
  const imgMatches = content.match(/<img[^>]+src="([^"]+)"/g);
  if (imgMatches) {
    for (const match of imgMatches) {
      const src = match.match(/src="([^"]+)"/);
      if (src && !src[1].includes('emoji') && !src[1].includes('profile_images')) {
        urls.push(src[1]);
      }
    }
  }

  const videoMatches = content.match(/<video[^>]+src="([^"]+)"/g);
  if (videoMatches) {
    for (const match of videoMatches) {
      const src = match.match(/src="([^"]+)"/);
      if (src) {
        urls.push(src[1]);
      }
    }
  }

  return urls;
}

function isRetweet(content: string): boolean {
  return content.includes('RT @') || content.startsWith('RT ');
}

function isReply(content: string): boolean {
  return content.startsWith('@') || content.includes('replying to');
}

export function markTweetsAsSent(tweets: Tweet[]): void {
  for (const tweet of tweets) {
    markAsSent(tweet.id);
  }
}

function extractUsername(url: string): string {
  const match = url.match(/nitter[^\/]*\/([^\/]+)/);
  return match ? match[1] : '';
}

export async function parseFeedItems(xmlContent: string): Promise<Tweet[]> {
  try {
    const feed = await parser.parseString(xmlContent);
    const tweets: Tweet[] = [];

    for (const item of feed.items) {
      const tweetId = extractTweetId(item.link || item.guid || '');

      if (isAlreadySent(tweetId)) {
        continue;
      }

      const username = extractUsername(item.link || '');
      const publishedDate = item.pubDate ? new Date(item.pubDate) : new Date();
      
      if (isNaN(publishedDate.getTime()) || isTooOld(publishedDate, getConfig().maxTweetAgeMinutes)) {
        continue;
      }

      const tweet: Tweet = {
        id: tweetId,
        author: username,
        authorName: username,
        content: cleanContent(item.contentSnippet || item.content || ''),
        url: convertToTwitterUrl(item.link || '', username) || `https://x.com/${username}`,
        publishedAt: publishedDate,
        mediaUrls: extractMediaUrls(item),
        isRetweet: isRetweet(item.content || ''),
        isReply: isReply(item.content || ''),
      };

      tweets.push(tweet);
    }

    return tweets;
  } catch (error) {
    console.error('Error parsing feed items:', error);
    return [];
  }
}
