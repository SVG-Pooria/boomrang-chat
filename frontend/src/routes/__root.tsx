import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-core";
import appCss from "../styles.css?url";

function NotFoundComponent() {
  const { t } = useI18n();
  return (
    <div className="app-canvas flex min-h-dvh items-center justify-center px-4 font-body text-chat-ink">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl font-bold">{t("۴۰۴")}</h1>
        <h2 className="mt-4 text-xl font-semibold">{t("صفحه پیدا نشد")}</h2>
        <p className="mt-2 text-sm text-chat-ink-soft">
          {t("صفحه‌ای که دنبالش هستید وجود ندارد یا جابه‌جا شده است.")}
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-full bg-chat-ink px-4 py-2 text-sm font-bold text-chat-on-ink transition-opacity hover:opacity-90"
          >
            {t("بازگشت به صفحه اصلی")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const { t } = useI18n();

  return (
    <div className="app-canvas flex min-h-dvh items-center justify-center px-4 font-body text-chat-ink">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight">{t("این صفحه بارگذاری نشد")}</h1>
        <p className="mt-2 text-sm text-chat-ink-soft">
          {t("مشکلی پیش آمد. صفحه را دوباره بارگذاری کنید یا به صفحه اصلی برگردید.")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-full bg-chat-ink px-4 py-2 text-sm font-bold text-chat-on-ink transition-opacity hover:opacity-90"
          >
            {t("تلاش دوباره")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-chat-panel-border bg-white/60 px-4 py-2 text-sm font-bold text-chat-ink transition-colors hover:bg-white"
          >
            {t("بازگشت به صفحه اصلی")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "بومرنگ — چت درون‌سازمانی" },
      {
        name: "description",
        content: "فضای گفتگوی داخلی تیم با طراحی مینیمال و شفاف",
      },
      { property: "og:title", content: "بومرنگ — چت درون‌سازمانی" },
      {
        property: "og:description",
        content: "فضای گفتگوی داخلی تیم با طراحی مینیمال و شفاف",
      },
      { property: "og:type", content: "website" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap",
      },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function LocalizedToaster() {
  const { dir } = useI18n();
  const { theme } = useTheme();
  return <Toaster position="top-center" dir={dir} theme={theme} />;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ThemeProvider>
          <Outlet />
          <LocalizedToaster />
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
