import { getPlugin } from '@/plugins';
import type { PluginConfigEntry } from '@/plugins/types';

export interface WebSearchOptions {
  enabled: boolean;
  provider?: 'duckduckgo' | 'tavily' | 'serper' | 'searxng' | 'brave';
  apiKey?: string;
  baseUrl?: string;
  maxResults?: number;
}

export interface MemoryOptions {
  enabled: boolean;
  maxProfileItems?: number;
  maxProfileChars?: number;
  recentTurns?: number;
  recallLimit?: number;
  logConversations?: boolean;
  maxConversationsPerUser?: number;
}

export interface SummaryOptions {
  enabled: boolean;
  maxMessagesPerChannel?: number;
  defaultCount?: number;
}

export interface AIChatOptions {
  enabled: boolean;
  apiUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxTokens: number;
  temperature: number;
  allowedGuildIds?: string[];
  maxToolIterations?: number;
  reactions?: boolean;
  ignoreEveryoneMention?: boolean;
  maxImageBytes?: number;
  maxTotalImageBytes?: number;
  webSearch?: WebSearchOptions;
  memory?: MemoryOptions;
  summary?: SummaryOptions;
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(Math.trunc(n), max));
}

function clampFloat(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(n, max));
}

const defaults: AIChatOptions = {
  enabled: false,
  apiUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-3.5-turbo',
  systemPrompt: '你是一个有帮助的助手。',
  maxTokens: 1024,
  temperature: 0.7,
  allowedGuildIds: [],
  maxToolIterations: 8,
  reactions: true,
  maxImageBytes: 6 * 1024 * 1024,
  maxTotalImageBytes: 12 * 1024 * 1024,
  webSearch: {
    enabled: false,
    provider: 'duckduckgo',
    apiKey: '',
    baseUrl: '',
    maxResults: 5,
  },
  memory: {
    enabled: false,
    maxProfileItems: 12,
    maxProfileChars: 800,
    recentTurns: 6,
    recallLimit: 8,
    logConversations: true,
    maxConversationsPerUser: 500,
  },
  summary: {
    enabled: false,
    maxMessagesPerChannel: 500,
    defaultCount: 100,
  },
};

let cached: AIChatOptions | null = null;

export function getAiConfig(): AIChatOptions {
  if (cached) return cached;

  const plugin = getPlugin('ai-chat');
  const raw = (plugin?.config?.options || {}) as Record<string, unknown>;
  const env = process.env;

  const rawWeb = (raw.webSearch || {}) as Record<string, unknown>;
  const rawMem = (raw.memory || {}) as Record<string, unknown>;
  const rawSum = (raw.summary || {}) as Record<string, unknown>;

  const cfg: AIChatOptions = {
    ...defaults,
    ...raw,
    apiUrl: env.AI_API_URL || (raw.apiUrl as string) || defaults.apiUrl,
    apiKey: env.AI_API_KEY || (raw.apiKey as string) || defaults.apiKey,
    model: (raw.model as string) || defaults.model,
    systemPrompt: (raw.systemPrompt as string) || defaults.systemPrompt,
    maxTokens: clampInt(raw.maxTokens, defaults.maxTokens, 1, 32768),
    temperature: clampFloat(raw.temperature, defaults.temperature, 0, 2),
    allowedGuildIds: (raw.allowedGuildIds as string[]) ?? defaults.allowedGuildIds,
    maxToolIterations: clampInt(raw.maxToolIterations, defaults.maxToolIterations!, 1, 30),
    reactions: (raw.reactions as boolean) ?? defaults.reactions,
    ignoreEveryoneMention: (raw.ignoreEveryoneMention as boolean) ?? defaults.ignoreEveryoneMention,
    maxImageBytes: clampInt(raw.maxImageBytes, defaults.maxImageBytes!, 64 * 1024, 20 * 1024 * 1024),
    maxTotalImageBytes: clampInt(raw.maxTotalImageBytes, defaults.maxTotalImageBytes!, 256 * 1024, 40 * 1024 * 1024),
    webSearch: {
      ...defaults.webSearch,
      ...rawWeb,
      enabled: (rawWeb.enabled as boolean) ?? defaults.webSearch!.enabled,
      apiKey: (rawWeb.apiKey as string) || defaults.webSearch!.apiKey || '',
      maxResults: clampInt(rawWeb.maxResults, defaults.webSearch!.maxResults!, 1, 10),
    },
    memory: {
      ...defaults.memory,
      ...rawMem,
      enabled: (rawMem.enabled as boolean) ?? defaults.memory!.enabled,
      maxProfileItems: clampInt(rawMem.maxProfileItems, defaults.memory!.maxProfileItems!, 1, 200),
      maxProfileChars: clampInt(rawMem.maxProfileChars, defaults.memory!.maxProfileChars!, 50, 20000),
      recentTurns: clampInt(rawMem.recentTurns, defaults.memory!.recentTurns!, 0, 100),
      recallLimit: clampInt(rawMem.recallLimit, defaults.memory!.recallLimit!, 1, 100),
      logConversations: (rawMem.logConversations as boolean) ?? defaults.memory!.logConversations,
      maxConversationsPerUser: clampInt(rawMem.maxConversationsPerUser, defaults.memory!.maxConversationsPerUser!, 1, 100000),
    },
    summary: {
      ...defaults.summary,
      ...rawSum,
      enabled: (rawSum.enabled as boolean) ?? defaults.summary!.enabled,
      maxMessagesPerChannel: clampInt(rawSum.maxMessagesPerChannel, defaults.summary!.maxMessagesPerChannel!, 1, 100000),
      defaultCount: clampInt(rawSum.defaultCount, defaults.summary!.defaultCount!, 1, 100000),
    },
  };

  if (cfg.enabled && !cfg.apiKey) {
    cfg.enabled = false;
  }
  if (!cfg.apiUrl) {
    cfg.apiUrl = defaults.apiUrl;
  }
  if (!cfg.model) {
    cfg.model = defaults.model;
  }

  cached = cfg;
  return cfg;
}

export function invalidateAiConfigCache(): void {
  cached = null;
}
