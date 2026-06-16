"use client";

import type { CSSProperties, ReactNode, RefObject } from "react";
import { useState } from "react";

import type { CGMPDomain } from "@/lib/cgmp/types";
import type { BadgeInfo } from "@/lib/cgmp/client-utils";
import { getDomainLabel } from "@/lib/cgmp/client-utils";

type AiProcessingOverlayState = {
  kind: "text" | "image";
  label: string;
  startedAt: number;
  finishedAt?: number;
  elapsedMs?: number;
};

export const fieldClass =
  "mt-2 w-full rounded-2xl border border-[color:var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text)] outline-none transition placeholder:text-[color:var(--subtle)] focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent-soft)]";
export const textareaClass = `${fieldClass} min-h-[120px] resize-y`;
export const panelClass =
  "min-w-0 overflow-hidden rounded-[24px] border border-[color:var(--border)] bg-[var(--card)] p-4 shadow-[0_18px_55px_var(--shadow-soft),0_2px_10px_var(--shadow-soft)] sm:rounded-[28px] sm:p-5";
export const softPanelClass =
  "min-w-0 overflow-hidden rounded-[22px] border border-[color:var(--border)] bg-[var(--card-soft)] p-3 shadow-[0_10px_30px_var(--shadow-soft)] sm:rounded-[24px] sm:p-4";
export const primaryButtonClass =
  "rounded-2xl border border-[color:var(--accent)] bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-contrast)] shadow-[0_10px_24px_var(--shadow-soft)] transition hover:brightness-95";
export const secondaryButtonClass =
  "rounded-2xl border border-[color:var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] shadow-[0_8px_18px_var(--shadow-soft)] transition hover:border-[color:var(--accent)] hover:bg-[var(--accent-soft)]";
export const dangerButtonClass =
  "rounded-2xl border border-[color:var(--danger)] bg-[var(--danger-soft)] px-4 py-2.5 text-sm font-semibold text-[var(--danger)] transition hover:brightness-95";
export function Badge({
  children,
  tone = "slate",
  compact = false,
  onClick,
  title,
}: {
  children: ReactNode;
  tone?: "slate" | "cyan" | "emerald" | "amber" | "rose";
  compact?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const toneClass =
    tone === "cyan"
      ? "border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
      : tone === "emerald"
        ? "border-[color:var(--success)] bg-[var(--success-soft)] text-[var(--success)]"
        : tone === "amber"
          ? "border-[color:var(--orange)] bg-[var(--orange-soft)] text-[var(--orange)]"
          : tone === "rose"
            ? "border-[color:var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"
            : "border-[color:var(--border)] bg-[var(--card-soft)] text-[var(--muted)]";
  const className = `inline-flex items-center rounded-full border ${
    compact ? "px-2 py-0.5 text-[11px] leading-5" : "px-2.5 py-1 text-xs"
  } ${toneClass}`;
  if (onClick) {
    return (
      <button
        type="button"
        title={title}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className={`${className} cursor-help text-left transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]`}
      >
        {children}
      </button>
    );
  }
  return (
    <span
      title={title}
      className={className}
    >
      {children}
    </span>
  );
}

export function getDomainColorVar(domain: CGMPDomain | string) {
  const normalized = String(domain || "other").replace("_", "-");
  if (normalized === "life-admin") return "var(--domain-life-admin)";
  return `var(--domain-${normalized})`;
}

export function DomainBadge({
  domain,
  compact = false,
  onClick,
}: {
  domain: CGMPDomain | string;
  compact?: boolean;
  onClick?: () => void;
}) {
  const color = getDomainColorVar(domain);
  const className = `inline-flex items-center rounded-full border text-[color:var(--domain-color)] ${
    compact ? "px-2 py-0.5 text-[11px] leading-5" : "px-2.5 py-1 text-xs"
  }`;
  const style = {
    "--domain-color": color,
    backgroundColor: `color-mix(in srgb, ${color} 12%, var(--card))`,
    borderColor: color,
  } as CSSProperties;
  if (onClick) {
    return (
      <button
        type="button"
        title="Domainの意味を表示"
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className={`${className} cursor-help text-left transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]`}
        style={style}
      >
        {getDomainLabel(domain)}
      </button>
    );
  }
  return (
    <span
      className={className}
      style={style}
    >
      {getDomainLabel(domain)}
    </span>
  );
}

export function BadgeInfoModal({ info, onClose }: { info: BadgeInfo; onClose: () => void }) {
  if (!info) return null;
  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-slate-950/24 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur-[2px] sm:items-center sm:pb-4">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="説明を閉じる" onClick={onClose} />
      <section className="relative w-full max-w-md rounded-[28px] border border-[color:var(--border)] bg-[var(--card)] p-5 shadow-[0_24px_80px_var(--shadow-soft)]">
        <div className="text-[11px] uppercase tracking-[0.34em] text-[var(--accent)]">{info.title}</div>
        <h2 className="mt-2 text-2xl font-semibold text-[var(--text)]">{info.label}</h2>
        <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{info.description}</p>
        {info.examples?.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {info.examples.map((example) => (
              <Badge key={example} compact>
                {example}
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            閉じる
          </button>
        </div>
      </section>
    </div>
  );
}

export function AiProcessingOverlay({
  state,
  elapsedMs,
}: {
  state: AiProcessingOverlayState | null;
  elapsedMs: number;
}) {
  if (!state) return null;

  const isDone = typeof state.finishedAt === "number";
  const title = isDone ? "完了しました" : state.label;
  const description = isDone
    ? `所要時間 ${elapsedMs.toLocaleString("ja-JP")} ms`
    : `${elapsedMs.toLocaleString("ja-JP")} ms`;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[var(--overlay)] px-6 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-label={title}
    >
      <div className="w-full max-w-[280px] rounded-[28px] border border-[color:var(--border)] bg-[var(--card)] p-6 text-center shadow-[0_24px_80px_var(--shadow-soft)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-soft)]">
          {isDone ? (
            <span className="text-2xl font-bold text-[var(--accent)]">✓</span>
          ) : (
            <span className="h-8 w-8 animate-spin rounded-full border-4 border-[color:var(--accent-soft)] border-t-[color:var(--accent)]" />
          )}
        </div>
        <div className="mt-4 text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">
          {state.kind === "text" ? "Text AI" : "Image AI"}
        </div>
        <div className="mt-2 text-lg font-semibold text-[var(--text)]">{title}</div>
        <div className="mt-2 font-mono text-sm text-[var(--muted)]">{description}</div>
      </div>
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-4">
      <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--accent)]">{eyebrow}</div>
      <h2 className="mt-2 text-xl font-semibold text-[var(--text)]">{title}</h2>
      {description ? <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{description}</p> : null}
    </div>
  );
}

export function SettingsAccordion({
  title,
  summary,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-[24px] border border-[color:var(--border)] bg-[var(--card-soft)] shadow-[0_10px_30px_var(--shadow-soft)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left transition hover:bg-[var(--accent-soft)]"
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-[var(--text)]">{title}</span>
            {badge}
          </span>
          {summary ? <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">{summary}</span> : null}
        </span>
        <span className="mt-0.5 shrink-0 rounded-full border border-[color:var(--border)] bg-[var(--card)] px-2 py-1 text-xs font-semibold text-[var(--muted)]">
          {open ? "閉じる" : "開く"}
        </span>
      </button>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-[color:var(--border)] px-4 py-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

export function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  id,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  id?: string;
}) {
  return (
    <label htmlFor={id} className="block min-w-0 text-sm font-medium text-[var(--text)]">
      {label}
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={fieldClass}
      />
    </label>
  );
}

export function LabeledNumber({
  label,
  value,
  onChange,
  id,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  id?: string;
}) {
  return (
    <label htmlFor={id} className="block min-w-0 text-sm font-medium text-[var(--text)]">
      {label}
      <input
        id={id}
        type="number"
        min={1}
        value={Number.isFinite(value) ? value : 60}
        onChange={(event) => onChange(Number(event.target.value || 60))}
        className={fieldClass}
      />
    </label>
  );
}

export function LabeledTextarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 5,
  inputRef,
  id,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  id?: string;
}) {
  return (
    <label htmlFor={id} className="block min-w-0 text-sm font-medium text-[var(--text)]">
      {label}
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        ref={inputRef}
        className={textareaClass}
      />
    </label>
  );
}

export function LabeledSelect({
  label,
  value,
  onChange,
  options,
  id,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  id?: string;
}) {
  return (
    <label htmlFor={id} className="block min-w-0 text-sm font-medium text-[var(--text)]">
      {label}
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={fieldClass}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LabeledToggle({
  label,
  value,
  onChange,
  id,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  id?: string;
}) {
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text)]">
      <span>{label}</span>
      <button
        type="button"
        id={id}
        onClick={() => onChange(!value)}
        className={`relative h-6 w-11 rounded-full border transition ${
          value ? "border-[color:var(--accent)] bg-[var(--accent)]" : "border-[color:var(--border)] bg-[var(--card-soft)]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
            value ? "left-5" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}
