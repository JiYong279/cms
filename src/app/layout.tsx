import type { Metadata } from "next";
import { Geist_Mono, Manrope } from "next/font/google";
import { TimeZoneSync } from "@/components/time-zone-sync";
import { I18nProvider } from "@/i18n/client";
import { getLang, getTimeZone } from "@/i18n/server";
import "./globals.css";

// Same typeface as qub-x.com.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "vietnamese"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Qub-X Studio",
  description: "Qub-X Studio",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lang = await getLang();
  const timeZone = await getTimeZone();
  return (
    <html lang={lang} className={`${manrope.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <I18nProvider lang={lang}>{children}</I18nProvider>
        <TimeZoneSync current={timeZone} />
      </body>
    </html>
  );
}
