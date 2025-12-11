import React, { useState, useRef } from "react";
const API_BASE = import.meta.env.VITE_API_BASE;

/*
  Polished YouTube Summarizer App.jsx
  - Two-column responsive layout
  - Right panel hidden until analyze result
  - Accordion major points, timestamp badges
  - Flashcards & Quiz modal
  - Copy / Download JSON, Copy timestamp link
  - Defensive rendering (won't crash if model returns odd shapes)
  - Requires Tailwind CSS
*/

function IconCopy() {
  return (
    <svg className="w-4 h-4 inline-block" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M9 12H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4" />
      <rect x="9" y="9" width="11" height="11" rx="2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg className="w-4 h-4 inline-block" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M12 3v12" />
      <path strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M8 11l4 4 4-4" />
      <rect x="3" y="17" width="18" height="4" rx="1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TimestampBadge({ ts }) {
  if (!ts) return null;
  return <span className="text-xs px-2 py-0.5 mr-2 mb-2 rounded bg-slate-100 text-slate-700">{ts}</span>;
}

function AccordionPoint({ p, index }) {
  const [open, setOpen] = useState(index === 0);
  const title = p.title ?? p.summary ?? "Untitled";
  const ts = p.timestamp ?? p.start ?? "";
  return (
    <div className="border-b last:border-none py-3">
      <button
        onClick={() => setOpen((s) => !s)}
        className="w-full flex items-start justify-between gap-4"
        aria-expanded={open}
      >
        <div>
          <div className="flex items-center gap-2">
            <TimestampBadge ts={ts} />
            <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
          </div>
          {!open && <p className="text-xs text-slate-600 mt-1 line-clamp-2">{p.summary ?? ""}</p>}
        </div>
        <div className="text-slate-400">{open ? "▾" : "▸"}</div>
      </button>

      {open && (
        <div className="mt-3 text-sm text-slate-700">
          <p className="mb-2">{p.summary ?? "No summary available."}</p>
          {p.details && <div className="text-xs text-slate-600">{p.details}</div>}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => navigator.clipboard.writeText(p.summary ?? "")}
              className="text-xs px-2 py-1 rounded bg-slate-100"
            >
              <IconCopy /> <span className="ml-1">Copy</span>
            </button>
            {ts && (
              <button
                onClick={() => {
                  const id = extractIdFromUrl(window.location.href) || "";
                  const link = id ? `https://youtu.be/${id}?t=${Math.round(Number(ts))}` : `#${ts}`;
                  navigator.clipboard.writeText(link);
                  alert("Timestamp link copied");
                }}
                className="text-xs px-2 py-1 rounded bg-slate-100"
              >
                Copy timestamp link
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Modals: flashcards & quiz
function Modal({ title, open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-lg max-w-2xl w-full p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">{title}</h3>
          <button onClick={onClose} className="text-slate-500">✕</button>
        </div>
        <div className="mt-3 max-h-[60vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export default function App() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const [tab, setTab] = useState("summary");
  const [flashOpen, setFlashOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const chatRef = useRef();

  // defensive helpers
  const safeArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const safeTerms = (v) => {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (typeof v === "object") return [v];
    return [{ term: "", definition: String(v) }];
  };

  async function analyze() {
    setError(null);
    setResult(null);
    if (!url) return setError("Please paste a YouTube URL.");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const text = await res.text();
      if (!res.ok) {
        try {
          const parsed = JSON.parse(text);
          throw new Error(parsed.detail ?? parsed.error ?? text);
        } catch (e) {
          throw new Error(text || "Server error");
        }
      }
      const json = JSON.parse(text);
      // ensure video_id present
      if (!json.video_id) {
        try {
          const id = extractIdFromUrl(url);
          if (id) json.video_id = id;
        } catch {}
      }
      setResult(json);
      setTab("summary");
    } catch (e) {
      console.error(e);
      setError(String(e.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  async function sendChat() {
    const q = chatRef.current?.value?.trim();
    if (!q || !result) return;
    const history = [...chatHistory, { role: "user", content: q }];
    setChatHistory(history);
    chatRef.current.value = "";
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, history }),
      });
      const json = await res.json();
      setChatHistory((h) => [...h, { role: "assistant", content: json.answer }]);
    } catch (e) {
      setChatHistory((h) => [...h, { role: "assistant", content: "(error contacting server)" }]);
    }
  }

  function downloadJSON() {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(result?.title ?? "summary").replace(/\s+/g, "_").slice(0,50)}.json`;
    a.click();
  }

  function copySummary() {
    navigator.clipboard.writeText(result?.overview ?? "");
    alert("Overview copied");
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto grid grid-cols-12 gap-6">
        {/* Left column: input + video */}
        <div className="col-span-12 lg:col-span-5">
          <div className="bg-white rounded-2xl shadow p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold">YouTube Summarizer</h1>
                <p className="text-sm text-slate-500 mt-1">Paste a YouTube URL and press Summarize.</p>
              </div>
              <div className="text-xs text-slate-400">Model: gpt-4o-mini</div>
            </div>

            <div className="mt-4 flex gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="flex-1 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                aria-label="YouTube URL"
              />
              <button
                onClick={analyze}
                disabled={loading}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg shadow hover:bg-indigo-700 disabled:opacity-60"
              >
                {loading ? "Working..." : "Summarize"}
              </button>
            </div>

            {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

            <div className="mt-5">
              {result ? (
                <>
                  <div className="aspect-w-16 aspect-h-9 bg-black rounded-lg overflow-hidden">
                    <iframe
                      title={result.title || "video"}
                      src={`https://www.youtube.com/embed/${result.video_id}`}
                      className="w-full h-full"
                      allowFullScreen
                    />
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{result.title}</div>
                      <div className="text-xs text-slate-500">{result.channel}</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button onClick={copySummary} className="text-sm text-slate-600 px-2 py-1 rounded bg-slate-100">Copy overview</button>
                      <button onClick={downloadJSON} className="text-sm text-slate-600 px-2 py-1 rounded bg-slate-100 flex items-center gap-1">
                        <IconDownload /> <span>Download JSON</span>
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="aspect-w-16 aspect-h-9 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400">
                  Video preview
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column: hidden until result exists */}
        {result ? (
          <div className="col-span-12 lg:col-span-7">
            <div className="bg-white rounded-2xl shadow p-5 h-[78vh] flex flex-col">
              {/* tabs */}
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <button
                    className={`px-3 py-2 rounded-md ${tab === "summary" ? "bg-slate-100 font-semibold" : "text-slate-600"}`}
                    onClick={() => setTab("summary")}
                  >
                    Summary
                  </button>
                  <button
                    className={`px-3 py-2 rounded-md ${tab === "mindmap" ? "bg-slate-100 font-semibold" : "text-slate-600"}`}
                    onClick={() => setTab("mindmap")}
                  >
                    Mind Map
                  </button>
                  <button
                    className={`px-3 py-2 rounded-md ${tab === "chat" ? "bg-slate-100 font-semibold" : "text-slate-600"}`}
                    onClick={() => setTab("chat")}
                  >
                    AI Chat
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <button onClick={() => setFlashOpen(true)} className="text-sm px-2 py-1 rounded bg-indigo-600 text-white">Flashcards</button>
                  <button onClick={() => setQuizOpen(true)} className="text-sm px-2 py-1 rounded bg-emerald-600 text-white">Quiz</button>
                  <button onClick={() => navigator.clipboard.writeText(window.location.href)} className="text-sm text-slate-600 px-2 py-1 rounded bg-slate-100">Share</button>
                </div>
              </div>

              {/* content */}
              <div className="mt-4 overflow-y-auto flex-1 pr-2">
                {tab === "summary" && (
                  <div>
                    <div className="flex items-start justify-between">
                      <div>
                        <h2 className="text-xl font-bold">{result.title}</h2>
                        <div className="text-sm text-slate-500">{result.channel}</div>
                      </div>

                      <div className="text-xs text-slate-400">{(result.type ?? "").toUpperCase()}</div>
                    </div>

                    <p className="mt-3 text-slate-700">{result.overview}</p>

                    <div className="mt-4 flex flex-wrap">
                      {safeArray(result.major_points).slice(0, 8).map((p, i) => (
                        <TimestampBadge key={i} ts={p.timestamp ?? p.start ?? ""} />
                      ))}
                    </div>

                    {/* major points accordion */}
                    <div className="mt-5 border rounded-lg overflow-hidden">
                      {safeArray(result.major_points).length === 0 ? (
                        <div className="p-4 text-sm text-slate-500 italic">No major points found.</div>
                      ) : (
                        safeArray(result.major_points).map((p, i) => <AccordionPoint key={i} p={p} index={i} />)
                      )}
                    </div>

                    {/* terminology */}
                    <div className="mt-5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold">Terminology & Concepts</h3>
                        <div className="text-sm text-slate-500">{safeTerms(result.terminologies).length} items</div>
                      </div>

                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {safeTerms(result.terminologies).length === 0 ? (
                          <div className="text-sm text-slate-500 italic">No terms extracted.</div>
                        ) : (
                          safeTerms(result.terminologies).map((t, i) => (
                            <div key={i} className="p-3 border rounded bg-slate-50">
                              <div className="font-medium">{t.term ?? t.name ?? `Term ${i + 1}`}</div>
                              <div className="text-sm text-slate-600 mt-1">{t.definition ?? t.desc ?? ""}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* raw JSON */}
                    <details className="mt-6 bg-slate-50 p-3 rounded">
                      <summary className="cursor-pointer">Raw API response</summary>
                      <pre className="mt-2 text-xs whitespace-pre-wrap max-h-72 overflow-y-auto">{JSON.stringify(result, null, 2)}</pre>
                    </details>
                  </div>
                )}

                {tab === "mindmap" && (
                  <div>
                    <h3 className="text-lg font-semibold">Mind Map</h3>
                    {result.mindmap ? (
                      <pre className="mt-3 text-sm whitespace-pre-wrap max-h-[60vh] overflow-y-auto">{JSON.stringify(result.mindmap, null, 2)}</pre>
                    ) : (
                      <div className="mt-3 text-sm text-slate-500 italic">No mindmap generated for this video.</div>
                    )}
                  </div>
                )}

                {tab === "chat" && (
                  <div className="flex flex-col h-full">
                    <div className="flex-1 overflow-y-auto p-2 space-y-3">
                      {chatHistory.length === 0 ? (
                        <div className="text-sm text-slate-500 italic">Ask follow-up questions about this video above.</div>
                      ) : (
                        chatHistory.map((m, i) => (
                          <div key={i} className={`max-w-[85%] ${m.role === "user" ? "ml-auto text-right" : ""}`}>
                            <div className={`inline-block p-2 rounded ${m.role === "user" ? "bg-indigo-50" : "bg-slate-100"}`}>
                              <div className="text-sm">{m.content}</div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="mt-3 flex gap-2">
                      <input ref={chatRef} placeholder="Ask about the video..." className="flex-1 p-2 border rounded" />
                      <button onClick={sendChat} className="px-4 py-2 bg-indigo-600 text-white rounded">Send</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="col-span-12 lg:col-span-7 flex items-center justify-center">
            <div className="text-center text-slate-400">
              <h3 className="text-lg font-semibold">No video selected</h3>
              <p className="text-sm">Paste a YouTube URL and click <span className="font-semibold">Summarize</span>.</p>
            </div>
          </div>
        )}
      </div>

      {/* Flashcards modal */}
      <Modal title="Flashcards" open={flashOpen} onClose={() => setFlashOpen(false)}>
        {safeArray(result?.flashcards).length === 0 ? (
          <div className="text-sm text-slate-500 italic p-3">No flashcards provided.</div>
        ) : (
          safeArray(result.flashcards).map((f, i) => (
            <div key={i} className="p-3 border-b last:border-none">
              <div className="font-semibold">{f.q ?? f.question ?? `Q${i + 1}`}</div>
              <div className="text-sm text-slate-700 mt-1">{f.a ?? f.answer ?? ""}</div>
            </div>
          ))
        )}
      </Modal>

      {/* Quiz modal */}
      <Modal title="Quiz (MCQs)" open={quizOpen} onClose={() => setQuizOpen(false)}>
        {safeArray(result?.quiz).length === 0 ? (
          <div className="text-sm text-slate-500 italic p-3">No quiz provided.</div>
        ) : (
          safeArray(result.quiz).map((q, i) => (
            <div key={i} className="p-3 border-b last:border-none">
              <div className="font-semibold">{q.q ?? q.question ?? `Question ${i + 1}`}</div>
              <ul className="mt-2 text-sm list-disc ml-5">
                {safeArray(q.choices).map((c, j) => (
                  <li key={j} className={`${c === q.answer ? "font-medium" : ""}`}>{c}</li>
                ))}
              </ul>
              <div className="text-xs text-slate-400 mt-2">Answer: {q.answer}</div>
            </div>
          ))
        )}
      </Modal>
    </div>
  );
}

/* helper to extract id from common YouTube urls */
function extractIdFromUrl(url) {
  if (!url) return "";
  try {
    const m = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    const m2 = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
    if (m2) return m2[1];
    // try to parse embed urls
    const m3 = url.match(/\/embed\/([A-Za-z0-9_-]{11})/);
    if (m3) return m3[1];
  } catch {}
  return "";
}
