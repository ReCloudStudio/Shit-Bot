import type { PluginDefinition } from '@/plugins/types';

export default {
  manifest: {
    name: 'auto-reply',
    version: '1.0.0',
    description: '自动回复关键词匹配消息',
    author: 'shit-bot',
  },
  init: (api) => {
    const cfg = api.getConfig();
    const opts = (cfg.plugins || []).find(p => p.name === 'auto-reply')?.options || {};
    api.logger.info(`auto-reply 已加载，${opts.rules ? opts.rules.length : 0} 条规则`);
  },
  hooks: {
    onDiscordMessage: (message) => {
      const content = message.content?.trim();
      if (!content) return;
      const client = message.client;
      if (!client?.user) return;
      if (message.mentions?.has(client.user.id)) {
        message.reply('你好！我是一个插件。请配置 auto-reply 的 rules 选项来定制回复。').catch(() => {});
        return true;
      }
    },
  },
} satisfies PluginDefinition;
