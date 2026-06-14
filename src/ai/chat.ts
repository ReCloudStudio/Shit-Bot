import { getConfig } from '../config';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: { content: string };
  }>;
}

export function isAiEnabled(): boolean {
  return getConfig().ai.enabled;
}

export async function chatWithAI(userMessage: string, username?: string, contextMessage?: string): Promise<string> {
  const cfg = getConfig().ai;

  if (!cfg.enabled || !cfg.apiKey) {
    return 'AI 聊天功能未启用或未配置 API Key。';
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: cfg.systemPrompt },
  ];

  if (contextMessage) {
    messages.push({ role: 'user', content: `以下是被引用的消息内容:\n${contextMessage}` });
  }

  messages.push({ role: 'user', content: username ? `[用户 ${username}]: ${userMessage}` : userMessage });

  console.log(`[AI] 发送请求: model=${cfg.model}, messages=${messages.length}, tokens≈${messages.reduce((s, m) => s + m.content.length, 0)}`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(`${cfg.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`AI API 错误 (${response.status}): ${errorText}`);
      return `AI 服务返回错误 (${response.status})。请检查 API 配置。`;
    }

    const data = await response.json() as ChatCompletionResponse;

    if (!data.choices || data.choices.length === 0) {
      return 'AI 未返回有效回复。';
    }

    return data.choices[0].message.content;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      console.error('AI API 请求超时');
      return 'AI 响应超时，请稍后再试。';
    }
    console.error('AI API 请求失败:', error);
    return 'AI 服务请求失败，请检查 API 配置或稍后再试。';
  }
}
