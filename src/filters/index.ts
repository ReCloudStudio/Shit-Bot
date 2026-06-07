import { Tweet, FilterConfig, UserConfig, ProcessedTweet } from '../types';

export function applyFilters(tweet: Tweet, userConfig: UserConfig): ProcessedTweet {
  const filters = userConfig.filters;
  const reasons: string[] = [];
  let passed = true;

  if (!filters) {
    return {
      ...tweet,
      matchedUser: userConfig,
      passedFilters: true,
      filterReasons: [],
    };
  }

  if (filters.excludeRetweets && tweet.isRetweet) {
    passed = false;
    reasons.push('Is a retweet');
  }

  if (filters.excludeReplies && tweet.isReply) {
    passed = false;
    reasons.push('Is a reply');
  }

  if (filters.keywords) {
    const contentLower = tweet.content.toLowerCase();

    if (filters.keywords.include && filters.keywords.include.length > 0) {
      const hasIncludedKeyword = filters.keywords.include.some(
        (keyword) => contentLower.includes(keyword.toLowerCase())
      );
      if (!hasIncludedKeyword) {
        passed = false;
        reasons.push('Missing required keywords');
      }
    }

    if (filters.keywords.exclude && filters.keywords.exclude.length > 0) {
      const hasExcludedKeyword = filters.keywords.exclude.some(
        (keyword) => contentLower.includes(keyword.toLowerCase())
      );
      if (hasExcludedKeyword) {
        passed = false;
        reasons.push('Contains excluded keywords');
      }
    }
  }

  if (filters.media?.requireMedia && tweet.mediaUrls.length === 0) {
    passed = false;
    reasons.push('No media attached');
  }

  return {
    ...tweet,
    matchedUser: userConfig,
    passedFilters: passed,
    filterReasons: reasons,
  };
}

export function filterTweets(tweets: Tweet[], userConfig: UserConfig): ProcessedTweet[] {
  return tweets.map((tweet) => applyFilters(tweet, userConfig));
}

export function getPassedTweets(processedTweets: ProcessedTweet[]): ProcessedTweet[] {
  return processedTweets.filter((tweet) => tweet.passedFilters);
}

export function formatTweetMessage(tweet: ProcessedTweet): string {
  const lines: string[] = [];

  lines.push(`🐦 **@${tweet.author}** (${tweet.authorName})`);
  lines.push('');
  lines.push(tweet.content);
  lines.push('');
  lines.push(`🔗 ${tweet.url}`);
  lines.push(`📅 ${tweet.publishedAt.toLocaleString()}`);

  if (tweet.mediaUrls.length > 0) {
    lines.push(`📎 ${tweet.mediaUrls.length} media attachment(s)`);
  }

  return lines.join('\n');
}

export function formatTweetHTML(tweet: ProcessedTweet): string {
  const lines: string[] = [];

  lines.push(`<b>🐦 @${escapeHTML(tweet.author)}</b> (${escapeHTML(tweet.authorName)})`);
  lines.push('');
  lines.push(escapeHTML(tweet.content));
  lines.push('');
  lines.push(`<a href="${tweet.url}">🔗 View on X</a>`);
  lines.push(`📅 ${tweet.publishedAt.toLocaleString()}`);

  if (tweet.mediaUrls.length > 0) {
    lines.push(`📎 ${tweet.mediaUrls.length} media attachment(s)`);
  }

  return lines.join('\n');
}

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
