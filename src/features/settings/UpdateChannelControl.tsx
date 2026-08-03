import type { UpdateChannel } from "@/lib/bindings/UpdateChannel";

const OPTIONS: { value: UpdateChannel; label: string; description: string }[] = [
  {
    value: "main",
    label: "Main",
    description: "Stable builds from the main branch.",
  },
  {
    value: "dev",
    label: "Development",
    description: "Newest builds from dev; changes may be less stable.",
  },
];

interface UpdateChannelControlProps {
  value: UpdateChannel;
  onChange: (channel: UpdateChannel) => void;
  busy?: boolean;
}

export function UpdateChannelControl({ value, onChange, busy = false }: UpdateChannelControlProps) {
  return (
    <fieldset className="m-0 border-0 p-0" disabled={busy}>
      <legend className="sr-only">Update channel</legend>
      <div className="grid max-w-2xl grid-cols-2 gap-2">
        {OPTIONS.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={[
                "border-border-strong cursor-default rounded-lg border px-3 py-2",
                "focus-within:outline-focus-ring focus-within:outline-2",
                selected ? "bg-accent-bg text-accent-fg" : "bg-surface-card text-fg-primary",
                busy ? "opacity-60" : "hover:bg-surface-sunken",
              ].join(" ")}
            >
              <span className="block text-xs font-medium">{option.label}</span>
              <span className="text-fg-secondary mt-0.5 block text-2xs">{option.description}</span>
              <input
                type="radio"
                name="update-channel"
                value={option.value}
                checked={selected}
                onChange={() => {
                  onChange(option.value);
                }}
                className="sr-only"
              />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
