import type { Metadata } from 'next';
import { Share_Tech_Mono } from 'next/font/google';
import scenario from '../range/royal-duke/scenario.json';
import './globals.css';

const terminal = Share_Tech_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  weight: '400',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://royal-duke-cyber-range.lrd01.chatgpt.site'),
  title: `${scenario.experience.brand.title} | Auburn AIS`,
  description: scenario.experience.brand.thesis,
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title: scenario.experience.brand.title,
    description: scenario.experience.brand.thesis,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: scenario.experience.brand.title }],
  },
  twitter: {
    card: 'summary_large_image',
    title: scenario.experience.brand.title,
    description: scenario.experience.brand.thesis,
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
