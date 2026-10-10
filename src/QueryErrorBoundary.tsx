import { Component, Fragment, type ReactNode } from "react";

export default class QueryErrorBoundary extends Component<{
  children: ReactNode;
  failureText: string;
  retryLabel: string;
}, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (this.state.failed) return <div>
      <p className="error" role="alert">{this.props.failureText}</p>
      <button type="button" className="quiet" onClick={() => {
        this.setState(state => ({ failed: false, attempt: state.attempt + 1 }));
      }}>{this.props.retryLabel}</button>
    </div>;
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
