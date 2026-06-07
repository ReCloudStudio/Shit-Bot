import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { AppConfig } from './types';

dotenv.config();

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

let config: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (config) {
    return config;
  }

  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found: ${CONFIG_PATH}`);
  }

  const rawConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

  const loadedConfig: AppConfig = {
    ...rawConfig,
    discord: {
      ...rawConfig.discord,
      token: process.env.DISCORD_TOKEN || rawConfig.discord.token,
    },
    telegram: {
      ...rawConfig.telegram,
      token: process.env.TELEGRAM_TOKEN || rawConfig.telegram.token,
    },
  };

  validateConfig(loadedConfig);
  config = loadedConfig;
  return config;
}

function validateConfig(cfg: AppConfig): void {
  if (!cfg.users || cfg.users.length === 0) {
    throw new Error('No users configured to monitor');
  }

  if (cfg.discord.enabled && (!cfg.discord.token || !cfg.discord.channelId)) {
    throw new Error('Discord is enabled but token or channelId is missing');
  }

  if (cfg.telegram.enabled && (!cfg.telegram.token || !cfg.telegram.chatId)) {
    throw new Error('Telegram is enabled but token or chatId is missing');
  }

  if (!cfg.nitterInstances || cfg.nitterInstances.length === 0) {
    console.warn('No nitter instances configured, using defaults');
    cfg.nitterInstances = [
      'https://xcancel.com',
      'https://nitter.poast.org',
      'https://nitter.privacyredirect.com',
      'https://nitter.kareem.one',
      'https://nitter.catsarch.com',
    ];
  }

  if (!cfg.pollIntervalMinutes || cfg.pollIntervalMinutes < 1) {
    cfg.pollIntervalMinutes = 5;
  }

  if (!cfg.maxPostsPerFetch || cfg.maxPostsPerFetch < 1) {
    cfg.maxPostsPerFetch = 20;
  }

  if (!cfg.maxTweetAgeMinutes || cfg.maxTweetAgeMinutes < 1) {
    cfg.maxTweetAgeMinutes = 60;
  }

  if (cfg.enableApproval) {
    const hasTelegramAdmins = cfg.telegram.enabled && cfg.telegram.adminChatIds && cfg.telegram.adminChatIds.length > 0;
    const hasDiscordAdmin = cfg.discord.enabled && cfg.discord.adminChannelId;

    if (!hasTelegramAdmins && !hasDiscordAdmin) {
      console.warn('Approval enabled but no admin configured, disabling approval');
      cfg.enableApproval = false;
    }
  }
}

export function getConfig(): AppConfig {
  if (!config) {
    return loadConfig();
  }
  return config;
}
