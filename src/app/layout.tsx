import { ModalAccessibility } from "@/components/common/ModalAccessibility";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./experience.css";
import "./experience-v31.css";
import "./experience-v32.css";
import "./faith-v33.css";
import "./story-v34.css";
import "./language-v35.css";
import "./dates-v36.css";
import "./loading-v362.css";
import "./celebration-v363.css";
import "./date-photos-v365.css";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { ExperiencePreferences } from "@/components/common/ExperiencePreferences";
import { TogetherProvider } from "@/components/providers/TogetherProvider";
import { PushRecovery } from "@/components/pwa/PushRecovery";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";

export const metadata: Metadata = {
  title: "Together — Just You and Me",
  description: "A private couple chat and memories PWA for two people.",
  applicationName: "Together",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Together" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
    themeColor: "#F7F6F3",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <LanguageProvider><TogetherProvider>
          <ServiceWorkerRegistration />
          <PushRecovery />
          <ModalAccessibility />
          <ExperiencePreferences />
          {children}
        </TogetherProvider></LanguageProvider>
      </body>
    </html>
  );
}
