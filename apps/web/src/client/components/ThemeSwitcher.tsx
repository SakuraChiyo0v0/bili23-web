import { applyTheme } from "../lib/theme";
import { useUiSettings } from "../lib/useUiSettings";

export function ThemeSwitcher({ value, onChange }: { value: "light" | "dark" | "system"; onChange: (v: "light" | "dark" | "system") => void }) {
  const [, updateUi] = useUiSettings();
  return (
    <div className="seg">
      {(["light", "dark", "system"] as const).map((t) => (
        <button
          key={t}
          type="button"
          className={`seg-btn${value === t ? " active" : ""}`}
          onClick={() => {
            onChange(t);
            updateUi({ theme: t });
            applyTheme(t);
          }}
        >
          {{ light: "浅色", dark: "深色", system: "跟随系统" }[t]}
        </button>
      ))}
    </div>
  );
}