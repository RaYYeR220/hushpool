import type { Metadata } from "next";
import { Manrope } from "next/font/google";

import { Providers } from "./providers";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Hushpool — nobody knows who won",
  description:
    "Confidential no-loss prize savings. Deposits, balances and winnings stay encrypted, and the winner of a draw is never revealed to anyone.",
};

export const viewport = {
  colorScheme: "only light",
  themeColor: "#e6e9f0",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
