"use client";

/**
 * Last-resort boundary for crashes in the root layout. Without it Next swaps the
 * whole document for a near-empty white page. Inline styles because the app
 * stylesheet may not be available here.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b101a",
          color: "#e2e8f0",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "24px",
        }}
      >
        <div role="alert" style={{ maxWidth: 420, textAlign: "center" }}>
          <p style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
            Something went wrong loading this page.
          </p>
          <p style={{ fontSize: 14, color: "#94a3b8", margin: "0 0 20px" }}>
            Please try again. If it keeps happening, reload the page.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginRight: 8,
              padding: "10px 16px",
              borderRadius: 8,
              border: 0,
              background: "#3b5bdb",
              color: "#fff",
              fontSize: 14,
            }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid #334155",
              background: "transparent",
              color: "#e2e8f0",
              fontSize: 14,
            }}
          >
            Reload page
          </button>
        </div>
      </body>
    </html>
  );
}
