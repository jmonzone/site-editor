"use client";

import { useId, useState } from "react";

/** The editor's sign-in page: asks for an email and sends a sign-in link to it. */
export function SignIn({ siteName, apiPath, linkExpired }: { siteName: string; apiPath: string; linkExpired?: boolean }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(linkExpired ? "That sign-in link has expired or isn't valid. Request a new one." : null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    setError(null);
    try {
      const response = await fetch(`${apiPath}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Couldn't send the link. Try again.");
      setStatus("sent");
    } catch (reason) {
      setError((reason as Error).message);
      setStatus("idle");
    }
  }

  return (
    <main className="se-signin">
      <div className="se-signin-card">
        <p className="se-eyebrow">Site editor</p>
        <h1 className="se-signin-title">{siteName}</h1>
        {status === "sent" ? (
          <div role="status">
            <p>
              If <strong>{email}</strong> can edit this site, a sign-in link is on its way. It works for 20 minutes.
            </p>
            <button type="button" className="se-button" onClick={() => setStatus("idle")}>
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <p>Enter your email and we&rsquo;ll send you a link to sign in.</p>
            <div className="se-field">
              <label className="se-label" htmlFor={id}>
                Email
              </label>
              <input
                id={id}
                className="se-input"
                type="email"
                autoComplete="email"
                required
                value={email}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            {error && (
              <p id={`${id}-error`} className="se-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="se-button se-button-primary se-button-wide" disabled={status === "sending" || !email}>
              {status === "sending" ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
