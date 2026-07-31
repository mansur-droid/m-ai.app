import {
  AIProviderError,
  type AIProvider,
  type ChatRequest,
  type ChatResult,
  type ChatStreamEvent,
  type ModelDescriptor,
  type ProviderConfig,
  type TokenUsage,
} from '@/lib/ai/types';
import { getProviderApiKey } from '@/lib/ai/providers';
import { parseJsonRecord, parseServerSentEvents } from '@/lib/ai/streaming';

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

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function asRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonRecord => asRecord(item) !== undefined)
    : [];
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function readJsonObject(response: Response): Promise<JsonRecord> {
  const payload: unknown = await response.json().catch(() => ({}));
  return asRecord(payload) ?? {};
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

function requireBody(response: Response, config: ProviderConfig): ReadableStream<Uint8Array> {
  if (!response.body) {
    throw new AIProviderError(`${config.name} returned an empty stream.`, config.id, 502);
  }
  return response.body;
}

function openAIUsage(value: unknown): TokenUsage | undefined {
  const usage = asRecord(value);
  if (!usage) return undefined;
  return {
    inputTokens: asNumber(usage.prompt_tokens),
    outputTokens: asNumber(usage.completion_tokens),
    totalTokens: asNumber(usage.total_tokens),
  };
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
    const rawModels = asRecordArray(payload.data ?? payload.models);

    return rawModels
      .map((model): ModelDescriptor | null => {
        const rawId = String(model.id ?? model.name ?? '');
        if (!rawId) return null;
        const id = rawId.replace(/^models\//, '');
        const methods = Array.isArray(model.supportedGenerationMethods)
          ? model.supportedGenerationMethods.map(String)
          : [];
        if (this.config.protocol === 'gemini' && methods.length && !methods.includes('generateContent')) return null;

        const architecture = asRecord(model.architecture) ?? {};
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

  async *streamChat(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    if (request.provider !== this.config.id) {
      throw new AIProviderError('Provider mismatch in gateway request.', this.config.id, 400);
    }

    yield { type: 'start', provider: this.config.id, model: request.model };
    if (this.config.protocol === 'anthropic') {
      yield* this.streamAnthropic(request);
      return;
    }
    if (this.config.protocol === 'gemini') {
      yield* this.streamGemini(request);
      return;
    }
    yield* this.streamOpenAICompatible(request);
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

  private async *streamOpenAICompatible(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      signal: request.signal,
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        max_tokens: request.maxOutputTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });
    if (!response.ok) {
      const details = await readError(response);
      assertOk(response, this.config, details);
    }

    for await (const event of parseServerSentEvents(requireBody(response, this.config))) {
      if (event.data === '[DONE]') {
        yield { type: 'done' };
        return;
      }
      const payload = parseJsonRecord(event.data);
      if (!payload) continue;

      const choice = asRecordArray(payload.choices)[0];
      const delta = asRecord(choice?.delta);
      const text = typeof delta?.content === 'string' ? delta.content : '';
      if (text) yield { type: 'delta', text };

      const usage = openAIUsage(payload.usage);
      if (usage) yield { type: 'usage', usage };

      const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined;
      if (finishReason) yield { type: 'done', finishReason };
    }

    yield { type: 'done' };
  }

  private anthropicBody(request: ChatRequest, stream: boolean): JsonRecord {
    const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
    const messages = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role, content: message.content }));

    return {
      model: request.model,
      system: system || undefined,
      messages,
      max_tokens: request.maxOutputTokens ?? 4096,
      stream,
    };
  }

  private async chatAnthropic(request: ChatRequest): Promise<ChatResult> {
    const response = await fetch(`${this.config.baseUrl}/messages`, {
      method: 'POST',
      headers: this.headers(),
      signal: request.signal,
      body: JSON.stringify(this.anthropicBody(request, false)),
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

  private async *streamAnthropic(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const response = await fetch(`${this.config.baseUrl}/messages`, {
      method: 'POST',
      headers: this.headers(),
      signal: request.signal,
      body: JSON.stringify(this.anthropicBody(request, true)),
    });
    if (!response.ok) {
      const details = await readError(response);
      assertOk(response, this.config, details);
    }

    for await (const event of parseServerSentEvents(requireBody(response, this.config))) {
      const payload = parseJsonRecord(event.data);
      if (!payload) continue;

      if (event.event === 'content_block_delta') {
        const delta = asRecord(payload.delta);
        const text = typeof delta?.text === 'string' ? delta.text : '';
        if (text) yield { type: 'delta', text };
      }

      if (event.event === 'message_start') {
        const message = asRecord(payload.message);
        const usage = asRecord(message?.usage);
        const inputTokens = asNumber(usage?.input_tokens);
        if (inputTokens !== undefined) yield { type: 'usage', usage: { inputTokens } };
      }

      if (event.event === 'message_delta') {
        const usage = asRecord(payload.usage);
        const outputTokens = asNumber(usage?.output_tokens);
        if (outputTokens !== undefined) yield { type: 'usage', usage: { outputTokens } };
        const delta = asRecord(payload.delta);
        const finishReason = typeof delta?.stop_reason === 'string' ? delta.stop_reason : undefined;
        if (finishReason) yield { type: 'done', finishReason };
      }

      if (event.event === 'error') {
        const error = asRecord(payload.error);
        throw new AIProviderError(
          typeof error?.message === 'string' ? error.message : 'Anthropic stream failed.',
          this.config.id,
          502,
          payload,
        );
      }

      if (event.event === 'message_stop') {
        yield { type: 'done' };
        return;
      }
    }

    yield { type: 'done' };
  }

  private geminiBody(request: ChatRequest): JsonRecord {
    const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
    const contents = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      }));

    return {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents,
      generationConfig: request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : undefined,
    };
  }

  private async chatGemini(request: ChatRequest): Promise<ChatResult> {
    const key = getProviderApiKey(this.config);
    const response = await fetch(
      `${this.config.baseUrl}/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: this.headers(),
        signal: request.signal,
        body: JSON.stringify(this.geminiBody(request)),
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

  private async *streamGemini(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const key = getProviderApiKey(this.config);
    const response = await fetch(
      `${this.config.baseUrl}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: this.headers(),
        signal: request.signal,
        body: JSON.stringify(this.geminiBody(request)),
      },
    );
    if (!response.ok) {
      const details = await readError(response);
      assertOk(response, this.config, details);
    }

    for await (const event of parseServerSentEvents(requireBody(response, this.config))) {
      const payload = parseJsonRecord(event.data);
      if (!payload) continue;
      const candidate = asRecordArray(payload.candidates)[0];
      const content = asRecord(candidate?.content);
      for (const part of asRecordArray(content?.parts)) {
        if (typeof part.text === 'string' && part.text) yield { type: 'delta', text: part.text };
      }

      const usageMetadata = asRecord(payload.usageMetadata);
      if (usageMetadata) {
        yield {
          type: 'usage',
          usage: {
            inputTokens: asNumber(usageMetadata.promptTokenCount),
            outputTokens: asNumber(usageMetadata.candidatesTokenCount),
            totalTokens: asNumber(usageMetadata.totalTokenCount),
          },
        };
      }

      const finishReason = typeof candidate?.finishReason === 'string' ? candidate.finishReason : undefined;
      if (finishReason) yield { type: 'done', finishReason };
    }

    yield { type: 'done' };
  }
}
