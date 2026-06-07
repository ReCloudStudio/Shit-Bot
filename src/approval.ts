import { Context, Markup } from 'telegraf';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, TextChannel, ButtonInteraction, Client } from 'discord.js';
import { ProcessedTweet } from './types';
import { getConfig } from './config';
import { formatTweetHTML } from './filters';
import { sendToTelegram } from './bots/telegram';
import { sendToDiscord } from './bots/discord';
import { markAsSent } from './storage';

interface PendingApproval {
  id: string;
  tweet: ProcessedTweet;
  platform: 'telegram' | 'discord' | 'both';
  telegramMessageIds: Map<string, number>;
  discordMessageIds: Map<string, string>;
  createdAt: Date;
  approved: boolean;
  approvedBy?: string;
}

const pendingApprovals = new Map<string, PendingApproval>();
let telegramBotInstance: any = null;
let discordClientInstance: Client | null = null;

async function retryWithDelay<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delayMs: number = 2000
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      console.warn(`Retry ${i + 1}/${retries} after error: ${(error as Error).message}`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Max retries reached');
}

function getTelegramAdminName(ctx: Context): string {
  const from = ctx.callbackQuery?.from;
  if (!from) return 'Unknown';
  if (from.first_name && from.last_name) {
    return `${from.first_name} ${from.last_name}`;
  }
  if (from.first_name) {
    return from.first_name;
  }
  if (from.username) {
    return `@${from.username}`;
  }
  return `User ${from.id}`;
}

function getDiscordAdminName(interaction: ButtonInteraction): string {
  const member = interaction.member;
  if (member && 'displayName' in member) {
    return member.displayName;
  }
  return interaction.user.username;
}

export function setTelegramBot(bot: any): void {
  telegramBotInstance = bot;
}

export function setDiscordClient(client: Client): void {
  discordClientInstance = client;
}

export async function sendForApproval(tweet: ProcessedTweet): Promise<boolean> {
  const config = getConfig();
  const approvalId = `${tweet.id}_${Date.now()}`;
  let sentToTelegram = false;
  let sentToDiscord = false;
  const telegramMessageIds = new Map<string, number>();
  const discordMessageIds = new Map<string, string>();

  if (config.telegram.enabled && config.telegram.adminChatIds && config.telegram.adminChatIds.length > 0) {
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Approve', `approve_${approvalId}`),
        Markup.button.callback('❌ Reject', `reject_${approvalId}`),
      ],
    ]);

    const adminMessage = [
      '📮 <b>Pending Approval</b>',
      '',
      formatTweetHTML(tweet),
      '',
      `<i>ID: ${approvalId}</i>`,
    ].join('\n');

    if (telegramBotInstance) {
      for (const adminId of config.telegram.adminChatIds) {
        try {
          const sentMessage = await retryWithDelay(() =>
            telegramBotInstance.telegram.sendMessage(
              adminId,
              adminMessage,
              {
                parse_mode: 'HTML',
                ...keyboard,
              }
            )
          ) as any;
          telegramMessageIds.set(adminId, sentMessage.message_id);
          sentToTelegram = true;
        } catch (error) {
          console.error(`Failed to send Telegram approval to ${adminId}:`, error);
        }
      }
    }
  }

  if (config.discord.enabled && config.discord.adminChannelId && discordClientInstance) {
    try {
      const channel = await discordClientInstance.channels.fetch(config.discord.adminChannelId);
      if (channel && channel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('📮 Pending Approval')
          .setAuthor({
            name: `@${tweet.author}`,
            url: `https://x.com/${tweet.author}`,
            iconURL: `https://unavatar.io/twitter/${tweet.author}`,
          })
          .setDescription(tweet.content.substring(0, 2000))
          .setURL(tweet.url)
          .setTimestamp(tweet.publishedAt)
          .setColor('#FFA500')
          .setFooter({ text: `ID: ${approvalId}` });

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`approve_${approvalId}`)
            .setLabel('✅ Approve')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`reject_${approvalId}`)
            .setLabel('❌ Reject')
            .setStyle(ButtonStyle.Danger)
        );

        const sentMessage = await (channel as TextChannel).send({
          embeds: [embed],
          components: [row],
        });

        discordMessageIds.set(config.discord.adminChannelId, sentMessage.id);
        sentToDiscord = true;
      }
    } catch (error) {
      console.error('Failed to send Discord approval:', error);
    }
  }

  if (!sentToTelegram && !sentToDiscord) {
    console.error('Failed to send approval to any platform');
    return false;
  }

  const platform = sentToTelegram && sentToDiscord ? 'both' : sentToTelegram ? 'telegram' : 'discord';

  pendingApprovals.set(approvalId, {
    id: approvalId,
    tweet,
    platform,
    telegramMessageIds,
    discordMessageIds,
    createdAt: new Date(),
    approved: false,
  });

  console.log(`Sent tweet ${tweet.id} for approval on ${platform}: ${approvalId}`);
  return true;
}

async function notifyOtherAdmins(
  approval: PendingApproval,
  actionBy: string,
  action: 'approved' | 'rejected'
): Promise<void> {
  const statusEmoji = action === 'approved' ? '✅' : '❌';
  const statusText = action === 'approved' ? 'Approved' : 'Rejected';

  if (approval.platform === 'telegram' || approval.platform === 'both') {
    const notification = [
      `${statusEmoji} <b>Tweet ${statusText}</b>`,
      '',
      `By: ${actionBy}`,
      `Tweet: @${approval.tweet.author}`,
      '',
      `<i>${approval.tweet.content.substring(0, 100)}${approval.tweet.content.length > 100 ? '...' : ''}</i>`,
    ].join('\n');

    for (const [adminId, messageId] of approval.telegramMessageIds) {
      try {
        await telegramBotInstance?.telegram.editMessageText(
          adminId,
          messageId,
          undefined,
          notification,
          { parse_mode: 'HTML' }
        );
      } catch (error) {
        console.warn(`Failed to notify Telegram admin ${adminId}:`, error);
      }
    }
  }

  if ((approval.platform === 'discord' || approval.platform === 'both') && discordClientInstance) {
    const embed = new EmbedBuilder()
      .setTitle(`${statusEmoji} Tweet ${statusText}`)
      .setDescription(
        `**By:** ${actionBy}\n` +
        `**Tweet:** @${approval.tweet.author}\n\n` +
        `${approval.tweet.content.substring(0, 100)}${approval.tweet.content.length > 100 ? '...' : ''}`
      )
      .setColor(action === 'approved' ? '#00FF00' : '#FF0000');

    for (const [channelId, messageId] of approval.discordMessageIds) {
      try {
        const channel = await discordClientInstance.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
          const message = await (channel as TextChannel).messages.fetch(messageId);
          await message.edit({ embeds: [embed], components: [] });
        }
      } catch (error) {
        console.warn(`Failed to notify Discord channel ${channelId}:`, error);
      }
    }
  }
}

export async function handleTelegramApproval(ctx: Context): Promise<void> {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery || !('data' in callbackQuery)) return;

  const data = callbackQuery.data;
  const isApprove = data.startsWith('approve_');
  const isReject = data.startsWith('reject_');

  if (!isApprove && !isReject) return;

  const approvalId = data.replace(/^(approve_|reject_)/, '');
  const pending = pendingApprovals.get(approvalId);

  if (!pending) {
    try {
      await ctx.answerCbQuery('Approval not found or expired');
    } catch (e) {
      // ignore - query may be too old
    }
    return;
  }

  if (pending.approved) {
    try {
      await ctx.answerCbQuery('This tweet has already been approved');
    } catch (e) {
      // ignore
    }
    return;
  }

  const config = getConfig();
  const adminName = getTelegramAdminName(ctx);

  // Try to answer callback, but don't fail if query is too old
  try {
    if (isApprove) {
      await ctx.answerCbQuery('✅ Approved!');
    } else {
      await ctx.answerCbQuery('❌ Rejected');
    }
  } catch (e) {
    console.warn('Failed to answer callback query (may be too old):', (e as Error).message);
  }

  if (isApprove) {
    pending.approved = true;
    pending.approvedBy = adminName;

    if (config.discord.enabled) await sendToDiscord(pending.tweet);
    if (config.telegram.enabled) await sendToTelegram(pending.tweet);
    markAsSent(pending.tweet.id, pending.tweet.author, pending.tweet.content, pending.tweet.url);

    await notifyOtherAdmins(pending, adminName, 'approved');
    console.log(`Approved by ${adminName} (Telegram): ${approvalId}`);
  } else {
    await notifyOtherAdmins(pending, adminName, 'rejected');
    console.log(`Rejected by ${adminName} (Telegram): ${approvalId}`);
  }

  pendingApprovals.delete(approvalId);
}

export async function handleDiscordApproval(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;
  const isApprove = customId.startsWith('approve_');
  const isReject = customId.startsWith('reject_');

  if (!isApprove && !isReject) return;

  const approvalId = customId.replace(/^(approve_|reject_)/, '');
  const pending = pendingApprovals.get(approvalId);

  if (!pending) {
    await interaction.reply({ content: 'Approval not found or expired', ephemeral: true });
    return;
  }

  if (pending.approved) {
    await interaction.reply({ content: 'This tweet has already been approved', ephemeral: true });
    return;
  }

  const config = getConfig();
  const adminName = getDiscordAdminName(interaction);

  if (isApprove) {
    await interaction.reply({ content: '✅ Approved!', ephemeral: true });
    pending.approved = true;
    pending.approvedBy = adminName;

    if (config.discord.enabled) await sendToDiscord(pending.tweet);
    if (config.telegram.enabled) await sendToTelegram(pending.tweet);
    markAsSent(pending.tweet.id, pending.tweet.author, pending.tweet.content, pending.tweet.url);

    await notifyOtherAdmins(pending, adminName, 'approved');
    console.log(`Approved by ${adminName} (Discord): ${approvalId}`);
  } else {
    await interaction.reply({ content: '❌ Rejected', ephemeral: true });
    await notifyOtherAdmins(pending, adminName, 'rejected');
    console.log(`Rejected by ${adminName} (Discord): ${approvalId}`);
  }

  pendingApprovals.delete(approvalId);
}

export function getPendingCount(): number {
  return pendingApprovals.size;
}

export function cleanupExpiredApprovals(maxAgeMinutes: number = 60): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [id, approval] of pendingApprovals) {
    const age = (now - approval.createdAt.getTime()) / (1000 * 60);
    if (age > maxAgeMinutes) {
      pendingApprovals.delete(id);
      cleaned++;
    }
  }

  return cleaned;
}
