import type { Metadata } from 'next';
import { Share_Tech_Mono } from 'next/font/google';
import './globals.css';

const terminal = Share_Tech_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  weight: '400',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://royal-duke-cyber-range.lrd01.chatgpt.site'),
  title: 'Royal Duke Cyber Range | Auburn AIS',
  description: 'An interactive cyber-physical mission showing how enterprise compromise can propagate into industrial operations.',
  openGraph: {
    title: 'Royal Duke Cyber Range',
    description: 'When the Brainstem Bleeds.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Royal Duke Cyber Range — When the Brainstem Bleeds' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Royal Duke Cyber Range',
    description: 'When the Brainstem Bleeds.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={terminal.variable}>
        {children}
      </body>
    </html>
  );
}
