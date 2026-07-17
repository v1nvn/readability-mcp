# Building Resilient Single-Page Apps - Example Tech Blog

Modern single-page applications live or die by how gracefully they handle failure. When the network drops, when a chunk fails to load, or when an API returns an unexpected shape, the difference between a frustrating blank screen and a recoverable experience is almost entirely a matter of architecture.

In this post we walk through three patterns — deterministic rendering, boundary isolation, and progressive enhancement — that together let an SPA keep working when its assumptions break. Each pattern is framework-agnostic; the examples use React, but the ideas apply equally to Vue, Svelte, or plain DOM.

## Deterministic Rendering

The core idea is that given the same state, your view should always produce the same markup. That sounds obvious, but it rules out reading `Date.now()` or `Math.random()` during render, and it rules out mutating props. When rendering is deterministic, you can snapshot it on the server, ship it to the client, and hydrate without mismatches.

The table below summarizes the trade-offs between the three hydration strategies we considered:

| Strategy | Time to Interactive | Complexity | Best for |
| --- | --- | --- | --- |
| Full hydration | Slow | Low | Content-heavy sites |
| Partial hydration | Medium | Medium | Mixed marketing + app |
| Islands | Fast | High | Mostly-static with interactive widgets |

## Boundary Isolation

Treat every asynchronous boundary as a potential failure surface. A route that loads data should isolate that data's error state from the surrounding shell, so a failed fetch in one panel never blanks the whole page. Error boundaries (or their equivalent) are not optional decoration — they are the load-bearing walls of a resilient UI.

Here is a minimal error boundary that catches render failures and degrades to a labeled fallback instead of crashing the tree:

```tsx
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return <Fallback />;
    }
    return this.props.children;
  }
}
```

![Architecture diagram showing the render pipeline from server snapshot to hydrated client](https://example.com/static/architecture.png)

The render pipeline: a server snapshot is shipped as HTML, then hydrated on the client without re-executing the data layer.

## Progressive Enhancement

Finally, assume JavaScript will fail. Render real HTML on the server, wire up interactivity on the client, and make sure the core task — reading the article, submitting the form — works before any bundle has loaded. The result is a page that degrades from "rich application" to "functional document" instead of to "blank screen."

The resilience you get from these three patterns is not theoretical. We measured a 40% drop in client-side error reports after rolling them out across our dashboard, with no change to the underlying feature set.