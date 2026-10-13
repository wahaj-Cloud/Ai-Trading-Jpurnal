import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/ui/themes";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { BOOT_SCRIPT } from "@/features/theme/theme";

export const metadata: Metadata = {
  title: { default: "WickMentor · AI trading journal and coach", template: "%s · WickMentor" },
  description: "An AI-reviewed trading journal for crypto, forex and gold traders.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#050819" },
    { media: "(prefers-color-scheme: light)", color: "#edf1fb" },
  ],
  colorScheme: "dark light",
};

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
      {/* The boot script sets data-mode/data-preset from this device's saved theme before paint. */}
      <html lang="en" data-mode="dark" data-preset="wickmentor" suppressHydrationWarning>
        <head>
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static, first-party theme boot script */}
          <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
        </head>
        <body className="min-h-dvh">{children}</body>
      </html>
    </ClerkProvider>
  );
}
