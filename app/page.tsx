'use client';

import { ChangeEvent, FormEvent, useMemo, useRef, useState } from 'react';

type Mode = 'chat' | 'image' | 'edit' | 'video';
type HistoryItem = { id: number; mode: Mode; title: string; time: string };

const modes: Array<{ id: Mode; label: string; description: string; icon: string }> = [
  { id: 'chat', label: 'Chat', description: 'Think, write and build', icon: '✦' },
  { id: 'image', label: 'Create image', description: 'Turn ideas into visuals', icon: '◈' },
  { id: 'edit', label: 'Edit image', description: 'Transform an upload', icon: '◇' },
  { id: 'video', label: 'Create video', description: 'Animate any concept', icon: '▷' },
];

const starters: Record<Mode, string[]> = {
  chat: ['Plan my week around my priorities', 'Turn my idea into a launch plan', 'Help me think through a hard decision'],
  image: ['Cinematic product campaign', 'Dark futuristic portrait', 'Minimal luxury brand visual'],
  edit: ['Replace the background', 'Make this look cinematic', 'Clean up and enhance the image'],
  video: ['Animate a dramatic camera push-in', 'Create a clean product reveal', 'Turn this scene into a short trailer'],
};

const modeCopy: Record<Mode, { eyebrow: string; title: string; subtitle: string; placeholder: string; action: string }> = {
  chat: {
    eyebrow: 'PERSONAL INTELLIGENCE',
    title: 'What are we building?',
    subtitle: 'One workspace for ideas, decisions, research and execution.',
    placeholder: 'Ask m.ai anything…',
    action: 'Send',
  },
  image: {
    eyebrow: 'IMAGE STUDIO',
    title: 'Create the image in your head.',
    subtitle: 'Describe the subject, mood, lighting and style. m.ai handles the rest.',
    placeholder: 'Describe the image you want to create…',
    action: 'Generate',
  },
  edit: {
    eyebrow: 'IMAGE EDITOR',
    title: 'Change anything. Keep what matters.',
    subtitle: 'Upload an image, describe the edit and control the final direction.',
    placeholder: 'Describe what should change…',
    action: 'Edit image',
  },
  video: {
    eyebrow: 'VIDEO STUDIO',
    title: 'Turn a prompt into motion.',
    subtitle: 'Create short, cinematic clips from text or a reference image.',
    placeholder: 'Describe the scene, movement and camera direction…',
    action: 'Generate video',
  },
};

export default function Home() {
  const [mode, setMode] = useState<Mode>('chat');
  const [prompt, setPrompt] = useState('');
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([
    { id: 1, mode: 'chat', title: 'Personal AI roadmap', time: 'Today' },
    { id: 2, mode: 'image', title: 'Midnight product campaign', time: 'Yesterday' },
    { id: 3, mode: 'video', title: 'Cinematic city reveal', time: '3 days ago' },
  ]);
  const fileInput = useRef<HTMLInputElement>(null);
  const copy = modeCopy[mode];

  const acceptsUpload = mode === 'edit' || mode === 'video';
  const statusText = useMemo(() => {
    if (mode === 'chat') return 'Ready to think';
    if (mode === 'edit' && !uploadedFile) return 'Upload required';
    return 'Studio ready';
  }, [mode, uploadedFile]);

  function selectMode(nextMode: Mode) {
    setMode(nextMode);
    setPrompt('');
    setNotice(null);
    if (nextMode !== 'edit' && nextMode !== 'video') setUploadedFile(null);
    setSidebarOpen(false);
  }

  function handleFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setNotice('Please upload an image file.');
      return;
    }
    setUploadedFile(file.name);
    setNotice(null);
  }

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    handleFile(event.target.files?.[0]);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim()) {
      setNotice('Give m.ai a clear instruction first.');
      return;
    }
    if (mode === 'edit' && !uploadedFile) {
      setNotice('Upload the image you want to edit first.');
      return;
    }

    setNotice(null);
    setIsWorking(true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    setHistory((items) => [
      { id: Date.now(), mode, title: prompt.trim().slice(0, 42), time: 'Just now' },
      ...items,
    ]);
    setIsWorking(false);
    setNotice('Interface complete. Connect an AI provider in the next backend milestone to run this for real.');
  }

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open menu">☰</button>

      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark">m</div>
          <div>
            <strong>m.ai</strong>
            <span>Personal AI</span>
          </div>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">×</button>
        </div>

        <button className="new-session" onClick={() => { setPrompt(''); setNotice(null); }}>
          <span>＋</span> New session
          <kbd>⌘ K</kbd>
        </button>

        <nav className="mode-list" aria-label="AI tools">
          <p className="nav-label">Workspace</p>
          {modes.map((item) => (
            <button
              key={item.id}
              className={`mode-button ${mode === item.id ? 'active' : ''}`}
              onClick={() => selectMode(item.id)}
            >
              <span className="mode-icon">{item.icon}</span>
              <span><b>{item.label}</b><small>{item.description}</small></span>
            </button>
          ))}
        </nav>

        <div className="history-panel">
          <div className="history-heading"><p className="nav-label">Recent</p><button onClick={() => setHistory([])}>Clear</button></div>
          <div className="history-list">
            {history.length ? history.slice(0, 5).map((item) => (
              <button key={item.id} onClick={() => selectMode(item.mode)}>
                <span className="history-icon">{modes.find((entry) => entry.id === item.mode)?.icon}</span>
                <span><b>{item.title}</b><small>{item.time}</small></span>
              </button>
            )) : <p className="empty-history">Your sessions will appear here.</p>}
          </div>
        </div>

        <div className="sidebar-footer">
          <button onClick={() => setSettingsOpen(true)}><span>⚙</span><span><b>Settings</b><small>Models, quality and privacy</small></span></button>
          <div className="profile-card"><div className="avatar">M</div><div><b>Mansur</b><small>Personal workspace</small></div><span className="online-dot" /></div>
        </div>
      </aside>

      {sidebarOpen && <button className="scrim" onClick={() => setSidebarOpen(false)} aria-label="Close menu overlay" />}

      <section className="workspace">
        <header className="topbar">
          <div className="status"><span className="pulse" />{statusText}</div>
          <div className="top-actions">
            <button className="ghost-button">Private mode</button>
            <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Open settings">⚙</button>
          </div>
        </header>

        <div className="hero-content">
          <div className="mode-orb"><span>{modes.find((item) => item.id === mode)?.icon}</span></div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p className="subtitle">{copy.subtitle}</p>

          <form className="composer" onSubmit={handleSubmit}>
            {acceptsUpload && (
              <div
                className={`upload-zone ${dragging ? 'dragging' : ''} ${uploadedFile ? 'has-file' : ''}`}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => { event.preventDefault(); setDragging(false); handleFile(event.dataTransfer.files[0]); }}
              >
                <input ref={fileInput} type="file" accept="image/*" onChange={handleUpload} hidden />
                <button type="button" onClick={() => fileInput.current?.click()}>
                  <span className="upload-icon">↥</span>
                  <span><b>{uploadedFile ?? 'Drop a reference image here'}</b><small>{uploadedFile ? 'Click to replace' : 'or click to browse'}</small></span>
                </button>
                {uploadedFile && <button type="button" className="remove-file" onClick={() => setUploadedFile(null)}>×</button>}
              </div>
            )}

            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={copy.placeholder}
              rows={4}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />

            <div className="composer-footer">
              <div className="tool-row">
                <button type="button" title="Attach file" onClick={() => acceptsUpload && fileInput.current?.click()}>＋</button>
                <button type="button" title="Voice input">⌁</button>
                <span>{mode === 'video' ? '8 sec · 16:9' : mode === 'image' ? '1:1 · HD' : 'm.ai core'}</span>
              </div>
              <button className="submit-button" disabled={isWorking}>
                {isWorking ? <span className="spinner" /> : <>{copy.action}<span>→</span></>}
              </button>
            </div>
          </form>

          {notice && <div className="notice"><span>i</span>{notice}</div>}

          <div className="starter-grid">
            {starters[mode].map((starter) => (
              <button key={starter} onClick={() => setPrompt(starter)}><span>↗</span>{starter}</button>
            ))}
          </div>
        </div>

        <footer className="workspace-footer"><span>m.ai can make mistakes. Keep control of important decisions.</span><span>v0.1 studio</span></footer>
      </section>

      {settingsOpen && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Settings">
          <button className="modal-scrim" onClick={() => setSettingsOpen(false)} aria-label="Close settings" />
          <section className="settings-modal">
            <div className="modal-header"><div><p className="eyebrow">PREFERENCES</p><h2>Studio settings</h2></div><button onClick={() => setSettingsOpen(false)}>×</button></div>
            <div className="setting-row"><span><b>Private by default</b><small>Keep sessions out of shared history.</small></span><label className="toggle"><input type="checkbox" defaultChecked /><i /></label></div>
            <div className="setting-row"><span><b>Generation quality</b><small>Higher quality may take longer.</small></span><select defaultValue="balanced"><option value="fast">Fast</option><option value="balanced">Balanced</option><option value="max">Maximum</option></select></div>
            <div className="setting-row"><span><b>Default model</b><small>Provider connections arrive in the backend milestone.</small></span><select defaultValue="auto"><option value="auto">Auto</option><option value="reasoning">Reasoning</option><option value="creative">Creative</option></select></div>
            <button className="save-settings" onClick={() => setSettingsOpen(false)}>Save settings</button>
          </section>
        </div>
      )}
    </main>
  );
}
