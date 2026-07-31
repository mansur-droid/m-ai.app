'use client';

import {
  FormEvent,
  Fragment,
  KeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';

type Provider = { id: string; name: string; configured: boolean; defaultModel: string | null };
type Model = { id: string; name: string; provider: string; contextWindow?: number };
type Conversation = { id: string; title: string; provider: string | null; model: string | null; created_at: string; updated_at: string };
type Message = { id: string; role: 'system' | 'user' | 'assistant' | 'tool'; content: string; metadata?: Record<string, unknown>; created_at: string; streaming?: boolean };
type Usage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };
type StreamEvent =
  | { type: 'start'; provider: string; model: string; conversationId?: string }
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'done'; finishReason?: string }
  | { type: 'error'; message: string };

const starterPrompts = [
  'Plan my week around my highest priorities',
  'Turn my business idea into a practical launch plan',
  'Help me reason through a difficult decision',
];

function temporaryId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function readError(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string') return error;
  }
  return `Request failed with status ${response.status}.`;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return tokens.map((token, index) => {
    if (token.startsWith('`') && token.endsWith('`')) return <code key={index}>{token.slice(1, -1)}</code>;
    if (token.startsWith('**') && token.endsWith('**')) return <strong key={index}>{token.slice(2, -2)}</strong>;
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return <Fragment key={index}>{token}</Fragment>;
  });
}

function Markdown({ content }: { content: string }) {
  const blocks = content.split(/```/g);
  return (
    <div className="markdown-body">
      {blocks.map((block, index) => {
        if (index % 2 === 1) {
          const firstNewline = block.indexOf('\n');
          const language = firstNewline >= 0 ? block.slice(0, firstNewline).trim() : '';
          const code = firstNewline >= 0 ? block.slice(firstNewline + 1) : block;
          return (
            <div className="code-block" key={index}>
              <div className="code-header"><span>{language || 'code'}</span><button type="button" onClick={() => navigator.clipboard.writeText(code)}>Copy</button></div>
              <pre><code>{code.trimEnd()}</code></pre>
            </div>
          );
        }
        const lines = block.split('\n');
        const output: ReactNode[] = [];
        let list: string[] = [];
        const flushList = () => {
          if (!list.length) return;
          output.push(<ul key={`list-${output.length}`}>{list.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}</ul>);
          list = [];
        };
        lines.forEach((line, lineIndex) => {
          if (/^[-*] /.test(line)) { list.push(line.slice(2)); return; }
          flushList();
          if (!line.trim()) output.push(<div className="markdown-gap" key={`gap-${lineIndex}`} />);
          else if (line.startsWith('### ')) output.push(<h3 key={lineIndex}>{renderInlineMarkdown(line.slice(4))}</h3>);
          else if (line.startsWith('## ')) output.push(<h2 key={lineIndex}>{renderInlineMarkdown(line.slice(3))}</h2>);
          else if (line.startsWith('# ')) output.push(<h1 key={lineIndex}>{renderInlineMarkdown(line.slice(2))}</h1>);
          else if (line.startsWith('> ')) output.push(<blockquote key={lineIndex}>{renderInlineMarkdown(line.slice(2))}</blockquote>);
          else output.push(<p key={lineIndex}>{renderInlineMarkdown(line)}</p>);
        });
        flushList();
        return <Fragment key={index}>{output}</Fragment>;
      })}
    </div>
  );
}

export default function ChatWorkspace({ displayName }: { displayName: string }) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messageViewportRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  const activeConversation = useMemo(() => conversations.find((conversation) => conversation.id === activeConversationId) ?? null, [activeConversationId, conversations]);

  const authenticatedFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init);
    if (response.status === 401) {
      router.replace('/login?next=/');
      throw new Error('Your session expired. Please sign in again.');
    }
    return response;
  }, [router]);

  const refreshConversations = useCallback(async () => {
    const response = await authenticatedFetch('/api/conversations', { cache: 'no-store' });
    if (!response.ok) throw new Error(await readError(response));
    const payload = await response.json() as { conversations: Conversation[] };
    setConversations(payload.conversations);
  }, [authenticatedFetch]);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        setIsLoadingHistory(true);
        const [providerResponse, conversationResponse] = await Promise.all([
          authenticatedFetch('/api/ai/providers', { cache: 'no-store' }),
          authenticatedFetch('/api/conversations', { cache: 'no-store' }),
        ]);
        if (!providerResponse.ok) throw new Error(await readError(providerResponse));
        if (!conversationResponse.ok) throw new Error(await readError(conversationResponse));
        const providerPayload = await providerResponse.json() as { providers: Provider[] };
        const conversationPayload = await conversationResponse.json() as { conversations: Conversation[] };
        if (cancelled) return;
        const configured = providerPayload.providers.filter((provider) => provider.configured);
        setProviders(configured);
        setConversations(conversationPayload.conversations);
        const storedProvider = window.localStorage.getItem('m.ai.provider');
        setSelectedProvider(configured.find((provider) => provider.id === storedProvider)?.id ?? configured[0]?.id ?? '');
      } catch (bootstrapError) {
        if (!cancelled) setError(bootstrapError instanceof Error ? bootstrapError.message : 'Could not load the workspace.');
      } finally {
        if (!cancelled) setIsLoadingHistory(false);
      }
    }
    void bootstrap();
    return () => { cancelled = true; };
  }, [authenticatedFetch]);

  useEffect(() => {
    if (!selectedProvider) { setModels([]); setSelectedModel(''); return; }
    let cancelled = false;
    async function loadModels() {
      try {
        setIsLoadingModels(true);
        setError(null);
        const response = await authenticatedFetch(`/api/ai/models/${encodeURIComponent(selectedProvider)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(await readError(response));
        const payload = await response.json() as { models: Model[] };
        if (cancelled) return;
        setModels(payload.models);
        const storedModel = window.localStorage.getItem(`m.ai.model.${selectedProvider}`);
        const activeModel = activeConversation?.provider === selectedProvider ? activeConversation.model : null;
        setSelectedModel(payload.models.find((model) => model.id === activeModel)?.id ?? payload.models.find((model) => model.id === storedModel)?.id ?? payload.models[0]?.id ?? '');
      } catch (modelError) {
        if (!cancelled) { setModels([]); setSelectedModel(''); setError(modelError instanceof Error ? modelError.message : 'Could not load models.'); }
      } finally {
        if (!cancelled) setIsLoadingModels(false);
      }
    }
    window.localStorage.setItem('m.ai.provider', selectedProvider);
    void loadModels();
    return () => { cancelled = true; };
  }, [activeConversation?.model, activeConversation?.provider, authenticatedFetch, selectedProvider]);

  useEffect(() => {
    if (selectedProvider && selectedModel) window.localStorage.setItem(`m.ai.model.${selectedProvider}`, selectedModel);
  }, [selectedModel, selectedProvider]);

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    const viewport = messageViewportRef.current;
    if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior: isStreaming ? 'auto' : 'smooth' });
  }, [messages, isStreaming]);

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    setActiveConversationId(null);
    setMessages([]);
    setPrompt('');
    setUsage(null);
    setError(null);
    setSidebarOpen(false);
    shouldAutoScrollRef.current = true;
  }, []);

  const openConversation = useCallback(async (conversation: Conversation) => {
    if (isStreaming) abortRef.current?.abort();
    try {
      setIsLoadingConversation(true);
      setError(null);
      const response = await authenticatedFetch(`/api/conversations/${conversation.id}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json() as { conversation: Conversation; messages: Message[] };
      setActiveConversationId(payload.conversation.id);
      setMessages(payload.messages);
      if (payload.conversation.provider) setSelectedProvider(payload.conversation.provider);
      if (payload.conversation.model) setSelectedModel(payload.conversation.model);
      setSidebarOpen(false);
      shouldAutoScrollRef.current = true;
    } catch (conversationError) {
      setError(conversationError instanceof Error ? conversationError.message : 'Could not open the conversation.');
    } finally {
      setIsLoadingConversation(false);
    }
  }, [authenticatedFetch, isStreaming]);

  const renameConversation = useCallback(async (conversation: Conversation) => {
    const title = window.prompt('Rename conversation', conversation.title)?.trim();
    if (!title || title === conversation.title) return;
    try {
      const response = await authenticatedFetch(`/api/conversations/${conversation.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json() as { conversation: Conversation };
      setConversations((items) => items.map((item) => item.id === conversation.id ? payload.conversation : item));
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : 'Could not rename the conversation.');
    }
  }, [authenticatedFetch]);

  const deleteConversation = useCallback(async (conversation: Conversation) => {
    if (!window.confirm(`Delete “${conversation.title}”? This cannot be undone.`)) return;
    try {
      const response = await authenticatedFetch(`/api/conversations/${conversation.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await readError(response));
      setConversations((items) => items.filter((item) => item.id !== conversation.id));
      if (activeConversationId === conversation.id) newConversation();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the conversation.');
    }
  }, [activeConversationId, authenticatedFetch, newConversation]);

  async function submitPrompt(event: FormEvent) {
    event.preventDefault();
    const content = prompt.trim();
    if (!content || isStreaming) return;
    if (!selectedProvider || !selectedModel) { setError('Select a configured provider and model before sending.'); return; }

    const userMessage: Message = { id: temporaryId('user'), role: 'user', content, created_at: new Date().toISOString() };
    const assistantId = temporaryId('assistant');
    const requestMessages = [...messages, userMessage]
      .filter((message) => message.role === 'user' || message.role === 'assistant' || message.role === 'system')
      .map((message) => ({ role: message.role, content: message.content }));

    setPrompt('');
    setError(null);
    setUsage(null);
    setIsStreaming(true);
    shouldAutoScrollRef.current = true;
    setMessages((items) => [...items, userMessage, { id: assistantId, role: 'assistant', content: '', created_at: new Date().toISOString(), streaming: true }]);

    const controller = new AbortController();
    abortRef.current = controller;
    let createdConversationId = activeConversationId;

    try {
      const response = await authenticatedFetch('/api/ai/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ provider: selectedProvider, model: selectedModel, conversationId: activeConversationId, messages: requestMessages }),
      });
      if (!response.ok) throw new Error(await readError(response));
      if (!response.body) throw new Error('The provider returned an empty stream.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;

      while (!finished) {
        const { value, done } = await reader.read();
        finished = done;
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
          if (!dataLine) continue;
          const streamEvent = JSON.parse(dataLine.slice(6)) as StreamEvent;
          if (streamEvent.type === 'start') {
            if (streamEvent.conversationId) { createdConversationId = streamEvent.conversationId; setActiveConversationId(streamEvent.conversationId); }
            setSelectedProvider(streamEvent.provider);
            setSelectedModel(streamEvent.model);
          } else if (streamEvent.type === 'delta') {
            setMessages((items) => items.map((message) => message.id === assistantId ? { ...message, content: message.content + streamEvent.text } : message));
          } else if (streamEvent.type === 'usage') setUsage(streamEvent.usage);
          else if (streamEvent.type === 'error') throw new Error(streamEvent.message);
        }
      }
      setMessages((items) => items.map((message) => message.id === assistantId ? { ...message, streaming: false } : message));
      await refreshConversations();
    } catch (streamError) {
      const aborted = controller.signal.aborted || (streamError instanceof DOMException && streamError.name === 'AbortError');
      setMessages((items) => items.map((message) => message.id === assistantId ? { ...message, streaming: false } : message));
      if (!aborted) setError(streamError instanceof Error ? streamError.message : 'Generation failed.');
      if (createdConversationId) window.setTimeout(() => { void refreshConversations(); }, 300);
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
  }

  function handleViewportScroll() {
    const viewport = messageViewportRef.current;
    if (viewport) shouldAutoScrollRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120;
  }

  return (
    <main className="app-shell chat-app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open menu">☰</button>
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-row"><div className="brand-mark">m</div><div><strong>m.ai</strong><span>Personal AI</span></div><button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">×</button></div>
        <button className="new-session" onClick={newConversation}><span>＋</span> New chat<kbd>⌘ K</kbd></button>
        <div className="history-panel real-history-panel">
          <div className="history-heading"><p className="nav-label">Conversations</p><span>{conversations.length}</span></div>
          <div className="history-list conversation-list">
            {isLoadingHistory ? <p className="empty-history">Loading conversations…</p> : null}
            {!isLoadingHistory && !conversations.length ? <p className="empty-history">Your conversations will appear here.</p> : null}
            {conversations.map((conversation) => (
              <div className={`conversation-row ${activeConversationId === conversation.id ? 'active' : ''}`} key={conversation.id}>
                <button className="conversation-open" onClick={() => void openConversation(conversation)}><span className="history-icon">✦</span><span><b>{conversation.title}</b><small>{conversation.provider ?? 'Chat'} · {formatRelativeTime(conversation.updated_at)}</small></span></button>
                <div className="conversation-actions"><button type="button" onClick={() => void renameConversation(conversation)} title="Rename">✎</button><button type="button" onClick={() => void deleteConversation(conversation)} title="Delete">×</button></div>
              </div>
            ))}
          </div>
        </div>
        <div className="sidebar-footer"><button onClick={() => setSettingsOpen(true)}><span>⚙</span><span><b>Settings</b><small>Provider and model</small></span></button><div className="profile-card"><div className="avatar">{displayName.slice(0, 1).toUpperCase()}</div><div><b>{displayName}</b><small>Authenticated workspace</small></div><span className="online-dot" /></div></div>
      </aside>
      {sidebarOpen ? <button className="scrim" onClick={() => setSidebarOpen(false)} aria-label="Close menu overlay" /> : null}

      <section className="workspace chat-workspace">
        <header className="topbar chat-topbar"><div className="status"><span className="pulse" />{isStreaming ? 'Generating response' : activeConversation?.title ?? 'New conversation'}</div><div className="top-actions model-controls">
          <select value={selectedProvider} onChange={(event) => setSelectedProvider(event.target.value)} disabled={isStreaming || !providers.length} aria-label="Provider">{!providers.length ? <option value="">No configured providers</option> : null}{providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.name}</option>)}</select>
          <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} disabled={isStreaming || isLoadingModels || !models.length} aria-label="Model">{isLoadingModels ? <option value="">Loading models…</option> : null}{!isLoadingModels && !models.length ? <option value="">No models available</option> : null}{models.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Open settings">⚙</button>
        </div></header>

        <div className="message-viewport" ref={messageViewportRef} onScroll={handleViewportScroll}>
          {isLoadingConversation ? <div className="conversation-loader"><span className="spinner" /> Loading conversation…</div> : null}
          {!isLoadingConversation && !messages.length ? <div className="chat-empty-state"><div className="mode-orb"><span>✦</span></div><p className="eyebrow">PERSONAL INTELLIGENCE</p><h1>What are we building?</h1><p className="subtitle">One workspace for ideas, decisions, research and execution.</p><div className="starter-grid">{starterPrompts.map((starter) => <button key={starter} onClick={() => setPrompt(starter)}><span>↗</span>{starter}</button>)}</div></div> : null}
          <div className="message-list">{messages.filter((message) => message.role === 'user' || message.role === 'assistant').map((message) => <article className={`message-row ${message.role}`} key={message.id}><div className="message-avatar">{message.role === 'user' ? displayName.slice(0, 1).toUpperCase() : 'm'}</div><div className="message-content"><div className="message-label">{message.role === 'user' ? 'You' : 'm.ai'}{message.streaming ? <span className="streaming-label">Thinking</span> : null}</div>{message.role === 'assistant' ? (message.content ? <Markdown content={message.content} /> : <div className="typing-dots"><span /><span /><span /></div>) : <p className="user-copy">{message.content}</p>}{message.content ? <button className="copy-message" type="button" onClick={() => navigator.clipboard.writeText(message.content)}>Copy</button> : null}</div></article>)}</div>
        </div>

        <div className="chat-composer-wrap">{error ? <div className="notice error-notice"><span>!</span>{error}<button onClick={() => setError(null)}>×</button></div> : null}<form className="composer chat-composer" onSubmit={submitPrompt}><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder={selectedProvider ? 'Ask m.ai anything…' : 'Configure a provider to start chatting…'} rows={3} disabled={isStreaming} /><div className="composer-footer"><div className="tool-row"><span>{selectedProvider && selectedModel ? `${providers.find((provider) => provider.id === selectedProvider)?.name ?? selectedProvider} · ${selectedModel}` : 'No model selected'}</span>{usage ? <span>{usage.totalTokens ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0))} tokens</span> : null}</div>{isStreaming ? <button className="stop-button" type="button" onClick={() => abortRef.current?.abort()}><span>■</span> Stop</button> : <button className="submit-button" disabled={!prompt.trim() || !selectedProvider || !selectedModel}><span>Send</span><span>→</span></button>}</div></form><p className="chat-disclaimer">m.ai can make mistakes. Verify important information.</p></div>
      </section>

      {settingsOpen ? <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Model settings"><button className="modal-scrim" onClick={() => setSettingsOpen(false)} aria-label="Close settings" /><section className="settings-modal"><div className="modal-header"><div><p className="eyebrow">AI GATEWAY</p><h2>Model settings</h2></div><button onClick={() => setSettingsOpen(false)}>×</button></div><div className="setting-row"><span><b>Provider</b><small>Only server-configured providers are shown.</small></span><select value={selectedProvider} onChange={(event) => setSelectedProvider(event.target.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></div><div className="setting-row"><span><b>Model</b><small>Loaded live from the selected provider.</small></span><select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></div><button className="save-settings" onClick={() => setSettingsOpen(false)}>Save selection</button></section></div> : null}
    </main>
  );
}
