import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

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
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
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
      <div className="p-6 rounded-field bg-tier-emergencyBg border border-tier-emergency/30 space-y-3">
        <div className="flex items-center gap-2 text-tier-emergency">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <h3 className="text-sm font-bold">
            {this.props.label ? `${this.props.label} could not be displayed` : 'This section could not be displayed'}
          </h3>
        </div>
        <p className="text-xs text-tier-emergency">
          The rest of the page is still usable. Nothing you entered has been sent.
        </p>
        <pre className="text-[11px] text-tier-emergency bg-surface-raised/60 rounded p-2 overflow-x-auto">
          {this.state.error?.message || String(this.state.error)}
        </pre>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="px-3 py-1.5 rounded-field bg-tier-emergency hover:opacity-90 text-white text-xs font-semibold flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Try again
        </button>
      </div>
    );
  }
}
