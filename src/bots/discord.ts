import { Client, GatewayIntentBits, TextChannel, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { ProcessedTweet } from '../types';
import { getConfig } from '../config';
import { renderTweetImage } from '../renderer';

let client: Client | null = null;
let targetChannel: TextChannel | null = null;

export function getDiscordClient(): Client | null {
  return client;
}

export async function initDiscord(): Promise<boolean> {
  const config = getConfig();

  if (!config.discord.enabled) {
    console.log('Discord is disabled in config');
    return false;
  }

  try {
    client = new Client({
      intents: [GatewayIntentBits.Guilds],
    });

    await client.login(config.discord.token);

    const channel = await client.channels.fetch(config.discord.channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Discord channel ${config.discord.channelId} not found or is not a text channel`);
    }

    targetChannel = channel as TextChannel;
    console.log(`Discord bot connected, targeting channel: ${targetChannel.name}`);
    return true;
  } catch (error) {
    console.error('Failed to initialize Discord:', error);
    client = null;
    targetChannel = null;
    return false;
  }
}

export async function sendToDiscord(tweet: ProcessedTweet, asImage?: boolean): Promise<boolean> {
  const config = getConfig();
  const sendImage = asImage ?? config.sendAsImage;

  if (!client || !targetChannel) {
    console.error('Discord not initialized');
    return false;
  }

  try {
    if (sendImage) {
      const imageBuffer = await renderTweetImage(tweet);
      if (imageBuffer) {
        const attachment = new AttachmentBuilder(imageBuffer, { name: `tweet_${tweet.id}.png` });
        
        const embed = new EmbedBuilder()
          .setAuthor({
            name: `@${tweet.author}`,
            url: `https://x.com/${tweet.author}`,
          })
          .setDescription(tweet.content.substring(0, 200) + (tweet.content.length > 200 ? '...' : ''))
          .setURL(tweet.url)
          .setImage(`attachment://tweet_${tweet.id}.png`)
          .setColor((config.discord.embedColor || '#1DA1F2') as `#${string}`)
          .setTimestamp(tweet.publishedAt);

        await targetChannel.send({ embeds: [embed], files: [attachment] });
        console.log(`Sent tweet ${tweet.id} as image to Discord`);
        return true;
      }
    }

    const embed = new EmbedBuilder()
      .setAuthor({
        name: `@${tweet.author}`,
        url: `https://x.com/${tweet.author}`,
        iconURL: `https://unavatar.io/twitter/${tweet.author}`,
      })
      .setDescription(tweet.content)
      .setURL(tweet.url)
      .setTimestamp(tweet.publishedAt)
      .setColor((config.discord.embedColor || '#1DA1F2') as `#${string}`);

    if (tweet.mediaUrls.length > 0 && tweet.mediaUrls[0]) {
      embed.setImage(tweet.mediaUrls[0]);
    }

    embed.setFooter({
      text: `${tweet.mediaUrls.length} media attachment(s)`,
    });

    await targetChannel.send({ embeds: [embed] });
    console.log(`Sent tweet ${tweet.id} to Discord`);
    return true;
  } catch (error) {
    console.error(`Failed to send tweet ${tweet.id} to Discord:`, error);
    return false;
  }
}

export async function sendBatchToDiscord(tweets: ProcessedTweet[]): Promise<number> {
  let sent = 0;

  for (const tweet of tweets) {
    const success = await sendToDiscord(tweet);
    if (success) {
      sent++;
    }
    
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return sent;
}

export async function shutdownDiscord(): Promise<void> {
  if (client) {
    await client.destroy();
    client = null;
    targetChannel = null;
    console.log('Discord bot disconnected');
  }
}
