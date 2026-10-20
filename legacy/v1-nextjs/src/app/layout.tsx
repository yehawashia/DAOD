import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DAOD — See the maths. Understand the idea.",
  description: "AI-powered visual maths tutor for KS3 students.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
