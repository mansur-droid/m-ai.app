import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import './chat.css';

export const metadata: Metadata = {
  title: 'm.ai — Personal AI Studio',
  description: 'A private workspace for AI chat, image creation, image editing and video generation.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#070709',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
