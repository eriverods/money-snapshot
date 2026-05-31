import React from 'react'
import ReactDOM from 'react-dom/client'
import './theme.css'
import App from './App'

// Apply saved theme before first paint to avoid flash
;(function () {
  const saved = localStorage.getItem('lt_theme') || 'dark'
  document.documentElement.setAttribute('data-theme', saved)
})()

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ fontFamily: "'Lato', sans-serif", background: 'var(--c-bg)', color: 'var(--c-negative)', padding: 24, minHeight: '100vh' }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Something went wrong</div>
          <pre style={{ fontSize: 12, color: 'var(--c-text-mid)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 20, background: 'var(--c-accent)', border: 'none', borderRadius: 8, padding: '10px 18px', color: 'var(--c-btn-text)', fontWeight: 700, cursor: 'pointer', fontFamily: "'Lato', sans-serif" }}
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
