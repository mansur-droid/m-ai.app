export type ProviderId = 'openai' | 'anthropic' | 'google' | 'grok' | 'deepseek' | 'openrouter';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ModelDescriptor {
  id: string;
  name: string;
  provider: ProviderId;
  contextWindow?: number;
  inputModalities?: string[];
  outputModalities?: string[];
}

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  baseUrl: string;
  apiKeyEnv: string;
  defaultModelEnv: string;
  protocol: 'openai-compatible' | 'anthropic' | 'gemini';
}

export interface ChatRequest {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  provider: ProviderId;
  model: string;
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface AIProvider {
  readonly config: ProviderConfig;
  listModels(signal?: AbortSignal): Promise<ModelDescriptor[]>;
  chat(request: ChatRequest): Promise<ChatResult>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: ProviderId,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}
