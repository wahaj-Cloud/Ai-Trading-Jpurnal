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
          colorPrimary: "#4d94ff",
          colorPrimaryForeground: "#ffffff",
          colorBackground: "#10153a",
          colorForeground: "#f2f5ff",
          colorMutedForeground: "#aab6d6",
          colorInput: "#0a0e2a",
          colorInputForeground: "#f2f5ff",
          colorBorder: "#2c3466",
          colorDanger: "#e5484d",
          fontFamily: '"IBM Plex Sans Variable", system-ui, sans-serif',
          borderRadius: "12px",
        },
      }}
    >
      <html lang="en">
        <body className="min-h-dvh">{children}</body>
      </html>
    </ClerkProvider>
  );
}
