import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { ThemeProvider } from "@/components/theme-provider";
import { readSession } from "@/lib/auth";
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
    default: "DealForge — Discover the best deals",
    template: "%s · DealForge",
  },
  description:
    "DealForge helps you discover trending products, flash deals, and savings from affiliate retailers including Amazon, eBay, and AliExpress.",
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

  return (
    <html lang="en" className={`${manrope.variable} ${fraunces.variable} h-full`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col antialiased">
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
