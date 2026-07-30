import {
  AIProviderError,
  type AIProvider,
  type ChatRequest,
  type ChatResult,
  type ModelDescriptor,
  type ProviderConfig,
} from '@/lib/ai/types';
import { getProviderApiKey } from '@/lib/ai/providers';

type JsonRecord = Record<string, unknown>;

type OpenAIUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type OpenAIChatResponse = {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: OpenAIUsage;
};

type AnthropicContentBlock = {
  type?: string;
  text?: string;
};

type AnthropicChatResponse = {
  model?: string;
  content?: AnthropicContentBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

type GeminiPart = {
  text?: string;
};

type GeminiChatResponse = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

async function readJsonObject(response: Response): Promise<JsonRecord> {
  const payload: unknown = await response.json().catch(() => ({}));
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as JsonRecord
    : {};
}

async function readError(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function assertOk(response: Response, config: ProviderConfig, details: unknown): void {
  if (!response.ok) {
    throw new AIProviderError(
      `${config.name} request failed with status ${response.status}.`,
      config.id,
      response.status,
      details,
    );
  }
}

export class HttpAIProvider implements AIProvider {
  constructor(public readonly config: ProviderConfig) {}

  private headers(): HeadersInit {
    const key = getProviderApiKey(this.config);

    if (this.config.protocol === 'anthropic') {
      return {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      };
    }

    if (this.config.protocol === 'gemini') {
      return { 'content-type': 'application/json' };
    }

    return {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
      ...(this.config.id === 'openrouter'
        ? {
            'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://m-ai.app',
            'X-OpenRouter-Title': 'm.ai',
          }
        : {}),
    };
  }

  async listModels(signal?: AbortSignal): Promise<ModelDescriptor[]> {
    const key = getProviderApiKey(this.config);
    const url = this.config.protocol === 'gemini'
      ? `${this.config.baseUrl}/models?key=${encodeURIComponent(key)}`
      : `${this.config.baseUrl}/models`;

    const response = await fetch(url, {
      headers: this.headers(),
      signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      const details = await readError(response);
      assertOk(response, this.config, details);
    }

    const payload = await readJsonObject(response);
    const candidateModels = payload.data ?? payload.models;
    const rawModels = Array.isArray(candidateModels)
      ? candidateModels.filter((model): model is JsonRecord => model !== null && typeof model === 'object' && !Array.isArray(model))
      : [];

    return rawModels
      .map((model): ModelDescriptor | null => {
        const rawId = String(model.id ?? model.name ?? '');
        if (!rawId) return null;
        const id = rawId.replace(/^models\//, '');
        const methods = Array.isArray(model.supportedGenerationMethods)
          ? model.supportedGenerationMethods.map(String)
          : [];
        if (this.config.protocol === 'gemini' && methods.length && !methods.includes('generateContent')) return null;

        const architecture = model.architecture !== null && typeof model.architecture === 'object' && !Array.isArray(model.architecture)
          ? model.architecture as JsonRecord
          : {};
        return {
          id,
          name: String(model.displayName ?? model.name ?? id),
          provider: this.config.id,
          contextWindow: Number(model.context_length ?? model.inputTokenLimit) || undefined,
          inputModalities: Array.isArray(architecture.input_modalities)
            ? architecture.input_modalities.map(String)
            : undefined,
          outputModalities: Array.isArray(architecture.output_modalities)
            ? architecture.output_modalities.map(String)
            : undefined,
        };
      })
      .filter((model): model is ModelDescriptor => model !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    if (request.provider !== this.config.id) {
      throw new AIProviderError('Provider mismatch in gateway request.', this.config.id, 400);
    }

    if (this.config.protocol === 'anthropic') return this.chatAnthropic(request);
    if (this.config.protocol === 'gemini') return this.chatGemini(request);
    return this.chatOpenAICompatible(request);
  }

  private async chatOpenAICompatible(request: ChatRequest): Promise<ChatResult> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      signal: request.signal,
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        max_tokens: request.maxOutputTokens,
      }),
    });
    const rawPayload = await readJsonObject(response);
    assertOk(response, this.config, rawPayload);
    const payload = rawPayload as OpenAIChatResponse;

    return {
      provider: this.config.id,
      model: String(payload.model ?? request.model),
      text: String(payload.choices?.[0]?.message?.content ?? ''),
      usage: {
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens,
        totalTokens: payload.usage?.total_tokens,
      },
    };
  }

  private async chatAnthropic(request: ChatRequest): Promise<ChatResult> {
    const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
    const messages = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role, content: message.content }));

    const response = await fetch(`${this.config.baseUrl}/messages`, {
      method: 'POST',
      headers: this.headers(),
      signal: request.signal,
      body: JSON.stringify({
        model: request.model,
        system: system || undefined,
        messages,
        max_tokens: request.maxOutputTokens ?? 4096,
      }),
    });
    const rawPayload = await readJsonObject(response);
    assertOk(response, this.config, rawPayload);
    const payload = rawPayload as AnthropicChatResponse;

    const text = Array.isArray(payload.content)
      ? payload.content
          .filter((block): block is AnthropicContentBlock & { type: 'text'; text: string } => block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('')
      : '';

    return {
      provider: this.config.id,
      model: String(payload.model ?? request.model),
      text,
      usage: {
        inputTokens: payload.usage?.input_tokens,
        outputTokens: payload.usage?.output_tokens,
      },
    };
  }

  private async chatGemini(request: ChatRequest): Promise<ChatResult> {
    const key = getProviderApiKey(this.config);
    const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
    const contents = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      }));

    const response = await fetch(
      `${this.config.baseUrl}/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: this.headers(),
        signal: request.signal,
        body: JSON.stringify({
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          contents,
          generationConfig: request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : undefined,
        }),
      },
    );
    const rawPayload = await readJsonObject(response);
    assertOk(response, this.config, rawPayload);
    const payload = rawPayload as GeminiChatResponse;

    const parts = payload.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.map((part) => part.text ?? '').join('')
      : '';

    return {
      provider: this.config.id,
      model: request.model,
      text,
      usage: {
        inputTokens: payload.usageMetadata?.promptTokenCount,
        outputTokens: payload.usageMetadata?.candidatesTokenCount,
        totalTokens: payload.usageMetadata?.totalTokenCount,
      },
    };
  }
}
