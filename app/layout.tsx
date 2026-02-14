import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat-ZCB | 탄소중립건축인증 AI 챗봇",
  description: "탄소중립건축인증(ZCB인증) AI 질의응답 챗봇 서비스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
