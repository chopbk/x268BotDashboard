let csrfToken = "";
let csrfRequest = null;
const pendingRequests = new Map();

async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  if (!csrfRequest) {
    csrfRequest = fetch("/api/auth/csrf", { credentials: "include" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.csrfToken) throw new Error(data.error || "Không lấy được CSRF token");
        csrfToken = data.csrfToken;
        return csrfToken;
      })
      .finally(() => { csrfRequest = null; });
  }
  return csrfRequest;
}

async function perform(path, { method = "GET", body, signal, timeoutMs = 20_000 } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    headers["X-CSRF-Token"] = await getCsrfToken();
  }

  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("Request timeout")), timeoutMs);
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: "include",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw error;
    const err = new Error("Không kết nối được server");
    err.status = 0;
    throw err;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Request failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function api(path, options = {}) {
  if (options.signal) return perform(path, options);
  const method = String(options.method || "GET").toUpperCase();
  const key = `${method}:${path}:${options.body === undefined ? "" : JSON.stringify(options.body)}`;
  const existing = pendingRequests.get(key);
  if (existing && !existing.signal?.aborted) return existing.promise;
  const promise = perform(path, options).finally(() => {
    if (pendingRequests.get(key)?.promise === promise) pendingRequests.delete(key);
  });
  pendingRequests.set(key, { promise, signal: options.signal });
  return promise;
}
