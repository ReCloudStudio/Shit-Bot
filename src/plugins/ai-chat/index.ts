import { Client, TextChannel, Message, ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { logger } from '@/logger';
import { getConfig } from "@/config";
import { chatWithAI, isAiEnabled } from "./chat";
import { listMemories, deleteMemory, getUserPronouns, saveUserPronouns } from "./memory";
import { recordChannelMessage, getChannelMessageCount, getOldestStoredMessageId } from "./summary";
import { formatUtc8 } from "./time";
import { getAiConfig, invalidateAiConfigCache } from "./config";
import { executeDiscordMessageHook } from "@/plugins";
import type { PluginDefinition } from "@/plugins/types";

const exhaustedChannels = new Set<string>();

function isAiAllowedGuild(guildId: string | null): boolean {
  const allowed = getAiConfig().allowedGuildIds;
  if (!allowed || allowed.length === 0) return true;
  return !!guildId && allowed.map(String).includes(guildId);
}

function extractImageUrls(message: Message): string[] {
  const urls: string[] = [];
  for (const att of message.attachments.values()) {
    const ct = att.contentType?.toLowerCase() || "";
    const supported = ct
      ? ct === "image/png" || ct === "image/jpeg" || ct === "image/webp"
      : /\.(png|jpe?g|webp)$/i.test(att.name || "");
    if (supported && att.url && (att.size ?? 0) <= 10 * 1024 * 1024) urls.push(att.url);
    if (urls.length >= 6) break;
  }
  return urls;
}

function startTyping(channel: TextChannel): () => void {
  const timer = setInterval(() => channel.sendTyping().catch(() => {}), 8000);
  return () => clearInterval(timer);
}

async function sendChunkedReply(message: Message, text: string): Promise<void> {
  const maxLen = 1900;
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    let chunk = remaining.slice(0, maxLen);
    const lastNewline = chunk.lastIndexOf("\n");
    if (remaining.length > maxLen && lastNewline > maxLen / 2) {
      chunk = remaining.slice(0, lastNewline);
    }
    chunks.push(chunk);
    remaining = remaining.slice(chunk.length);
  }
  try {
    for (const chunk of chunks) {
      await message.reply({ content: chunk, allowedMentions: { repliedUser: false } });
      if (chunks.length > 1) await new Promise((r) => setTimeout(r, 500));
    }
  } catch (error) {
    logger.error("AI", "Discord AI 回复发送失败:", error);
  }
}

async function backfillChannelHistory(channel: TextChannel, channelId: string, targetTotal: number): Promise<void> {
  let have = getChannelMessageCount("discord", channelId);
  if (have >= targetTotal) return;
  if (exhaustedChannels.has(channelId)) return;
  let before = getOldestStoredMessageId("discord", channelId) || undefined;
  let guard = 0;
  while (have < targetTotal && guard < 40) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) {
      exhaustedChannels.add(channelId);
      break;
    }
    const arr = [...batch.values()];
    for (const m of arr) {
      if (m.author.bot) continue;
      recordChannelMessage(
        "discord",
        channelId,
        m.id,
        m.member?.displayName || m.author.username,
        m.cleanContent,
        m.createdTimestamp,
        extractImageUrls(m),
      );
    }
    before = arr[arr.length - 1].id;
    have = getChannelMessageCount("discord", channelId);
    guard++;
    if (batch.size < 100) {
      exhaustedChannels.add(channelId);
      break;
    }
  }
  logger.info("AI", `频道 ${channelId} 历史补全至 ${have} 条 (目标 ${targetTotal})`);
}

async function handleMemoryCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const username = interaction.user.username;
  const mems = listMemories("discord", username);
  if (mems.length === 0) {
    await interaction.reply({ content: "你还没有任何记忆。", flags: MessageFlags.Ephemeral });
    return;
  }
  const lines = mems.map((m) => `key: ${m.key}，value: ${m.value}`);
  let body = `共 ${mems.length} 条记忆：\n` + lines.join("\n");
  if (body.length > 1900) body = body.slice(0, 1900) + "\n…（过长已截断）";
  await interaction.reply({ content: body, flags: MessageFlags.Ephemeral });
}

async function handleDeleteMemoryCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const username = interaction.user.username;
  const key = interaction.options.getString("key", true);
  const ok = deleteMemory("discord", username, key);
  await interaction.reply({
    content: ok ? `已删除记忆：${key}` : `没有找到记忆：${key}（可用 /memory 查看现有键）`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handlePronounsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const username = interaction.user.username;
  const pronouns = interaction.options.getString("pronouns");

  if (pronouns) {
    saveUserPronouns("discord", username, pronouns);
    await interaction.reply({
      content: `已设置你的代词为：「${pronouns}」。AI 回复将使用这些代词来指代你。`,
      flags: MessageFlags.Ephemeral,
    });
  } else {
    const current = getUserPronouns("discord", username);
    if (current) {
      await interaction.reply({
        content: `你当前的代词是：「${current}」。\n使用 \`/pronouns 代词\` 来修改。`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({
        content: `你还没有设置代词。使用 \`/pronouns 你的代词\` 来设置（例如：\`/pronouns 她\` 或 \`/pronouns they/them\`）。`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

export default {
  manifest: {
    name: "ai-chat",
    version: "1.0.0",
    description: "Discord AI 聊天 (@提及自动回复)",
    author: "shit-bot",
  },
  init: (api) => {
    api.logger.info("AI 聊天插件已加载");
    invalidateAiConfigCache();
  },
  hooks: {
    onAfterInit: async () => {
      const { getDiscordClient } = await import("@/bots/discord");
      const client = getDiscordClient();
      if (!client) return;
      const config = getConfig();
      const aiCfg = getAiConfig();
      if (!config.discord.enabled || !aiCfg.enabled) {
        if (config.discord.enabled && !aiCfg.enabled) {
          logger.info("AI", "AI 聊天未启用，跳过 Discord AI 消息监听");
        }
        return;
      }

      client.on("messageCreate", async (message: Message) => {
        if (message.author.bot) return;
        if (!client.user) return;

        const guildAllowed = isAiAllowedGuild(message.guildId);

        if (guildAllowed && message.channel.isTextBased()) {
          try {
            recordChannelMessage(
              "discord",
              message.channelId,
              message.id,
              message.member?.displayName || message.author.username,
              message.cleanContent,
              message.createdTimestamp,
              extractImageUrls(message),
            );
          } catch (e) {
            logger.warn("AI", "记录频道消息失败(忽略):", (e as Error).message);
          }
        }

        const claimed = await executeDiscordMessageHook(message).catch(() => false);
        if (claimed) return;

        const botMentioned = message.mentions.has(client.user.id);
        if (!botMentioned) return;

        if (!guildAllowed) {
          logger.info("AI", `服务器 ${message.guildId || "DM"} 不在 AI 允许列表中，跳过`);
          return;
        }

        if (aiCfg.ignoreEveryoneMention && message.mentions.everyone) {
          logger.info("AI", "消息包含 @everyone，跳过回复");
          return;
        }

        const content = message.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
        let imageUrls = extractImageUrls(message);
        const bareMention = !content && imageUrls.length === 0 && !message.reference?.messageId;

        if (bareMention && !aiCfg.summary?.enabled) {
          try {
            await message.reply("你好！请 @我 然后输入你的问题，我会尽力回答。");
          } catch {}
          return;
        }

        let contextMessage: string | undefined;
        if (message.reference?.messageId) {
          try {
            if (message.channel.isTextBased()) {
              const refMsg = await message.channel.messages.fetch(message.reference.messageId);
              if (refMsg) {
                contextMessage = `[${formatUtc8(refMsg.createdTimestamp)}] [${refMsg.member?.displayName || refMsg.author.username}]: ${refMsg.content.slice(0, 2000)}`;
                const refImgs = extractImageUrls(refMsg);
                if (refImgs.length) imageUrls = [...imageUrls, ...refImgs].slice(0, 6);
              }
            }
          } catch (e) {
            logger.error("AI", "获取引用消息失败:", (e as Error).message);
          }
        }

        const displayName = message.member?.displayName || message.author.username;
        const ch = message.channel;
        const stopTyping = ch.isTextBased() ? startTyping(ch as TextChannel) : () => {};

        let reply = "";
        let reactions: string[] = [];
        try {
          const res = await chatWithAI(content, {
            username: message.author.username,
            displayName,
            contextMessage,
            platform: "discord",
            channelId: message.channelId,
            messageId: message.id,
            images: imageUrls.length ? imageUrls : undefined,
            bareMention,
            backfillChannel:
              aiCfg.summary?.enabled && ch.isTextBased()
                ? (target: number) => backfillChannelHistory(ch as TextChannel, message.channelId, target)
                : undefined,
          });
          reply = res.reply;
          reactions = res.reactions;
        } catch (e) {
          logger.error("AI", "chatWithAI 异常(兜底):", (e as Error).message);
          reply = "AI 暂时不可用，请稍后再试。";
        } finally {
          stopTyping();
        }

        for (const emoji of reactions) {
          try {
            await message.react(emoji);
          } catch {}
        }

        await sendChunkedReply(message, reply);
        logger.info("AI", `回复 ${message.author.username}: ${reply.slice(0, 60).replace(/\s+/g, " ")}...`);
      });

      client.on("interactionCreate", async (interaction) => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName === "memory") {
          await handleMemoryCommand(interaction).catch((e) => logger.error("AI", "memory 命令错误:", e));
        } else if (interaction.commandName === "delete-memory") {
          await handleDeleteMemoryCommand(interaction).catch((e) => logger.error("AI", "delete-memory 命令错误:", e));
        } else if (interaction.commandName === "pronouns") {
          await handlePronounsCommand(interaction).catch((e) => logger.error("AI", "pronouns 命令错误:", e));
        }
      });

      logger.info("AI", "Discord AI 聊天监听器已注册 (插件)");
    },
    onDiscordCommands: () => {
      const aiCfg = getAiConfig();
      if (!aiCfg.enabled) return [];
      return [
        {
          name: "memory",
          description: "查看 AI 对你的全部记忆",
        },
        {
          name: "pronouns",
          description: "设置或查看你的代词 (pronouns) 以便 AI 正确称呼",
          options: [
            {
              name: "pronouns",
              description: "你的代词，如「他」「她」「他们」「they/them」等",
              type: 3,
              required: false,
            },
          ],
        },
        {
          name: "delete-memory",
          description: "直接删除指定 key 的记忆 (不经过 AI)",
          options: [
            {
              name: "key",
              description: "要删除的记忆键 (可用 /memory 查看)",
              type: 3,
              required: true,
            },
          ],
        },
      ];
    },
  },
} satisfies PluginDefinition;
