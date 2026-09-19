"use client";

/**
 * MapErrorBoundary
 * -----------------
 * Leaflet throws real DOM/runtime exceptions outside React's normal render
 * cycle (tile errors, "Map container is already initialized", cluster
 * icon-creation errors when a marker's internal `_leaflet_pos` isn't set
 * yet, etc). Without a boundary, any one of those unmounts the *entire*
 * React tree — which is why the whole dashboard used to go blank instead
 * of just the map.
 *
 * This boundary:
 *  - Catches render-phase errors from the Leaflet subtree.
 *  - Shows a small recoverable panel instead of a blank page.
 *  - Lets the user remount just the map (`Reload map`) without a full
 *    page refresh, since a fresh `key` forces React to build a brand new
 *    Leaflet container from scratch.
 *  - Reports to console (swap the `reportError` call for Sentry/etc. in
 *    Phase 5 — see the optimization plan).
 */

import React from "react";

interface Props {
  children: React.ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function reportError(error: Error, info: React.ErrorInfo) {
  // eslint-disable-next-line no-console
  console.error("[MapErrorBoundary] map crashed:", error, info.componentStack);
  // Phase 5 hook point: send to Sentry/telemetry here so real crash rates
  // are visible instead of only discovered anecdotally ("it crashes
  // sometimes").
}

export default class MapErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportError(error, info);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-bg-base p-6 text-center">
          <p className="font-body text-sm font-medium text-text-primary">
            The map hit a rendering error and stopped itself before it could
            crash the rest of the dashboard.
          </p>
          <p className="max-w-md font-mono text-xs text-text-tertiary">
            {this.state.error?.message ?? "Unknown error"}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            className="rounded-md border border-accent-primary bg-accent-primary/15 px-4 py-1.5 font-body text-xs font-medium text-accent-primary hover:bg-accent-primary/25"
          >
            Reload map
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
