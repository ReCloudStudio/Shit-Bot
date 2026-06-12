import { Client, GatewayIntentBits, TextChannel, EmbedBuilder, AttachmentBuilder, Message, REST, Routes } from 'discord.js';
import { ProcessedTweet } from '../types';
import { getConfig } from '../config';
import { formatContentForPlatform } from '../filters';
import { renderTweetImage } from '../renderer';
import { storeSentMessage, getRecentSentMessages, deleteSentMessage, getSentMessageByMessageId } from '../storage';

let client: Client | null = null;
let targetChannel: TextChannel | null = null;

export function getDiscordClient(): Client | null {
  return client;
}

export async function initDiscord(): Promise<boolean> {
  const config = getConfig();

  if (!config.discord.enabled) {
    console.log('Discord 已在配置中禁用');
    return false;
  }

  try {
    client = new Client({
      intents: [GatewayIntentBits.Guilds],
    });

    await client.login(config.discord.token);

    console.log('Discord bot 已连接 (群组指定目标频道)');

    return true;
  } catch (error) {
    console.error('Discord 初始化失败:', error);
    client = null;
    targetChannel = null;
    return false;
  }
}

export async function sendToDiscord(tweet: ProcessedTweet, channelId?: string, asImage?: boolean, preRenderedImage?: Buffer): Promise<Message | null> {
  const config = getConfig();
  const sendImage = asImage ?? config.sendAsImage;

  if (!client) {
    console.error('Discord 未初始化');
    return null;
  }

  let sendTo: TextChannel | null = null;

  if (channelId) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        sendTo = channel as TextChannel;
      }
    } catch (e) {
      console.error(`获取 Discord 频道 ${channelId} 失败:`, e);
    }
  }

  if (!sendTo) {
    console.error(`Discord 频道不可用${channelId ? ` (${channelId})` : ""}`);
    return null;
  }

  try {
    let sentMessage: Message;

        if (sendImage) {
            const imageBuffer = preRenderedImage || await renderTweetImage(tweet);
            if (imageBuffer) {
                const buf = Buffer.from(imageBuffer);
                const attachment = new AttachmentBuilder(buf, { name: `tweet_${tweet.id}.png` });
        const embed = new EmbedBuilder()
          .setAuthor({ name: `@${tweet.author}`, url: `https://x.com/${tweet.author}` })
          .setDescription(`[🔗 在 X 上查看](${tweet.url})`)
          .setURL(tweet.url)
          .setImage(`attachment://tweet_${tweet.id}.png`)
          .setColor((config.discord.embedColor || '#1DA1F2') as `#${string}`)
          .setTimestamp(tweet.publishedAt);

        sentMessage = await sendTo.send({ embeds: [embed], files: [attachment] });
        storeSentMessage(sendTo.id, sentMessage.id, tweet.id);
        console.log(`[Discord] 以图片形式发送推文 ${tweet.id}${channelId ? ` (${channelId})` : ""}`);
        return sentMessage;
      }
    }

    const embed = new EmbedBuilder()
      .setAuthor({ name: `@${tweet.author}`, url: `https://x.com/${tweet.author}`, iconURL: `https://unavatar.io/twitter/${tweet.author}` })
      .setDescription(formatContentForPlatform(tweet.content, 'discord'))
      .setURL(tweet.url)
      .setTimestamp(tweet.publishedAt)
      .setColor((config.discord.embedColor || '#1DA1F2') as `#${string}`);

    if (tweet.mediaUrls.length > 0 && tweet.mediaUrls[0]) {
      embed.setImage(tweet.mediaUrls[0]);
    }

    embed.setFooter({ text: `${tweet.mediaUrls.length} 个媒体附件` });

    sentMessage = await sendTo.send({ embeds: [embed] });
    storeSentMessage(sendTo.id, sentMessage.id, tweet.id);
    console.log(`[Discord] 发送推文 ${tweet.id}${channelId ? ` (${channelId})` : ""}`);
    return sentMessage;
  } catch (error) {
    console.error(`[Discord] 发送推文 ${tweet.id} 失败:`, error);
    return null;
  }
}

export async function sendBatchToDiscord(tweets: ProcessedTweet[]): Promise<number> {
  let sent = 0;

  for (const tweet of tweets) {
    const msg = await sendToDiscord(tweet);
    if (msg) {
      sent++;
    }
    
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return sent;
}

export async function recallMessages(channelId: string, count: number): Promise<number> {
  if (!client) return 0;

  const records = getRecentSentMessages(channelId, count);
  let deleted = 0;

  for (const record of records) {
    try {
      const channel = await client.channels.fetch(record.channel_id);
      if (channel && channel.isTextBased()) {
        const message = await (channel as TextChannel).messages.fetch(record.message_id);
        await message.delete();
        deleteSentMessage(record.message_id);
        deleted++;
      }
    } catch (error) {
      deleteSentMessage(record.message_id);
    }
  }

  return deleted;
}

export async function recallMessageById(messageId: string): Promise<boolean> {
  if (!client) return false;

  const record = getSentMessageByMessageId(messageId);

  if (record) {
    try {
      const channel = await client.channels.fetch(record.channel_id);
      if (channel && channel.isTextBased()) {
        const message = await (channel as TextChannel).messages.fetch(messageId);
        await message.delete();
        deleteSentMessage(messageId);
        return true;
      }
    } catch {}
    deleteSentMessage(messageId);
    return false;
  }

  for (const [, channel] of client.channels.cache) {
    if (!channel.isTextBased()) continue;
    try {
      const message = await (channel as TextChannel).messages.fetch(messageId);
      if (message.author.id === client.user?.id) {
        await message.delete();
        return true;
      }
    } catch {}
  }

  return false;
}

export async function registerDiscordCommands(): Promise<void> {
  if (!client) return;

  try {
    const rest = new REST({ version: '10' }).setToken(getConfig().discord.token);

    const commands = [
      {
        name: 'recall',
        description: '撤回 bot 发送的消息 (需要审批权限)',
        options: [
          {
            name: 'count',
            description: '撤回最近 N 条消息 (默认 5)',
            type: 4,
            required: false,
          },
          {
            name: 'message_id',
            description: '指定要撤回的消息 ID',
            type: 3,
            required: false,
          },
          {
            name: 'link',
            description: '指定要撤回的消息链接',
            type: 3,
            required: false,
          },
        ],
      },
      {
        name: '撤回消息',
        type: 3,
      },
    ];

    await rest.put(
      Routes.applicationCommands(client.user!.id),
      { body: commands }
    );

    console.log('Discord 斜杠命令已注册');
  } catch (error) {
    console.error('Discord 命令注册失败:', error);
  }
}

export async function shutdownDiscord(): Promise<void> {
  if (client) {
    await client.destroy();
    client = null;
    targetChannel = null;
    console.log('Discord bot 已断开');
  }
}
