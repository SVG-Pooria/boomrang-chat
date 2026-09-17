import { useI18n } from "@/lib/i18n";

export function T({ children }: { children: string }) {
  const { t } = useI18n();
  return <>{t(children)}</>;
}
