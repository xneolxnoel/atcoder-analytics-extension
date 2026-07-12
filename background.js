chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "acAnalytics.fetchJson" || !message?.url) return undefined;

  (async () => {
    try {
      const res = await fetch(message.url, { credentials: "omit" });
      if (!res.ok) {
        sendResponse({
          ok: false,
          error: `HTTP ${res.status}`,
        });
        return;
      }

      const data = await res.json();
      sendResponse({ ok: true, data });
    } catch (e) {
      sendResponse({
        ok: false,
        error: e?.message ?? String(e),
      });
    }
  })();

  return true;
});
