import type { Metadata, Viewport } from "next";
import { Geist_Mono, Gowun_Dodum, Jua } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// 제목·숫자·버튼은 Jua, 본문은 Gowun Dodum. 한글 글리프는 next/font 가 함께 내려받는다.
const gowun = Gowun_Dodum({ variable: "--font-gowun", weight: "400", subsets: ["latin"] });
const jua = Jua({ variable: "--font-jua", weight: "400", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "던전 포장마차",
  description: "던전 상업 조합 관리 콘솔",
};

// 안전 영역(노치·홈 바)까지 그릴 수 있게 한다: 하단 탭 바가 env(safe-area-inset-bottom)로 여백을 둔다
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`dark ${gowun.variable} ${jua.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
