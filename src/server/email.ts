/** Sends the sign-in link through Resend's HTTP API. */

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export async function sendSignInLink(options: {
  resend: { key: string; from: string };
  to: string;
  url: string;
  siteName: string;
}): Promise<void> {
  const { resend, to, url, siteName } = options;
  const subject = `Sign in to edit ${siteName}`;
  const text = `Use this link to sign in to the editor for ${siteName}:\n\n${url}\n\nThe link works for 20 minutes. If you didn't ask for it, you can ignore this email.`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#1f2937">
<p>Use this button to sign in to the editor for <strong>${escapeHtml(siteName)}</strong>.</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Sign in to edit</a></p>
<p style="color:#6b7280;font-size:14px">The link works for 20 minutes. If you didn't ask for it, you can ignore this email.</p>
</div>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resend.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: resend.from, to: [to], subject, text, html }),
  });
  if (!response.ok) {
    throw new Error(`Resend failed: ${response.status} ${(await response.text().catch(() => "")).slice(0, 200)}`);
  }
}
