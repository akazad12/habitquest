import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Zap, ArrowRight } from "lucide-react";
import {
  loginSchema,
  registerSchema,
  sessionResponseSchema,
} from "@habitquest/shared";
import { useAuth } from "@/auth";
import { api, messageOf } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ErrorNotice, Field, TimezoneField } from "@/components/forms";
export function AuthPage({ register = false }: { register?: boolean }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (auth.user) return <Navigate to="/" replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const input = register
        ? registerSchema.parse({ email, displayName, password, timezone })
        : loginSchema.parse({ email, password });
      auth.accept(
        sessionResponseSchema.parse(
          await api(`/auth/${register ? "register" : "login"}`, {
            method: "POST",
            body: input,
          }),
        ),
      );
      setPassword("");
      navigate("/", { replace: true });
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-intro">
        <Link className="brand" to="/">
          <span>
            <Zap fill="currentColor" size={24} />
          </span>
          HabitQuest<span className="brand-dot">.</span>
        </Link>
        <div>
          <p className="eyebrow">SMALL STEPS. REAL MOMENTUM.</p>
          <h1>
            Your next chapter
            <br />
            starts with today.
          </h1>
          <p className="muted">
            Build routines around your life. Keep a clear view of what is due,
            and celebrate the simple act of showing up.
          </p>
          <div className="auth-promise">
            <span>01</span>
            <p>Your schedule. Your timezone.</p>
          </div>
          <div className="auth-promise">
            <span>02</span>
            <p>Daily progress that stays with you.</p>
          </div>
          <div className="auth-promise">
            <span>03</span>
            <p>A little consistency, one day at a time.</p>
          </div>
        </div>
        <small>Make today a step forward.</small>
      </section>
      <section className="auth-form-panel">
        <p className="eyebrow">WELCOME TO YOUR WORKSPACE</p>
        <h2>{register ? "Create your account" : "Welcome back"}</h2>
        <p className="muted">
          {register
            ? "Make space for the habits that matter."
            : "Pick up where you left off."}
        </p>
        <form onSubmit={submit}>
          <ErrorNotice message={error} />
          <fieldset disabled={pending} className="form-reset">
            {register && (
              <Field label="Display name">
                <input
                  required
                  maxLength={80}
                  autoComplete="nickname"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </Field>
            )}
            <Field label="Email">
              <input
                type="email"
                required
                maxLength={254}
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field
              label="Password"
              hint={
                register
                  ? "At least 12 characters. Spaces and password managers are welcome."
                  : undefined
              }
            >
              <input
                type="password"
                required
                minLength={register ? 12 : 1}
                maxLength={128}
                autoComplete={register ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {register && (
              <TimezoneField value={timezone} onChange={setTimezone} />
            )}
            <Button className="w-full" type="submit">
              {pending
                ? "Please wait…"
                : register
                  ? "Create account"
                  : "Sign in"}
              <ArrowRight size={16} />
            </Button>
          </fieldset>
        </form>
        <p className="auth-switch">
          {register ? "Already have an account?" : "New to HabitQuest?"}{" "}
          <Link to={register ? "/login" : "/register"}>
            {register ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </section>
    </div>
  );
}
