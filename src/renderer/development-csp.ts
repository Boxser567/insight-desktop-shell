/** Allow only the local Vite development transport and its inline error overlay. */
export function relaxRendererCspForDevelopment(html: string): string {
  return html
    .replace("style-src 'self';", "style-src 'self' 'unsafe-inline';")
    .replace(
      "connect-src 'none'",
      "connect-src 'self' ws://localhost:* ws://127.0.0.1:*"
    )
}
