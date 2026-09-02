import type { Metadata } from "next";

import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hushpool — nobody knows who won",
  description:
    "Confidential no-loss prize savings. Deposits, balances and winnings stay encrypted, and the winner of a draw is never revealed to anyone.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
