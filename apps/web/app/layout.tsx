import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppLoader } from "./components/app-loader";
import { BrandCursor } from "./components/brand-cursor";
import { ThemeProvider } from "./components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "HolyMedia MCP",
  description: "Управление рекламными кабинетами и аналитика HolyMedia MCP.",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=localStorage.getItem('holymedia-theme');var v=p==='light'||p==='dark'||p==='system'?p:'system';var t=v==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):v;document.documentElement.dataset.theme=t;document.documentElement.dataset.themePreference=v;document.documentElement.style.colorScheme=t;}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <AppLoader />
          <BrandCursor />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
