import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#030712",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: {
    default: "GDG Cloud Mumbai — Cinematic Scrollytelling",
    template: "%s | GDG Cloud Mumbai",
  },
  description:
    "A cinematic scroll-driven experience showcasing the energy and spirit of Mumbai's cloud developer community.",
  metadataBase: new URL("https://gdgcloudmumbai.dev"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} antialiased`}>
      <head>
        <link rel="dns-prefetch" href="//cdn.jsdelivr.net" />
        <link
          rel="preconnect"
          href="https://cdn.jsdelivr.net"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-screen bg-[#030712] text-[#f8fafc]">
        {children}
      </body>
    </html>
  );
}
