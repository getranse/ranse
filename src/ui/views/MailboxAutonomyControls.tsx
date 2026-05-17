import type { AutonomyPolicy } from '../../types/autonomy';

export const MAILBOX_POLICY_OPTIONS: Array<{ value: AutonomyPolicy; label: string }> = [
  { value: 'draft_only', label: 'Draft only' },
  { value: 'auto_send_if_confident', label: 'Auto-send if confident' },
  { value: 'auto_send_always', label: 'Auto-send always' },
];

export function PolicySelect(props: {
  disabled: boolean;
  value: AutonomyPolicy;
  onChange: (value: AutonomyPolicy) => void;
}) {
  return (
    <select
      disabled={props.disabled}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as AutonomyPolicy)}
    >
      {MAILBOX_POLICY_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function ThresholdInput(props: {
  disabled: boolean;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      disabled={props.disabled}
      type="number"
      min="0.5"
      max="0.99"
      step="0.01"
      value={props.value}
      onChange={(e) => {
        const value = e.target.valueAsNumber;
        if (Number.isFinite(value) && value >= 0.5 && value <= 0.99) props.onChange(value);
      }}
      style={{ maxWidth: 92 }}
      title="Minimum confidence required before auto-send."
    />
  );
}

export function RolloutInput(props: {
  disabled: boolean;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      disabled={props.disabled}
      type="number"
      min="0"
      max="100"
      step="5"
      value={props.value}
      onChange={(e) => {
        const value = e.target.valueAsNumber;
        if (Number.isFinite(value) && value >= 0 && value <= 100) props.onChange(value);
      }}
      style={{ maxWidth: 80 }}
      title="Percentage of tickets eligible for autonomous send."
    />
  );
}
