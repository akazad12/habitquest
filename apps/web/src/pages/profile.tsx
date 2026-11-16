import { AchievementPanel, FreezePanel } from "@/progression";
import { useState, type FormEvent } from "react";
import { UserRound, LogOut } from "lucide-react";
import { profileSchema, type PublicUser } from "@habitquest/shared";
import { useAuth } from "@/auth";
import { api, messageOf } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, ErrorNotice, TimezoneField } from "@/components/forms";
export function ProfilePage() {
  const auth = useAuth();
  const [displayName, setDisplayName] = useState(auth.user!.displayName);
  const [timezone, setTimezone] = useState(auth.user!.timezone);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const input = profileSchema.parse({ displayName, timezone });
      const result = await api<{ user: PublicUser }>("/auth/profile", {
        method: "PATCH",
        body: input,
      });
      auth.setUser(result.user);
      setSaved(true);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setPending(false);
    }
  }
  async function logout() {
    setPending(true);
    setError(null);
    try {
      await auth.logout();
    } catch (error) {
      setError(messageOf(error));
      setPending(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MAKE YOURSELF AT HOME</p>
          <h1>
            Your profile<span>.</span>
          </h1>
          <p className="muted">A routine that works around your life.</p>
        </div>
      </div>
      <div className="profile-grid">
        <form className="panel profile-form" onSubmit={submit}>
          <div className="profile-identity">
            <span className="avatar">
              <UserRound size={26} />
            </span>
            <div>
              <h2>{auth.user!.displayName}</h2>
              <p>{auth.user!.email}</p>
            </div>
          </div>
          <ErrorNotice message={error} />
          {saved && (
            <p className="success-notice" role="status">
              Your profile has been saved.
            </p>
          )}
          <fieldset className="form-reset" disabled={pending}>
            <Field label="Display name">
              <input
                required
                maxLength={80}
                autoComplete="nickname"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setSaved(false);
                }}
              />
            </Field>
            <TimezoneField
              value={timezone}
              onChange={(value) => {
                setTimezone(value);
                setSaved(false);
              }}
            />
            <p className="policy-note">
              Changing timezone changes what “today” means immediately. Existing
              completion dates and recurrence anchors stay intact. You can only
              complete or undo habits on the resulting current local date.
            </p>
            <Button type="submit">
              {pending ? "Please wait…" : "Save profile"}
            </Button>
          </fieldset>
        </form>
        <section className="panel session-panel">
          <p className="eyebrow">ACCOUNT ACCESS</p>
          <h2>Signed in securely.</h2>
          <p className="muted">
            Your session lasts up to seven days. Signing out invalidates this
            browser’s session immediately.
          </p>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void logout()}
          >
            <LogOut size={16} />
            Sign out
          </Button>
        </section>
      </div>
      <AchievementPanel />
      <FreezePanel />
    </>
  );
}
