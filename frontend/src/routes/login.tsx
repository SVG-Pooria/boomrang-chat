import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BrandMark } from "@/components/ui/brand-mark";
import { Eye, EyeOff, LockKeyhole, Phone, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, HOME_PATH, login } from "@/lib/auth";
import { RedirectSignedIn } from "@/components/require-role";
import { T } from "@/components/ui/t";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "ورود به بومرنگ" },
      {
        name: "description",
        content: "ورود امن کاربران و مدیران به سامانه ارتباطات سازمانی بومرنگ",
      },
      { property: "og:title", content: "ورود به بومرنگ" },
      {
        property: "og:description",
        content: "ورود امن کاربران و مدیران به سامانه ارتباطات سازمانی بومرنگ",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginRoute,
});

function LoginRoute() {
  return (
    <RedirectSignedIn>
      <LoginPage />
    </RedirectSignedIn>
  );
}

const serverErrorMessages: Record<string, { field: "phone" | "password"; message: string }> = {
  INVALID_PHONE: { field: "phone", message: "شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود." },
  INVALID_CREDENTIALS: { field: "password", message: "شماره تلفن یا رمز عبور نادرست است." },
  ACCOUNT_DISABLED: {
    field: "phone",
    message: "این حساب غیرفعال است؛ با ادمین سامانه تماس بگیرید.",
  },
};

function LoginPage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ phone?: string; password?: string }>({});
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: { phone?: string; password?: string } = {};

    if (!/^09\d{9}$/.test(phone)) {
      nextErrors.phone = "شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود.";
    }
    if (!password) {
      nextErrors.password = "رمز عبور را وارد کنید.";
    }

    setErrors(nextErrors);
    if (nextErrors.phone || nextErrors.password) return;

    setPending(true);
    try {
      const result = await login(phone, password);
      if (result.needsSetup) {
        setErrors({
          password: "برای این حساب هنوز رمز عبوری تعیین نشده است؛ با ادمین سامانه تماس بگیرید.",
        });
        return;
      }
      await navigate({ to: HOME_PATH[result.session.user.role] });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 429) {
          const wait = error.retryAfterSeconds ?? 60;
          setErrors({
            phone: `تلاش‌های ناموفق بیش از حد مجاز است؛ ${wait} ثانیه دیگر دوباره تلاش کنید.`,
          });
          return;
        }
        const mapped = serverErrorMessages[error.message];
        setErrors(
          mapped
            ? { [mapped.field]: mapped.message }
            : { password: "ارتباط با سامانه برقرار نشد؛ دوباره تلاش کنید." },
        );
        return;
      }
      setErrors({ password: "ارتباط با سامانه برقرار نشد؛ دوباره تلاش کنید." });
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-page" dir="rtl">
      <div className="login-decor login-decor-mint" aria-hidden="true" />
      <div className="login-decor login-decor-violet" aria-hidden="true" />

      <header className="login-header">
        <div className="login-brand">
          <BrandMark size={56} className="brand-mark-image" />
          <div>
            <strong>
              <T>بومرنگ</T>
            </strong>
            <span>
              <T>فضای کاری داخلی</T>
            </span>
          </div>
        </div>
      </header>

      <section className="login-shell" aria-labelledby="login-title">
        <div className="login-card">
          <div className="login-card-topline" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>

          <div className="login-emblem">
            <BrandMark size={56} className="brand-mark-image" />
          </div>

          <div className="login-copy">
            <p className="login-kicker">
              <T>خوش آمدید</T>
            </p>
            <h1 id="login-title">
              <T>ورود به بومرنگ</T>
            </h1>
            <p>
              <T>برای ورود به فضای کاری، اطلاعات حساب خود را وارد کنید.</T>
            </p>
          </div>

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="form-field">
              <label htmlFor="phone">
                <T>شماره تلفن همراه</T>
              </label>
              <div className="input-wrap">
                <Phone aria-hidden="true" />
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  dir="ltr"
                  maxLength={11}
                  value={phone}
                  placeholder="۰۹۱۲ ۳۴۵ ۶۷۸۹"
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={errors.phone ? "phone-error" : undefined}
                  onChange={(event) => {
                    setPhone(event.target.value.replace(/\D/g, ""));
                    if (errors.phone)
                      setErrors((current) => {
                        const { phone: _phoneError, ...remainingErrors } = current;
                        return remainingErrors;
                      });
                  }}
                />
              </div>
              {errors.phone ? (
                <p className="field-error" id="phone-error" role="alert">
                  {errors.phone}
                </p>
              ) : null}
            </div>

            <div className="form-field">
              <div className="field-label-row">
                <label htmlFor="password">
                  <T>رمز عبور</T>
                </label>
                <a href="#forgot-password">
                  <T>رمز عبور را فراموش کرده‌اید؟</T>
                </a>
              </div>
              <div className="input-wrap">
                <LockKeyhole aria-hidden="true" />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  placeholder="رمز عبور خود را وارد کنید"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? "password-error" : undefined}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (errors.password)
                      setErrors((current) => {
                        const { password: _passwordError, ...remainingErrors } = current;
                        return remainingErrors;
                      });
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="password-toggle"
                  aria-label={showPassword ? "پنهان کردن رمز عبور" : "نمایش رمز عبور"}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </Button>
              </div>
              {errors.password ? (
                <p className="field-error" id="password-error" role="alert">
                  {errors.password}
                </p>
              ) : null}
            </div>

            <Button type="submit" className="login-submit" disabled={pending}>
              <T>ورود به فضای کاری</T>
            </Button>
          </form>

          <div className="login-security">
            <ShieldCheck aria-hidden="true" />
            <span>
              <T>ورود امن به سامانه سازمانی</T>
            </span>
          </div>
        </div>

        <p className="login-help">
          <T>برای دریافت یا بازیابی اطلاعات ورود، با مدیر سامانه سازمان خود در ارتباط باشید.</T>
        </p>
      </section>

      <footer className="login-footer">
        <span>
          <T>بومرنگ</T>
        </span>
        <i aria-hidden="true" />
        <span>
          <T>ارتباط امن، همکاری یکپارچه</T>
        </span>
      </footer>
    </main>
  );
}
