import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/ui/themes";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: { default: "AI Trading Coach", template: "%s · AI Trading Coach" },
  description: "An AI-reviewed trading journal for crypto, forex and gold traders.",
};

export const viewport: Viewport = { themeColor: "#0f141c", colorScheme: "dark" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      appearance={{
        theme: dark,
        variables: {
          colorPrimary: "#f0b429",
          colorPrimaryForeground: "#1a1405",
          colorBackground: "#151c27",
          colorForeground: "#e7ecf3",
          colorMutedForeground: "#8c99ac",
          colorInput: "#0f141c",
          colorInputForeground: "#e7ecf3",
          colorBorder: "#233044",
          colorDanger: "#e5484d",
          fontFamily: '"IBM Plex Sans Variable", system-ui, sans-serif',
          borderRadius: "6px",
        },
      }}
    >
      <html lang="en">
        <body className="min-h-dvh">{children}</body>
      </html>
    </ClerkProvider>
  );
}
