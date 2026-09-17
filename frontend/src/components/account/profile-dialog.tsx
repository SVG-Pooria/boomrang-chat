import {
  Camera,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Moon,
  Palette,
  Sun,
  Trash2,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { AvatarCropDialog } from "@/components/account/avatar-crop-dialog";
import { GlassDialog } from "@/components/ui/glass-dialog";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  changeMyPassword,
  fetchMyStatus,
  fetchPreferences,
  removeMyAvatar,
  saveMyStatus,
  savePreferences,
  uploadMyAvatar,
  useAccount,
  type ChatPreferences,
  type PersonalStatus,
} from "@/lib/account";
import { ApiError } from "@/lib/auth";
import { BUBBLE_COLORS, FONT_SIZES, applyChatAppearance } from "@/lib/chat-appearance";
import { useI18n } from "@/lib/i18n";
import { ROLE_LABELS } from "@/lib/roles";
import { signOut } from "@/lib/session-actions";
import { useTheme } from "@/lib/theme";
import type { Theme } from "@/lib/theme-core";
import { cn } from "@/lib/utils";

const STATUS_PRESETS = ["در جلسه", "مرخصی", "متمرکز روی کار"];

const STATUS_DURATIONS: {
  id: string;
  label: string;
  minutes: number | null;
  endOfDay?: boolean;
}[] = [
  { id: "30m", label: "۳۰ دقیقه", minutes: 30 },
  { id: "1h", label: "۱ ساعت", minutes: 60 },
  { id: "3h", label: "۳ ساعت", minutes: 180 },
  { id: "today", label: "تا پایان امروز", minutes: null, endOfDay: true },
  { id: "open", label: "تا اطلاع ثانوی", minutes: null },
];

const PASSWORD_ERRORS: Record<string, string> = {
  WEAK_PASSWORD: "رمز جدید باید دست‌کم ۶ نویسه باشد.",
  PASSWORD_MISMATCH: "تکرار رمز جدید با خود رمز یکسان نیست.",
  CURRENT_PASSWORD_INVALID: "رمز فعلی درست نیست.",
  TOO_MANY_ATTEMPTS: "تلاش‌های ناموفق زیاد بود؛ چند دقیقه بعد دوباره امتحان کنید.",
};

const AVATAR_ERRORS: Record<string, string> = {
  INVALID_IMAGE: "این فایل تصویر معتبری نیست.",
  INFECTED_FILE: "فایل انتخاب‌شده آلوده تشخیص داده شد.",
  SCAN_UNAVAILABLE: "اسکن فایل در دسترس نیست؛ کمی بعد دوباره تلاش کنید.",
  FILE_TOO_LARGE: "حجم عکس بیش از حد مجاز است.",
};

function untilFor(durationId: string) {
  const duration = STATUS_DURATIONS.find((item) => item.id === durationId);
  if (!duration) return null;
  if (duration.endOfDay) {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return end.toISOString();
  }
  return duration.minutes ? new Date(Date.now() + duration.minutes * 60000).toISOString() : null;
}

function Card({
  icon,
  title,
  hint,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("rounded-[22px] border border-chat-panel-border bg-white/55 p-4", className)}
    >
      <div className="mb-3 flex items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-chat-violet/15 text-chat-violet">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-[13.5px] font-semibold text-chat-ink">{title}</h3>
          {hint ? (
            <p className="mt-0.5 text-[11px] leading-relaxed text-chat-ink-soft">{hint}</p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function ChoiceChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[11.5px] font-bold transition-colors",
        active
          ? "border-chat-violet/35 bg-chat-violet/15 text-chat-violet"
          : "border-chat-panel-border bg-white/60 text-chat-ink-soft hover:bg-white hover:text-chat-ink",
      )}
    >
      {children}
    </button>
  );
}

function ThemeTile({
  theme,
  active,
  onSelect,
}: {
  theme: Theme;
  active: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "group relative overflow-hidden rounded-2xl border p-2 text-start transition-all",
        active
          ? "border-chat-violet/50 ring-2 ring-chat-violet/30"
          : "border-chat-panel-border hover:border-chat-violet/30",
      )}
    >
      <div
        className="h-20 rounded-xl p-2"
        style={{
          background: dark
            ? "linear-gradient(145deg, oklch(0.2 0.03 280), oklch(0.16 0.026 282))"
            : "linear-gradient(145deg, oklch(0.97 0.015 270), oklch(0.93 0.03 255))",
        }}
      >
        <div className="flex h-full gap-1.5">
          <span
            className="w-3 rounded-md"
            style={{ background: dark ? "oklch(0.26 0.03 283)" : "oklch(1 0 0 / 0.75)" }}
          />
          <div className="flex flex-1 flex-col justify-end gap-1">
            <span
              className="h-2.5 w-2/3 rounded-full"
              style={{ background: dark ? "oklch(0.3 0.03 283)" : "oklch(1 0 0 / 0.9)" }}
            />
            <span
              className="ms-auto h-2.5 w-1/2 rounded-full"
              style={{ background: dark ? "oklch(0.7 0.125 255)" : "oklch(0.68 0.14 255)" }}
            />
          </div>
        </div>
      </div>
      <span className="mt-2 flex items-center justify-between px-1 text-[11.5px] font-bold text-chat-ink">
        <span className="flex items-center gap-1.5">
          {dark ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
          {dark ? t("تیره") : t("روشن")}
        </span>
        {active ? <Check className="size-3.5 text-chat-violet" /> : null}
      </span>
    </button>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold text-chat-ink-soft">{label}</span>
      <span className="relative block">
        <input
          type={visible ? "text" : "password"}
          value={value}
          dir="ltr"
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-2xl border border-chat-panel-border bg-white/70 py-2.5 pe-10 ps-3.5 text-[13px] text-chat-ink outline-none transition-colors focus:border-chat-sky/40 focus:bg-white"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? t("پنهان کردن رمز") : t("نمایش رمز")}
          className="absolute end-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-chat-ink-soft hover:bg-chat-ink/5 hover:text-chat-ink"
        >
          {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </span>
    </label>
  );
}

export function ProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, digits, clock, day } = useI18n();
  const { theme, setTheme } = useTheme();
  const { user } = useAccount();
  const fileInput = useRef<HTMLInputElement>(null);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [preferences, setPreferences] = useState<ChatPreferences | null>(null);
  const [status, setStatus] = useState<PersonalStatus | null>(null);
  const [preset, setPreset] = useState(STATUS_PRESETS[0]!);
  const [duration, setDuration] = useState("1h");
  const [statusBusy, setStatusBusy] = useState(false);
  const [passwords, setPasswords] = useState({ current: "", next: "", repeat: "" });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchPreferences()
      .then(setPreferences)
      .catch(() => undefined);
    fetchMyStatus()
      .then(setStatus)
      .catch(() => undefined);
  }, [open]);

  useEffect(
    () => () => {
      if (cropSource) URL.revokeObjectURL(cropSource);
    },
    [cropSource],
  );

  if (!user) return null;

  const updatePreference = (patch: Partial<ChatPreferences>) => {
    if (!preferences) return;
    const next = { ...preferences, ...patch };
    setPreferences(next);
    applyChatAppearance(next);
    savePreferences(patch).catch(() => toast.error(t("ذخیرهٔ تنظیمات ناموفق بود")));
  };

  const pickPhoto = (file: File | undefined) => {
    if (!file) return;
    if (cropSource) URL.revokeObjectURL(cropSource);
    setCropSource(URL.createObjectURL(file));
    if (fileInput.current) fileInput.current.value = "";
  };

  const savePhoto = async (blob: Blob) => {
    setAvatarBusy(true);
    try {
      await uploadMyAvatar(blob);
      toast.success(t("عکس پروفایل به‌روز شد"));
      setCropSource(null);
    } catch (error) {
      toast.error(
        t((error instanceof ApiError && AVATAR_ERRORS[error.message]) || "بارگذاری عکس ناموفق بود"),
      );
    } finally {
      setAvatarBusy(false);
    }
  };

  const deletePhoto = async () => {
    setAvatarBusy(true);
    try {
      await removeMyAvatar();
      toast.success(t("عکس پروفایل حذف شد"));
    } catch {
      toast.error(t("حذف عکس ناموفق بود"));
    } finally {
      setAvatarBusy(false);
    }
  };

  const applyStatus = async (enabled: boolean) => {
    setStatusBusy(true);
    try {
      setStatus(
        await saveMyStatus(
          enabled
            ? { enabled: true, label: preset, until: untilFor(duration) }
            : { enabled: false },
        ),
      );
    } catch {
      toast.error(t("ثبت وضعیت ناموفق بود"));
    } finally {
      setStatusBusy(false);
    }
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordBusy(true);
    try {
      await changeMyPassword({
        currentPassword: passwords.current,
        newPassword: passwords.next,
        confirmPassword: passwords.repeat,
      });
      setPasswords({ current: "", next: "", repeat: "" });
      toast.success(t("رمز عبور تغییر کرد و نشست‌های دیگر شما بسته شد"));
    } catch (error) {
      setPasswordError(
        t(
          (error instanceof ApiError && PASSWORD_ERRORS[error.message]) ||
            "تغییر رمز عبور ناموفق بود",
        ),
      );
    } finally {
      setPasswordBusy(false);
    }
  };

  const statusLine = status?.dndEnabled
    ? status.dndUntil
      ? t("{label} — تا {time}", {
          label: t(status.dndLabel ?? "مزاحم نشوید"),
          time: `${day(status.dndUntil, { day: "numeric", month: "long" })}، ${clock(status.dndUntil)}`,
        })
      : t("{label} — تا اطلاع ثانوی", { label: t(status.dndLabel ?? "مزاحم نشوید") })
    : t("در دسترس");

  return (
    <>
      <GlassDialog
        open={open}
        onClose={onClose}
        size="xl"
        title={t("حساب کاربری و ظاهر")}
        description={t("عکس، وضعیت، ظاهر برنامه و رمز عبور خود را از همین‌جا مدیریت کنید.")}
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <div className="grid content-start gap-3">
            <section className="rounded-[22px] border border-chat-panel-border bg-gradient-to-b from-chat-violet/12 to-white/40 p-5 text-center">
              <div className="relative mx-auto w-fit">
                <UserAvatar name={user.fullName} src={user.avatarUrl} seed={user.id} size={96} />
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={avatarBusy}
                  aria-label={t("انتخاب عکس جدید")}
                  className="absolute bottom-0 end-0 grid size-9 place-items-center rounded-full bg-chat-ink text-chat-on-ink shadow-lg ring-4 ring-chat-surface transition-transform hover:scale-105 disabled:opacity-60"
                >
                  <Camera className="size-4" />
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(event) => pickPhoto(event.target.files?.[0])}
                />
              </div>
              <p className="mt-3 font-display text-[16px] font-semibold text-chat-ink">
                {user.fullName}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
                <span className="rounded-full bg-chat-violet/15 px-2.5 py-0.5 text-[10.5px] font-bold text-chat-violet">
                  {t(ROLE_LABELS[user.role])}
                </span>
                {user.tagName ? (
                  <span className="rounded-full bg-chat-mint/18 px-2.5 py-0.5 text-[10.5px] font-bold text-chat-mint-deep">
                    {user.tagName}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-[11.5px] text-chat-ink-soft" dir="ltr">
                {digits(user.phone)}
              </p>
              {user.avatarUrl ? (
                <button
                  type="button"
                  onClick={() => void deletePhoto()}
                  disabled={avatarBusy}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold text-chat-rose transition-colors hover:bg-chat-rose/10 disabled:opacity-60"
                >
                  <Trash2 className="size-3.5" />
                  {t("حذف عکس پروفایل")}
                </button>
              ) : null}
            </section>

            <Card
              icon={<UserRound className="size-4" />}
              title={t("وضعیت من")}
              hint={t("همکاران وضعیت شما را کنار نامتان می‌بینند.")}
            >
              <p
                className={cn(
                  "mb-3 rounded-xl px-3 py-2 text-[11.5px] font-bold",
                  status?.dndEnabled
                    ? "bg-chat-lemon/20 text-chat-ink"
                    : "bg-chat-mint/15 text-chat-mint-deep",
                )}
              >
                {statusLine}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_PRESETS.map((item) => (
                  <ChoiceChip key={item} active={preset === item} onClick={() => setPreset(item)}>
                    {t(item)}
                  </ChoiceChip>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {STATUS_DURATIONS.map((item) => (
                  <ChoiceChip
                    key={item.id}
                    active={duration === item.id}
                    onClick={() => setDuration(item.id)}
                  >
                    {t(item.label)}
                  </ChoiceChip>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={statusBusy}
                  onClick={() => void applyStatus(true)}
                  className="flex-1 rounded-full bg-chat-ink px-3 py-2 text-[11.5px] font-bold text-chat-on-ink transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {t("ثبت وضعیت")}
                </button>
                {status?.dndEnabled ? (
                  <button
                    type="button"
                    disabled={statusBusy}
                    onClick={() => void applyStatus(false)}
                    className="rounded-full border border-chat-panel-border bg-white/60 px-3 py-2 text-[11.5px] font-bold text-chat-ink-soft transition-colors hover:bg-white hover:text-chat-ink"
                  >
                    {t("در دسترس شدم")}
                  </button>
                ) : null}
              </div>
            </Card>
          </div>

          <div className="grid content-start gap-3">
            <Card
              icon={<Palette className="size-4" />}
              title={t("ظاهر برنامه")}
              hint={t("حالت روشن یا تیره روی همهٔ دستگاه‌های شما اعمال می‌شود.")}
            >
              <div className="grid grid-cols-2 gap-2.5">
                <ThemeTile
                  theme="light"
                  active={theme === "light"}
                  onSelect={() => setTheme("light")}
                />
                <ThemeTile
                  theme="dark"
                  active={theme === "dark"}
                  onSelect={() => setTheme("dark")}
                />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-[11px] font-bold text-chat-ink-soft">
                    {t("اندازهٔ متن پیام‌ها")}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(FONT_SIZES) as ChatPreferences["fontSize"][]).map((size) => (
                      <ChoiceChip
                        key={size}
                        active={preferences?.fontSize === size}
                        onClick={() => updatePreference({ fontSize: size })}
                      >
                        {t(FONT_SIZES[size].label)}
                      </ChoiceChip>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-bold text-chat-ink-soft">
                    {t("رنگ پیام‌های من")}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {BUBBLE_COLORS.map((color) => {
                      const active = (preferences?.bubbleColor ?? null) === color.value;
                      return (
                        <button
                          key={color.id}
                          type="button"
                          title={t(color.label)}
                          aria-label={t(color.label)}
                          aria-pressed={active}
                          onClick={() => updatePreference({ bubbleColor: color.value })}
                          className={cn(
                            "grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-chat-surface transition-transform hover:scale-110",
                            active ? "ring-2 ring-chat-ink/60" : "",
                          )}
                          style={{ background: color.value ?? "var(--chat-sky)" }}
                        >
                          {active ? <Check className="size-3.5 text-chat-on-accent" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-chat-panel-border bg-chat-surface/60 p-3">
                <div className="flex flex-col gap-2">
                  <span
                    className="w-fit max-w-[80%] rounded-2xl rounded-es-md border border-chat-panel-border bg-white/80 px-3 py-2 leading-relaxed text-chat-ink"
                    style={{ fontSize: FONT_SIZES[preferences?.fontSize ?? "medium"].value }}
                  >
                    {t("سلام! فایل ارائه را در کانال گذاشتم.")}
                  </span>
                  <span
                    className="ms-auto w-fit max-w-[80%] rounded-2xl rounded-ee-md px-3 py-2 leading-relaxed text-chat-on-accent"
                    style={{
                      background: preferences?.bubbleColor ?? "var(--chat-sky)",
                      fontSize: FONT_SIZES[preferences?.fontSize ?? "medium"].value,
                    }}
                  >
                    {t("ممنون، همین الان بازش می‌کنم.")}
                  </span>
                </div>
              </div>
            </Card>

            <Card
              icon={<KeyRound className="size-4" />}
              title={t("تغییر رمز عبور")}
              hint={t("با تغییر رمز، از همهٔ دستگاه‌های دیگر خارج می‌شوید.")}
            >
              <form
                className="grid gap-2.5 sm:grid-cols-3"
                onSubmit={(event) => void submitPassword(event)}
              >
                <PasswordField
                  label={t("رمز فعلی")}
                  value={passwords.current}
                  autoComplete="current-password"
                  onChange={(value) => setPasswords((current) => ({ ...current, current: value }))}
                />
                <PasswordField
                  label={t("رمز جدید")}
                  value={passwords.next}
                  autoComplete="new-password"
                  onChange={(value) => setPasswords((current) => ({ ...current, next: value }))}
                />
                <PasswordField
                  label={t("تکرار رمز جدید")}
                  value={passwords.repeat}
                  autoComplete="new-password"
                  onChange={(value) => setPasswords((current) => ({ ...current, repeat: value }))}
                />
                <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
                  <button
                    type="submit"
                    disabled={
                      passwordBusy || !passwords.current || !passwords.next || !passwords.repeat
                    }
                    className="rounded-full bg-chat-ink px-4 py-2 text-[11.5px] font-bold text-chat-on-ink transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {t("ذخیرهٔ رمز جدید")}
                  </button>
                  {passwordError ? (
                    <p className="text-[11px] font-bold text-chat-rose">{passwordError}</p>
                  ) : null}
                </div>
              </form>
            </Card>

            <button
              type="button"
              onClick={() => void signOut()}
              className="flex items-center justify-center gap-2 rounded-[22px] border border-chat-rose/25 bg-chat-rose/10 px-4 py-3 text-[12px] font-bold text-chat-rose transition-colors hover:bg-chat-rose/15"
            >
              <LogOut className="size-4" />
              {t("خروج از حساب")}
            </button>
          </div>
        </div>
      </GlassDialog>

      <AvatarCropDialog
        open={cropSource !== null}
        imageUrl={cropSource}
        busy={avatarBusy}
        onCancel={() => setCropSource(null)}
        onConfirm={(blob) => void savePhoto(blob)}
      />
    </>
  );
}
