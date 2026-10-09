/** Fail-closed Turnstile verification for staging registration only. */
export async function verifyTurnstile(token, { secret, remoteip, verify = fetch } = {}) {
  if (typeof secret !== "string" || secret.length < 10 ||
      typeof token !== "string" || token.length < 10 || token.length > 2048) return false;
  const form = new URLSearchParams({ secret, response: token });
  if (typeof remoteip === "string" && /^[0-9a-fA-F:.]{3,45}$/.test(remoteip)) {
    form.set("remoteip", remoteip);
  }
  try {
    const response = await verify("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(5000)
    });
    if (!response?.ok) return false;
    const result = await response.json();
    return result?.success === true;
  } catch {
    return false;
  }
}
