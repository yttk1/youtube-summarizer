const API_BASE = import.meta.env.VITE_API_BASE ?? "";
export const analyze = (url) =>
  fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  }).then((r) => r.json());
