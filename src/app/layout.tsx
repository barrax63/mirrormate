import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";

// Rendered on each request, so <html lang> and the UI text follow LOCALE and config/app.yaml as
// the server finds them, not as they were when the app was built
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mirror Mate",
  description: "Your friendly AI companion for smart mirror displays",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className="antialiased" suppressHydrationWarning>
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
