import type { Metadata } from "next";
import Script from "next/script";
import { Fraunces, Manrope } from "next/font/google";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { ThemeProvider } from "@/components/theme-provider";
import { readSession } from "@/lib/auth";
import { normalizeAdsenseClient } from "@/lib/ads";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

function resolveAppUrl() {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (raw) {
    try {
      return new URL(raw);
    } catch {
      /* fall through */
    }
  }
  if (process.env.VERCEL_URL) {
    return new URL(`https://${process.env.VERCEL_URL}`);
  }
  return new URL("http://localhost:3000");
}

export const metadata: Metadata = {
  title: {
    default: "DealForge — Discover better deals",
    template: "%s · DealForge",
  },
  description:
    "DealForge helps you discover useful products, recent deals, and affiliate offers from trusted retailers including Amazon.",
  metadataBase: resolveAppUrl(),
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let session = null;
  try {
    session = await readSession();
  } catch {
    session = null;
  }

  const adsenseClient = normalizeAdsenseClient();

  return (
    <html lang="en" className={`${manrope.variable} ${fraunces.variable} h-full`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col antialiased">
        {adsenseClient ? (
          <Script
            id="dealforge-adsense"
            async
            strategy="afterInteractive"
            crossOrigin="anonymous"
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(adsenseClient)}`}
          />
        ) : null}
        <ThemeProvider>
          <Header
            user={
              session
                ? { name: session.name, role: session.role, email: session.email }
                : null
            }
          />
          <main className="flex-1">{children}</main>
          <Footer />
        </ThemeProvider>
      </body>
    </html>
  );
}
