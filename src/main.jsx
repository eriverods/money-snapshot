import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ fontFamily: 'monospace', background: '#0a0f1a', color: '#f87171', padding: 24, minHeight: '100vh' }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Something went wrong</div>
          <pre style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 20, background: '#a78bfa', border: 'none', borderRadius: 8, padding: '10px 18px', color: '#0a0f1a', fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace' }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
