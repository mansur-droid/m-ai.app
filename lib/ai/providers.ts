import type { ProviderConfig, ProviderId } from '@/lib/ai/types';

const providers: Record<ProviderId, ProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModelEnv: 'OPENAI_DEFAULT_MODEL',
    protocol: 'openai-compatible',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    defaultModelEnv: 'ANTHROPIC_DEFAULT_MODEL',
    protocol: 'anthropic',
  },
  google: {
    id: 'google',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
    defaultModelEnv: 'GOOGLE_DEFAULT_MODEL',
    protocol: 'gemini',
  },
  grok: {
    id: 'grok',
    name: 'Grok',
    baseUrl: 'https://api.x.ai/v1',
    apiKeyEnv: 'XAI_API_KEY',
    defaultModelEnv: 'XAI_DEFAULT_MODEL',
    protocol: 'openai-compatible',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModelEnv: 'DEEPSEEK_DEFAULT_MODEL',
    protocol: 'openai-compatible',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    defaultModelEnv: 'OPENROUTER_DEFAULT_MODEL',
    protocol: 'openai-compatible',
  },
};

export const providerIds = Object.keys(providers) as ProviderId[];

export function getProviderConfig(provider: ProviderId): ProviderConfig {
  return providers[provider];
}

export function getConfiguredProviderIds(): ProviderId[] {
  return providerIds.filter((id) => Boolean(process.env[providers[id].apiKeyEnv]));
}

export function getProviderApiKey(config: ProviderConfig): string {
  const key = process.env[config.apiKeyEnv];
  if (!key) throw new Error(`${config.name} is not configured. Missing ${config.apiKeyEnv}.`);
  return key;
}

export function getDefaultModel(config: ProviderConfig): string | undefined {
  return process.env[config.defaultModelEnv];
}

export function publicProviderMetadata() {
  return providerIds.map((id) => ({
    id,
    name: providers[id].name,
    configured: Boolean(process.env[providers[id].apiKeyEnv]),
    defaultModel: process.env[providers[id].defaultModelEnv] ?? null,
  }));
}
