import { TwitterOpenApi, TwitterOpenApiClient } from 'twitter-openapi-typescript';
import { TweetApiUtilsData, UserApiUtilsData } from 'twitter-openapi-typescript/dist/src/models';
import { getConfig } from '../config';
import { Tweet, UserConfig } from '../types';

let client: TwitterOpenApiClient | null = null;
const userIdCache = new Map<string, string>();

export async function initTwitterClient(): Promise<boolean> {
  const config = getConfig();
  const { authToken, ct0 } = config.twitter;

  const api = new TwitterOpenApi();

  if (authToken && ct0) {
    try {
      client = await api.getClientFromCookies({
        ct0,
        auth_token: authToken,
      });
      console.log('Twitter API client initialized (cookie auth)');
      return true;
    } catch (error) {
      console.error('Failed to initialize Twitter client with cookies:', error);
      client = null;
    }
  }

  try {
    client = await api.getGuestClient();
    console.log('Twitter API client initialized (guest mode)');
    return true;
  } catch (error) {
    console.error('Failed to initialize Twitter guest client:', error);
    client = null;
    return false;
  }
}

export function getTwitterClient(): TwitterOpenApiClient | null {
  return client;
}

export async function getUserIdByUsername(username: string): Promise<string | null> {
  if (userIdCache.has(username)) {
    return userIdCache.get(username)!;
  }

  if (!client) {
    console.error('Twitter client not initialized');
    return null;
  }

  try {
    const response = await client.getUserApi().getUserByScreenName({ screenName: username });
    const user = response.data.user;
    if (!user) {
      console.warn(`User @${username} not found`);
      return null;
    }

    userIdCache.set(username, user.restId);
    return user.restId;
  } catch (error) {
    console.error(`Failed to get user ID for @${username}:`, error);
    return null;
  }
}

function extractMediaUrls(tweetData: TweetApiUtilsData): string[] {
  const urls: string[] = [];
  const legacy = tweetData.tweet.legacy;

  if (!legacy) return urls;

  const extendedEntities = legacy.extendedEntities;
  if (extendedEntities?.media) {
    for (const media of extendedEntities.media) {
      if (media.type === 'photo') {
        urls.push(media.mediaUrlHttps);
      } else if (media.type === 'video' || media.type === 'animated_gif') {
        const variants = media.videoInfo?.variants;
        if (variants && variants.length > 0) {
          const mp4Variant = variants
            .filter((v) => v.contentType === 'video/mp4')
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
          if (mp4Variant?.url) {
            urls.push(mp4Variant.url);
          }
        }
      }
    }
  }

  return urls;
}

function convertToTweet(tweetData: TweetApiUtilsData, userConfig: UserConfig): Tweet | null {
  const legacy = tweetData.tweet.legacy;
  const user = tweetData.user;

  if (!legacy || !user?.core) return null;

  const isRetweet = !!tweetData.retweeted || legacy.fullText.startsWith('RT @');
  const isReply = !!legacy.inReplyToStatusIdStr;

  const createdAt = new Date(legacy.createdAt);

  return {
    id: tweetData.tweet.restId || legacy.idStr,
    author: user.core.screenName,
    authorName: user.core.name || userConfig.displayName || user.core.screenName,
    content: legacy.fullText,
    url: `https://x.com/${user.core.screenName}/status/${tweetData.tweet.restId || legacy.idStr}`,
    publishedAt: createdAt,
    mediaUrls: extractMediaUrls(tweetData),
    isRetweet,
    isReply,
  };
}

export async function fetchTweetsForUser(userConfig: UserConfig): Promise<Tweet[]> {
  if (!client) {
    console.error('Twitter client not initialized');
    return [];
  }

  const config = getConfig();

  try {
    const userId = await getUserIdByUsername(userConfig.username);
    if (!userId) {
      console.warn(`Could not find user ID for @${userConfig.username}`);
      return [];
    }

    const response = await client.getTweetApi().getUserTweets({
      userId,
      count: config.maxPostsPerFetch,
    });

    const tweets: Tweet[] = [];

    for (const tweetData of response.data.data) {
      if (tweetData.promotedMetadata) continue;

      const tweet = convertToTweet(tweetData, userConfig);
      if (tweet) {
        tweets.push(tweet);
      }
    }

    return tweets;
  } catch (error) {
    console.error(`Error fetching tweets for @${userConfig.username}:`, error);
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
      console.log(`Fetched ${tweets.length} tweets from @${user.username}`);
    }
  }

  return results;
}
