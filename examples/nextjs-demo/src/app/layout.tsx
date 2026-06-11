import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Better Auth Tenancy Demo",
  description: "Demo app showcasing the @better-auth/tenancy plugin",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
