export interface Tweet {
  id: string;
  author: string;
  authorName: string;
  content: string;
  url: string;
  publishedAt: Date;
  mediaUrls: string[];
  isRetweet: boolean;
  isReply: boolean;
}

export interface FilterConfig {
  keywords?: {
    include?: string[];
    exclude?: string[];
  };
  engagement?: {
    minLikes?: number;
    minRetweets?: number;
    minReplies?: number;
  };
  media?: {
    requireMedia?: boolean;
    allowedTypes?: ('image' | 'video' | 'gif')[];
  };
  excludeRetweets?: boolean;
  excludeReplies?: boolean;
}

export interface UserConfig {
  username: string;
  displayName?: string;
  filters?: FilterConfig;
}

export interface DiscordConfig {
  enabled: boolean;
  token: string;
  adminChannelId?: string;
  approveRoleId?: string;
  embedColor?: string;
}

export interface TelegramTarget {
  chatId: string;
}

export interface TelegramConfig {
  enabled: boolean;
  token: string;
  adminChatIds?: string[];
  parseMode?: 'HTML' | 'Markdown';
  apiRoot?: string;
}

export interface TwitterConfig {
  enabled?: boolean;
  authToken: string;
  ct0: string;
  username?: string;
  password?: string;
  email?: string;
  totpSecret?: string;
}

export interface OneBotConfig {
  enabled: boolean;
  url: string;
  token?: string;
  secret?: string;
  reconnectInterval?: number;
  wsSslVerify?: boolean;
}

export interface WebUIConfig {
  enabled: boolean;
  port: number;
  host: string;
  password?: string;
}

export interface PluginConfigEntry {
  name: string;
  enabled: boolean;
  options?: Record<string, any>;
  github?: string;
  ref?: string;
}

export interface AppConfig {
  debugMode?: boolean;
  users?: UserConfig[];
  proxy?: string;
  discord: DiscordConfig;
  telegram: TelegramConfig;
  onebot: OneBotConfig;
  twitter: TwitterConfig;
  webui: WebUIConfig;
  enableApproval: boolean;
  sendAsImage: boolean;
  xToImageApiUrl?: string;
  xToImageApiToken?: string;
  xToImageApiTheme?: 'light' | 'dim' | 'dark';
  imageCacheTtlMinutes: number;
  pollIntervalMinutes: number;
  maxPostsPerFetch: number;
  maxTweetAgeMinutes: number;
  groups?: GroupConfig[];
  plugins?: PluginConfigEntry[];
  pluginsDir?: string | string[];
}

export interface GroupTelegramConfig {
  chatId: string;
  targets?: Record<string, { chatId: string }>;
}

export interface GroupDiscordConfig {
  channelId: string;
  r14ChannelId?: string;
}

export interface GroupApprovalConfig {
  telegramAdminChatIds?: string[];
  discordAdminChannelId?: string;
  discordApproveRoleId?: string;
  onebotAdminGroupIds?: number[];
}

export interface GroupOneBotConfig {
  groupId: number;
  r14GroupId?: number;
}

export interface GroupConfig {
  name: string;
  users?: UserConfig[];
  telegram?: GroupTelegramConfig;
  discord?: GroupDiscordConfig;
  onebot?: GroupOneBotConfig;
  approval?: GroupApprovalConfig;
  blockedUsers?: string[];
}

export interface ProcessedTweet extends Tweet {
  matchedUser: UserConfig;
  passedFilters: boolean;
  filterReasons: string[];
  _skipUserFilter?: boolean;
}
