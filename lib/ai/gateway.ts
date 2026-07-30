import { HttpAIProvider } from '@/lib/ai/http-provider';
import {
  getDefaultModel,
  getProviderConfig,
  getProviderApiKey,
} from '@/lib/ai/providers';
import type {
  AIProvider,
  ChatRequest,
  ChatResult,
  ModelDescriptor,
  ProviderId,
} from '@/lib/ai/types';

const providerCache = new Map<ProviderId, AIProvider>();

export function getAIProvider(providerId: ProviderId): AIProvider {
  const existing = providerCache.get(providerId);
  if (existing) return existing;

  const provider = new HttpAIProvider(getProviderConfig(providerId));
  providerCache.set(providerId, provider);
  return provider;
}

export function assertProviderConfigured(providerId: ProviderId): void {
  getProviderApiKey(getProviderConfig(providerId));
}

export async function listProviderModels(
  providerId: ProviderId,
  signal?: AbortSignal,
): Promise<ModelDescriptor[]> {
  assertProviderConfigured(providerId);
  return getAIProvider(providerId).listModels(signal);
}

export async function generateChatCompletion(
  request: Omit<ChatRequest, 'model'> & { model?: string },
): Promise<ChatResult> {
  const config = getProviderConfig(request.provider);
  assertProviderConfigured(request.provider);

  const model = request.model || getDefaultModel(config);
  if (!model) {
    throw new Error(
      `No model selected for ${config.name}. Select one in the interface or set ${config.defaultModelEnv}.`,
    );
  }

  if (!request.messages.length) throw new Error('At least one chat message is required.');

  return getAIProvider(request.provider).chat({ ...request, model });
}
