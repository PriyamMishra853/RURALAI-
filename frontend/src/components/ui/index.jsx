import React from 'react';
import { twMerge } from 'tailwind-merge';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

/**
 * UI primitives.
 *
 * Every button, card and input in the app comes from here. The point is not
 * brevity — it is that a clinical interface must not have nine slightly
 * different greys and six button heights. One definition per element means a
 * theme change lands everywhere at once, and a contrast fix is made once.
 */

export const cn = (...args) => twMerge(clsx(...args));

/* ------------------------------------------------------------------ Button */

const BUTTON_VARIANTS = {
  primary:   'bg-gov-600 text-white hover:bg-gov-700 dark:bg-gov-500 dark:text-gov-950 dark:hover:bg-gov-400 shadow-sm',
  secondary: 'bg-surface-raised text-ink border border-line-strong hover:bg-surface-sunken',
  ghost:     'text-ink-muted hover:bg-surface-sunken hover:text-ink',
  danger:    'bg-tier-emergency text-white hover:opacity-90 shadow-sm',
  success:   'bg-tier-low text-white hover:opacity-90 shadow-sm',
  // Saffron is state identity, not an action colour — one call-to-action only.
  accent:    'bg-saffron-500 text-gov-950 hover:bg-saffron-600 shadow-sm font-bold'
};

const BUTTON_SIZES = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2.5 text-sm gap-2',
  lg: 'px-6 py-3 text-sm gap-2',
  icon: 'p-2'
};

export const Button = React.forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className, children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-field font-semibold',
        'transition-colors disabled:opacity-45 disabled:cursor-not-allowed',
        // 44px minimum touch target on anything that is not an icon button —
        // this is used on tablets in the field, not with a mouse.
        size !== 'icon' && 'min-h-[2.5rem]',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
      {...props}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
      {children}
    </button>
  );
});

/* -------------------------------------------------------------------- Card */

export function Card({ className, children, ...props }) {
  return <div className={cn('card', className)} {...props}>{children}</div>;
}

export function CardHeader({ title, subtitle, icon: Icon, action, className }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 p-4 sm:p-5 border-b border-line', className)}>
      <div className="flex items-start gap-3 min-w-0">
        {Icon && (
          <span className="w-9 h-9 rounded-field bg-gov-50 dark:bg-gov-100 text-gov-600 dark:text-gov-500 flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ink truncate">{title}</h2>
          {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, children }) {
  return <div className={cn('p-4 sm:p-5', className)}>{children}</div>;
}

/* ------------------------------------------------------------------- Stat */

export function Stat({ label, value, hint, tone = 'default', icon: Icon, onClick, active }) {
  const tones = {
    default:   'text-ink',
    low:       'text-tier-low',
    moderate:  'text-tier-moderate',
    high:      'text-tier-high',
    emergency: 'text-tier-emergency'
  };
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-pressed={onClick ? Boolean(active) : undefined}
      className={cn(
        'card p-4 text-left w-full transition-all',
        onClick && 'hover:border-line-strong cursor-pointer',
        active && 'ring-2 ring-gov-500 border-transparent'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink-muted truncate">{label}</p>
          <p className={cn('text-2xl font-bold mt-0.5 tabular-nums', tones[tone])}>{value}</p>
          {hint && <p className="text-[11px] text-ink-subtle mt-0.5">{hint}</p>}
        </div>
        {Icon && <Icon className={cn('w-5 h-5 shrink-0', tones[tone])} />}
      </div>
    </Tag>
  );
}

/* ------------------------------------------------------------------ Fields */

export const Input = React.forwardRef(function Input({ label, error, hint, id, className, ...props }, ref) {
  const inputId = id || props.name;
  return (
    <div>
      {label && (
        <label htmlFor={inputId} className="label">
          {label} {props.required && <span className="text-tier-emergency">*</span>}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
        className={cn('field', error && 'border-tier-emergency focus:border-tier-emergency', className)}
        {...props}
      />
      {error
        ? <p id={`${inputId}-error`} className="mt-1 text-[11px] text-tier-emergency">{error}</p>
        : hint && <p className="mt-1 text-[11px] text-ink-subtle">{hint}</p>}
    </div>
  );
});

export const Select = React.forwardRef(function Select({ label, error, id, children, className, ...props }, ref) {
  const selectId = id || props.name;
  return (
    <div>
      {label && <label htmlFor={selectId} className="label">{label}</label>}
      <select ref={ref} id={selectId} className={cn('field', error && 'border-tier-emergency', className)} {...props}>
        {children}
      </select>
      {error && <p className="mt-1 text-[11px] text-tier-emergency">{error}</p>}
    </div>
  );
});

/* ------------------------------------------------------------------ Alerts */

const ALERT_TONES = {
  info:    'bg-gov-50 dark:bg-gov-100 border-gov-200 text-gov-800 dark:text-gov-700',
  success: 'bg-tier-lowBg border-tier-low/30 text-tier-low',
  warning: 'bg-tier-moderateBg border-tier-moderate/30 text-tier-moderate',
  danger:  'bg-tier-emergencyBg border-tier-emergency/30 text-tier-emergency'
};

export function Alert({ tone = 'info', icon: Icon, title, children, action, className }) {
  return (
    <div role="alert" className={cn('rounded-card border p-3 sm:p-4 flex items-start gap-2.5 text-xs', ALERT_TONES[tone], className)}>
      {Icon && <Icon className="w-4 h-4 shrink-0 mt-0.5" />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-bold mb-0.5">{title}</p>}
        <div className="leading-relaxed">{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- Badge */

export function Badge({ tone = 'neutral', className, children }) {
  const tones = {
    neutral:   'bg-surface-sunken text-ink-muted border-line',
    gov:       'bg-gov-50 dark:bg-gov-100 text-gov-700 dark:text-gov-600 border-gov-200',
    low:       'bg-tier-lowBg text-tier-low border-tier-low/30',
    moderate:  'bg-tier-moderateBg text-tier-moderate border-tier-moderate/30',
    high:      'bg-tier-highBg text-tier-high border-tier-high/30',
    emergency: 'bg-tier-emergency text-white border-tier-emergency'
  };
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  );
}

/* -------------------------------------------------------------- EmptyState */

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn('text-center py-10 px-4 border border-dashed border-line rounded-card', className)}>
      {Icon && <Icon className="w-8 h-8 text-ink-subtle mx-auto mb-2" />}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <p className="text-xs text-ink-muted mt-1 max-w-sm mx-auto">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- Skeleton */

export function Skeleton({ className }) {
  return <div className={cn('skeleton rounded-field', className)} aria-hidden="true" />;
}

/* ------------------------------------------------------------------ Spinner */

export function Spinner({ label = 'Loading…', className }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-10 text-xs text-ink-muted', className)}>
      <Loader2 className="w-4 h-4 animate-spin text-gov-600 dark:text-gov-500" />
      {label}
    </div>
  );
}
