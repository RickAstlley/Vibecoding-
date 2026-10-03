import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Arcanum Weaver',
  description: 'IDE de vibecoding com edicao cirurgica, leitura de ZIP, preview e agentes com ping continuo',
  applicationName: 'Arcanum Weaver',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#0d0f16',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="overflow-hidden">{children}</body>
    </html>
  );
}