import { useAuth } from "@/auth";
import type { ReactNode } from "react";
import type { Recurrence } from "@habitquest/shared";
export function ErrorNotice({ message }: { message: string | null }) {
  return message ? (
    <div className="error-notice" role="alert">
      {message}
    </div>
  ) : null;
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
const timezones = Intl.supportedValuesOf("timeZone");
export function TimezoneField({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field
      label="Timezone"
      hint="Use an IANA timezone. Your local day controls check-ins."
    >
      <input
        required
        list="timezones"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        autoComplete="off"
      />
      <datalist id="timezones">
        <option value="UTC" />
        {timezones.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
    </Field>
  );
}
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function scheduleLabel(rule: Recurrence) {
  if (rule.kind === "DAILY") return "Every day";
  if (rule.kind === "WEEKDAYS")
    return rule.weekdays.map((day) => weekdays[day - 1]).join(", ");
  return `Every ${rule.intervalDays} day${rule.intervalDays === 1 ? "" : "s"} · from ${rule.anchorDate}`;
}
export function ScheduleFields({
  value,
  onChange,
}: {
  value: Recurrence;
  onChange: (rule: Recurrence) => void;
}) {
  const { user } = useAuth();
  const localParts = new Intl.DateTimeFormat("en-US", {
    timeZone: user!.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (key: string) => localParts.find((p) => p.type === key)!.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  return (
    <fieldset className="schedule-fields">
      <legend>Recurring schedule</legend>
      <Field label="Frequency">
        <select
          value={value.kind}
          onChange={(event) =>
            onChange(
              event.target.value === "DAILY"
                ? { kind: "DAILY" }
                : event.target.value === "WEEKDAYS"
                  ? { kind: "WEEKDAYS", weekdays: [1, 2, 3, 4, 5] }
                  : {
                      kind: "INTERVAL",
                      intervalDays: 2,
                      anchorDate: today,
                    },
            )
          }
        >
          <option value="DAILY">Every day</option>
          <option value="WEEKDAYS">Specific weekdays</option>
          <option value="INTERVAL">Every N days</option>
        </select>
      </Field>
      {value.kind === "WEEKDAYS" && (
        <div className="weekdays" role="group" aria-label="Scheduled weekdays">
          {weekdays.map((day, index) => (
            <label key={day}>
              <input
                type="checkbox"
                checked={value.weekdays.includes(index + 1)}
                onChange={(event) =>
                  onChange({
                    ...value,
                    weekdays: event.target.checked
                      ? [...value.weekdays, index + 1].sort()
                      : value.weekdays.filter((d) => d !== index + 1),
                  })
                }
              />
              <span>{day}</span>
            </label>
          ))}
        </div>
      )}
      {value.kind === "INTERVAL" && (
        <div className="form-columns">
          <Field label="Repeat every (days)">
            <input
              required
              type="number"
              min={1}
              max={365}
              value={value.intervalDays}
              onChange={(event) =>
                onChange({ ...value, intervalDays: Number(event.target.value) })
              }
            />
          </Field>
          <Field
            label="Anchor date"
            hint="The anchor is a scheduled day; earlier dates are never due."
          >
            <input
              required
              type="date"
              value={value.anchorDate}
              onChange={(event) =>
                onChange({ ...value, anchorDate: event.target.value })
              }
            />
          </Field>
        </div>
      )}
    </fieldset>
  );
}
