import { Component, type ReactNode } from "react"

/** Isolates one feed card: a bad row renders a fallback instead of
 * unmounting the whole feed. Reset by remounting (parent passes a key). */
export class FeedPostErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="rounded-lg border border-neutral-300 bg-white px-5 py-6 text-center">
          <p className="text-[15px] font-semibold text-neutral-700">
            Couldn&apos;t show this report.
          </p>
          <button
            type="button"
            className="mt-3 font-semibold text-brand-navy underline underline-offset-4"
            onClick={() => this.setState({ failed: false })}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
