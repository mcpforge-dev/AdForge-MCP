"use client";

import { useTheme } from "./theme-provider";

const options = [
  { value: "light", label: "Light", icon: "☀" },
  { value: "system", label: "System", icon: "◐" },
  { value: "dark", label: "Dark", icon: "☾" },
] as const;

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { preference, setPreference } = useTheme();
  return (
    <div
      className={compact ? "theme-switcher theme-switcher--compact" : "theme-switcher"}
      aria-label="Theme"
      role="group"
      data-language-static
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={preference === option.value ? "is-active" : ""}
          aria-label={option.label}
          aria-pressed={preference === option.value}
          title={option.label}
          onClick={() => setPreference(option.value)}
        >
          <span aria-hidden="true">{option.icon}</span>
          <span className="sr-only">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
