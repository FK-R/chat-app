import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Chat", description: "Real-time private and group chat" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
