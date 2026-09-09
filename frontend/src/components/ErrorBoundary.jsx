import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useT } from '../i18n/index.jsx';

/**
 * Catches a render crash in one part of the app instead of blanking the page.
 *
 * This exists because a single bad assumption — `doctors.map` on an API
 * response that had become `{ doctors: [...] }` — took down the entire
 * assessment screen with no visible error at all. On a clinical screen a white
 * page is the worst possible failure: the assistant cannot tell whether the
 * record saved, and there is nothing on screen to report.
 *
 * A boundary cannot fix the bug, but it keeps the failure local and named.
 */

/**
 * The fallback UI, split out as a function component purely so it can use
 * hooks. An error boundary has to be a class — there is still no hook for
 * `componentDidCatch` — and a class cannot call `useT`. Rendering the panel
 * from a child is less machinery than wiring the context in by hand, and it
 * keeps the boundary itself as small as it should be.
 *
 * The raw error message is deliberately NOT translated. It is diagnostic text
 * the user reads out to somebody supporting them, and a translated stack
 * message is a worse bug report than an English one.
 */
function ErrorPanel({ labelKey, label, message, onRetry }) {
  const t = useT();
  // `labelKey` is the translated route name; `label` is the plain-English
  // escape hatch for a call site that has no key. Either may be absent, and
  // then the generic heading is used.
  const name = labelKey ? t(labelKey, label || '') : label;

  return (
    <div className="p-6 rounded-field bg-tier-emergencyBg border border-tier-emergency/30 space-y-3">
      <div className="flex items-center gap-2 text-tier-emergency">
        <AlertTriangle className="w-5 h-5 shrink-0" />
        <h3 className="text-sm font-bold">
          {name
            ? t('error.sectionNamed', '{label} could not be displayed', { label: name })
            : t('error.section', 'This section could not be displayed')}
        </h3>
      </div>
      <p className="text-xs text-tier-emergency">
        {t('error.stillUsable', 'The rest of the page is still usable. Nothing you entered has been sent.')}
      </p>
      <pre className="text-[11px] text-tier-emergency bg-surface-raised/60 rounded p-2 overflow-x-auto">
        {message}
      </pre>
      <button
        type="button"
        onClick={onRetry}
        className="px-3 py-1.5 rounded-field bg-tier-emergency hover:opacity-90 text-white text-xs font-semibold flex items-center gap-1.5"
      >
        <RefreshCw className="w-3.5 h-3.5" /> {t('common.retry', 'Try again')}
      </button>
    </div>
  );
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.retry = () => this.setState({ error: null });
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`Render error in ${this.props.label || 'component'}:`, error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <ErrorPanel
        labelKey={this.props.labelKey}
        label={this.props.label}
        message={this.state.error?.message || String(this.state.error)}
        onRetry={this.retry}
      />
    );
  }
}
