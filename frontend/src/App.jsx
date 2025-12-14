import React, { useState, useRef, useEffect } from "react";


const API_BASE = import.meta.env.VITE_API_BASE;

/* helper: extract id from YouTube url */
function extractIdFromUrl(url) {
  if (!url) return "";
  try {
    const m = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    const m2 = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
    if (m2) return m2[1];
    const m3 = url.match(/\/embed\/([A-Za-z0-9_-]{11})/);
    if (m3) return m3[1];
  } catch {}
  return "";
}

let ytPlayerReady = false;

function computeBlockSize(durationSeconds) {
  if (!durationSeconds || durationSeconds <= 0) return 120; // fallback
  return Math.max(30, Math.floor(durationSeconds * 0.05));
}

function groupTranscriptByPercent(transcript, duration) {
  if (!Array.isArray(transcript) || transcript.length === 0) return [];

  const blockSize = computeBlockSize(duration);
  const groups = new Map();

  transcript.forEach((line) => {
    const start = Math.floor(line.start || 0);
    const bucket = Math.floor(start / blockSize) * blockSize;

    if (!groups.has(bucket)) {
      groups.set(bucket, {
        start: bucket,
        end: bucket + blockSize,
        items: [],
      });
    }

    groups.get(bucket).items.push({
      ...line,
      timestamp: formatTimestamp(line.start),
    });
  });

  return Array.from(groups.values()).sort((a, b) => a.start - b.start);
}



function formatTimestamp(ts) {
  if (ts === undefined || ts === null) return "";
  if (typeof ts === "number" && !Number.isNaN(ts)) {
    const total = Math.floor(ts);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    const hours = Math.floor(mins / 60);
    const mm = (mins % 60).toString().padStart(2, "0");
    const ss = secs.toString().padStart(2, "0");
    if (hours) return `${hours.toString().padStart(2, "0")}:${mm}:${ss}`;
    return `${mm}:${ss}`;
  }
  return String(ts);
}

function parseTimestampToSeconds(ts) {
  if (!ts) return null;
  if (typeof ts === "number") return ts;
  const parts = ts.split(":").map((p) => parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p))) return null;
  let seconds = 0;
  for (let i = 0; i < parts.length; i++) {
    seconds = seconds * 60 + parts[i];
  }
  return seconds;
}

// === YouTube iframe seek helper ===
function seekYouTubeIframe(seconds) {
  const iframe = document.getElementById("yt-player");
  if (!iframe) return;

  iframe.contentWindow?.postMessage(
    JSON.stringify({
      event: "command",
      func: "seekTo",
      args: [seconds, true],
    }),
    "*"
  );
} 

function limitWords(text, maxWords = 50) {
  if (!text) return "";
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ") + "…";
}

function buildTranscriptSegments(transcriptText) {
  if (!transcriptText) return [];
  const lines = transcriptText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const segmentsMap = new Map();
  let hasTimestamps = false;
  const tsRe = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)$/;

  lines.forEach((line) => {
    const match = tsRe.exec(line);
    if (match) {
      hasTimestamps = true;
      const ts = match[1];
      const text = match[2] || "";
      const seconds = parseTimestampToSeconds(ts) ?? 0;
      const bucket = Math.floor(seconds / 180); // group every ~3 minutes
      const key = `bucket-${bucket}`;
      const entry = segmentsMap.get(key) || { start: bucket * 180, texts: [] };
      entry.texts.push(text);
      segmentsMap.set(key, entry);
    } else {
      const free = segmentsMap.get("free") || { start: null, texts: [] };
      free.texts.push(line);
      segmentsMap.set("free", free);
    }
  });

  if (!hasTimestamps) {
    const chunked = [];
    for (let i = 0; i < lines.length; i += 4) {
      const raw = lines.slice(i, i + 4).join(" ");
      const text = limitWords(raw, 50);
      chunked.push({ start: null, label: `Section ${chunked.length + 1}`, text });
    }
    return chunked;
  }

  return Array.from(segmentsMap.values())
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
    .map((seg, idx) => {
      const label =
        seg.start !== null
          ? `${formatTimestamp(seg.start)} - ${formatTimestamp(seg.start + 179)}`
          : `Section ${idx + 1}`;
      const raw = seg.texts.join(" ");
      const text = limitWords(raw, 50);
      return { label, text };
    });
}

/* ---------- Icons ---------- */

function IconCopy() {
  return (
    <svg
      className="w-4 h-4 inline-block"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
    >
      <path
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4"
      />
      <rect
        x="9"
        y="9"
        width="11"
        height="11"
        rx="2"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg
      className="w-4 h-4 inline-block"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
    >
      <path
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v12"
      />
      <path
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 11l4 4 4-4"
      />
      <rect
        x="3"
        y="17"
        width="18"
        height="4"
        rx="1"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M7 4.5v15l12-7.5-12-7.5z" />
    </svg>
  );
}

/* ---------- Small UI helpers ---------- */

function PillTab({ active, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-2 rounded-full text-sm font-semibold transition border backdrop-blur-sm ${
        active
          ? "bg-[#102040]/80 border-cyan-400/80 text-cyan-100 shadow-[0_10px_30px_rgba(0,240,255,0.25)]"
          : "bg-white/5 border-white/10 text-slate-300 hover:border-cyan-300/60 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function TimestampBadge({ ts }) {
  if (!ts) return null;
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 border border-cyan-400/30 text-cyan-100 font-mono">
      {ts}
    </span>
  );
}

function Modal({ title, open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0c111f] text-slate-50 rounded-2xl shadow-2xl border border-white/10 max-w-2xl w-full">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <h3 className="font-semibold text-base">{title}</h3>
          <button
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-full border border-slate-700 text-slate-300 hover:text-white"
          >
            X
          </button>
        </div>
        <div className="p-5 max-h-[65vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function MindmapNode({ node, depth = 0 }) {
  if (!node) return null;

  const label = node.title || node.topic || node.name || node.heading || "Untitled";
  const children = Array.isArray(node.children)
    ? node.children
    : Array.isArray(node.subtopics)
    ? node.subtopics
    : Array.isArray(node.items)
    ? node.items
    : [];

  return (
    <div className="pl-4">
      <div className="relative">
        {depth > 0 && <span className="absolute -left-4 top-0 bottom-0 w-px bg-white/10" />}

        <div className="ml-2 mb-3 rounded-xl bg-white/5 border border-white/10 p-3 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm font-semibold text-slate-50">{label}</div>
            {children.length > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#0d162b] text-slate-300 border border-slate-800">
                {children.length} sub
              </span>
            )}
          </div>
          {node.summary && <p className="mt-1 text-xs text-slate-300 leading-relaxed">{node.summary}</p>}
          {node.notes && <p className="mt-1 text-[11px] text-slate-400">{node.notes}</p>}
        </div>
      </div>

      {children.length > 0 && (
        <div className="ml-4">
          {children.map((child, i) => (
            <MindmapNode key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function LoadingPanel() {
  const bars = Array.from({ length: 32 });
  const steps = ["Analyzing audio track...", "Extracting key frames...", "Neural processing engaged...", "Composing mind map & flashcards..."];
  return (
    <div className="rounded-2xl border border-cyan-400/30 bg-[#0c111f]/90 p-6 shadow-[0_20px_80px_rgba(0,240,255,0.12)]">
      <div className="h-24 bg-black/30 rounded-xl border border-white/5 overflow-hidden relative">
        <div className="absolute inset-0 flex items-end gap-[3px] px-3">
          {bars.map((_, idx) => (
            <span
              key={idx}
              className="flex-1 bg-gradient-to-t from-[#00f0ff]/10 via-[#00f0ff]/60 to-[#bd00ff]/70 loading-bar"
              style={{ animationDelay: `${idx * 0.03}s` }}
            />
          ))}
        </div>
      </div>
      <div className="mt-4 text-left text-xs text-slate-300 font-mono space-y-1">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 animate-pulse" />
            <span>{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function KeyMomentChip({ label, ts, onClick }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1 rounded-full text-xs font-mono border border-cyan-400/40 text-cyan-100 bg-white/5 hover:bg-cyan-400/10 transition"
    >
      [{ts}] {label}
    </button>
  );
}

function TranscriptBlock({ transcript, duration, onSeek, onCopy }) {
  const groups = groupTranscriptByPercent(transcript, duration);

  if (!groups.length) {
    return <div className="text-sm text-slate-400 italic">Transcript unavailable.</div>;
  }

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-white">Transcript</h4>
        <button
          onClick={onCopy}
          className="text-[11px] px-2 py-1 rounded-full bg-white/10 text-slate-200 border border-white/10"
        >
          Copy
        </button>
      </div>

      <div className="h-[420px] overflow-y-auto space-y-4 rounded-xl border border-white/10 bg-black/30 p-3">
        {groups.map((group, i) => (
          <div
            key={i}
            className="rounded-xl border border-cyan-300/30 bg-[#0b1224]/70 p-3"
          >
            <div className="text-xs font-mono text-cyan-200 mb-2">
              {formatTimestamp(group.start)} – {formatTimestamp(group.end)}
            </div>

            <div className="space-y-2">
              {group.items.map((line, j) => (
                <div key={j} className="flex gap-3 text-sm leading-relaxed">
                  <button
                    onClick={() => onSeek?.(line.start)}
                    className="shrink-0 font-mono text-cyan-300 hover:underline"
                  >
                    [{line.timestamp}]
                  </button>
                  <span className="text-slate-200">{line.text}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}



/* ---------- Main App ---------- */

export default function App() {
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [flippedCards, setFlippedCards] = useState({});

  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("quick");
  const [flashOpen, setFlashOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [sourceTab, setSourceTab] = useState("youtube");
  const [inputFocused, setInputFocused] = useState(false);
  const chatRef = useRef();
  const chatEndRef = useRef(null);
  const [assistantTyping, setAssistantTyping] = useState(false);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  // defensive helpers
  const safeArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const safeTerms = (v) => {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (typeof v === "object") return [v];
    return [{ term: "", definition: String(v) }];
  };
  const safePoints = (v) => {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    return [v];
  };

  const normalizedMindmap = (() => {
    const mapData = result?.mindmap;
    if (!mapData) return [];
    if (Array.isArray(mapData)) return mapData;
    if (typeof mapData === "object") return [mapData];
    return [];
  })();

  const chapters = safePoints(result?.chapters);
  const tags = safeArray(result?.tags);
  const terms = safeTerms(result?.terminologies);
  const flashcardCount = safeArray(result?.flashcards).length;
  const quizCount = safeArray(result?.quiz).length;

  const transcriptText = (() => {
    const t = result?.transcript || result?.transcript_text || result?.full_transcript;
    if (Array.isArray(t)) {
      return t
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object") {
            const text = item.text || item.content || "";
            const ts = item.start ?? item.timestamp;
            const stamp = formatTimestamp(ts);
            return stamp ? `[${stamp}] ${text}` : text;
          }
          return String(item ?? "");
        })
        .join("\n");
    }
    if (t && typeof t === "object") {
      try {
        return Object.values(t).join("\n");
      } catch {
        return "";
      }
    }
    return typeof t === "string" ? t : "";
  })();

  const sourceNames = {
    youtube: "YouTube video",
    web: "webpage",
    text: "long text",
  };

  const hasMatchingResult = !!(result && (result.source || "youtube") === sourceTab);

  const sourceTabs = [
    { key: "youtube", label: "YouTube" },
    { key: "web", label: "Webpage" },
    { key: "text", label: "Long Text" },
  ];

  const sourceDetails = [
    {
      key: "youtube",
      title: "YouTube Video",
      desc: "Drop in a link and get an instant summary.",
      sample: "https://www.youtube.com/watch?v=example",
    },
    {
      key: "web",
      title: "Web / Article",
      desc: "Summarize any article or webpage.",
      sample: "https://example.com/article",
    },
    {
      key: "text",
      title: "Long Text / Notes",
      desc: "Paste long-form notes or docs.",
      sample: "",
    },
  ];

  const linkInputClass = `w-full min-h-[140px] border border-white/10 bg-black/40 rounded-xl px-10 py-4 text-sm md:text-base text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-transparent font-mono ${
    inputFocused ? "shadow-[0_0_30px_rgba(0,240,255,0.25)]" : ""
  }`;

  /* ---------- API calls ---------- */

  async function analyze() {
    setError(null);

    const trimmed = url.trim();
    const payload = { source: sourceTab };

    if (sourceTab === "text") {
      if (!trimmed) return setError("Please paste your long text to summarize.");
      payload.text = trimmed;
    } else if (sourceTab === "web") {
      if (!trimmed) return setError("Please paste the webpage URL to summarize.");
      payload.url = trimmed;
    } else if (sourceTab === "youtube") {
      if (!trimmed) return setError("Please paste a YouTube link to summarize.");
      payload.url = trimmed;
      const maybeId = extractIdFromUrl(trimmed);
      if (maybeId) payload.video_id = maybeId;
    } else {
      return setError("Unsupported source mode.");
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      if (!res.ok) {
        try {
          const parsed = JSON.parse(text);
          throw new Error(parsed.detail ?? parsed.error ?? text);
        } catch {
          throw new Error(text || "Server error");
        }
      }

      const json = JSON.parse(text);
      const merged = {
        ...json,
        source: sourceTab,
        source_input: payload.text ?? payload.url ?? trimmed,
      };

      if (sourceTab === "youtube" && !merged.video_id) {
        const id = extractIdFromUrl(trimmed);
        if (id) merged.video_id = id;
      }

      setResult(merged);
      setTab("quick");
      setChatHistory([]);
    } catch (e) {
      console.error(e);
      const msg = String(e.message ?? e);
      if (msg.toLowerCase().includes("notranscriptfound")) {
        setError(
          "Không tìm thấy transcript cho video này. Hãy kiểm tra link công khai, có phụ đề/tự động caption, hoặc thử một video khác."
        );
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function sendChat() {
    const q = chatRef.current?.value?.trim();
    if (!q || !result) return;

    // ✅ build next history safely
    const nextHistory = [
      ...chatHistory,
      { role: "user", content: q },
    ];

    setChatHistory(nextHistory);
    chatRef.current.value = "";

    // show typing indicator
    setAssistantTyping(true);

    const chatPayload = {
      context: {
        title: result?.title,
        overview: result?.overview,
        chapters: result?.chapters,
        major_points: result?.major_points,
        transcript: result?.transcript,
      },
      history: nextHistory, // ✅ USE THIS
    };

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chatPayload),
      });

      let json;
      const text = await res.text();

      try {
        json = JSON.parse(text);
      } catch {
        json = { answer: text };
      }

      if (!res.ok) {
        setChatHistory((h) => [
          ...h,
          {
            role: "assistant",
            content: json.answer || "⚠️ Server error. Check backend logs.",
          },
        ]);
        return;
      }

    const answer =
      json.answer ??
      json.message ??
      json.content ??
      json.text ??
      (typeof json === "string" ? json : "(No response from server)");

    if (!answer || !answer.trim()) {
      setChatHistory((h) => [
        ...h,
        { role: "assistant", content: "⚠️ I couldn’t generate a reply. Please try again." },
      ]);
      return;
    }


      setChatHistory((h) => [
        ...h,
        { role: "assistant", content: answer },
      ]);
    } catch (e) {
      setChatHistory((h) => [
        ...h,
        { role: "assistant", content: "(error contacting server)" },
      ]);
    } finally {
      setAssistantTyping(false);
    }
  }




  /* ---------- Small actions ---------- */

  function downloadJSON() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(result?.title ?? "summary").replace(/\s+/g, "_").slice(0, 50)}.json`;
    a.click();
  }

  function copySummary() {
    if (!result?.overview) return;
    navigator.clipboard.writeText(result.overview);
  }

  function copyTranscript() {
    if (!transcriptText) return;
    navigator.clipboard.writeText(transcriptText);
  }

  function handleMomentClick(ts) {
    if (!result?.video_id) return;
    const seconds = parseTimestampToSeconds(ts);
    if (seconds == null) return;
    seekYouTubeIframe(seconds);
  }


  useEffect(() => {
    const raw = localStorage.getItem("gistai_state");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setResult(parsed.result);
        setSourceTab(parsed.sourceTab);
        setUrl(parsed.url);
      } catch {}
    }
  }, []);


  useEffect(() => {
    if (result) {
      localStorage.setItem("gistai_state", JSON.stringify({
        result,
        sourceTab,
        url,
      }));
    }
  }, [result, sourceTab, url]);



  function handleGoBack() {
    setResult(null);
    setUrl("");
    setTab("quick");
    setChatHistory([]);
    setFlashOpen(false);
    setQuizOpen(false);
    setSelectedAnswers({});
    localStorage.removeItem("gistai_state");
  }


  function renderPreview() {
    const label = sourceNames[sourceTab] || "content";
    const placeholder = (
      <div className="h-full w-full grid place-items-center text-slate-500 text-sm px-4 text-center">
        {`Add a ${label} and click Summarize to preview it here.`}
      </div>
    );

    if (!hasMatchingResult) return placeholder;

    if (sourceTab === "youtube") {
      if (!result?.video_id) return placeholder;
      return (
        <div className="relative h-full">
          <iframe
            id="yt-player"
            src={`https://www.youtube.com/embed/${result.video_id}?enablejsapi=1`}
            className="w-full h-full rounded-xl"
            allow="autoplay; encrypted-media"
            allowFullScreen
          />

        </div>
      );
    }

    if (sourceTab === "web") {
      return (
        <div className="h-full w-full bg-gradient-to-br from-[#0d1b2b] to-[#111827] p-5 text-left text-slate-100">
          <p className="text-xs text-slate-400 mb-2">Webpage Preview</p>
          <div className="text-sm break-words font-semibold line-clamp-2">{result?.title || "Unknown URL"}</div>
          <p className="mt-2 text-xs text-slate-300 line-clamp-5">{result?.overview || "Summary available in the panel on the right."}</p>
        </div>
      );
    }

    if (sourceTab === "text") {
      const snippet = result?.source_input || result?.overview || "Long text preview";
      return (
        <div className="h-full w-full bg-gradient-to-br from-[#0d1b2b] to-[#111827] p-5 text-left text-slate-100 overflow-y-auto">
          <p className="text-xs text-slate-400 mb-2">Text Input Snippet</p>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{snippet.slice(0, 500)}...</p>
        </div>
      );
    }

    return placeholder;
  }

  /* ---------- UI ---------- */

  const keyMoments = chapters.slice(0, 6).map((c, i) => ({
    label: c.title || c.summary || `Moment ${i + 1}`,
    ts: c.timestamp || c.start || "",
  }));

  return (
    <div className="min-h-screen bg-[#050A14] text-slate-100 relative overflow-hidden font-['Inter',_sans-serif]">
      <style>
      {`
      @keyframes dot {
        0% { opacity: 0.2; }
        20% { opacity: 1; }
        100% { opacity: 0.2; }
      }
      `}
      </style>

      <div className="absolute inset-0 bg-mesh pointer-events-none" />
      <div className="absolute inset-0 opacity-40 mix-blend-screen pointer-events-none" aria-hidden>
        <div className="absolute -left-16 top-10 h-64 w-64 bg-gradient-to-br from-[#00f0ff]/20 via-[#00f0ff]/15 to-[#bd00ff]/10 blur-3xl" />
        <div className="absolute right-0 bottom-10 h-72 w-72 bg-gradient-to-br from-[#bd00ff]/15 via-[#00f0ff]/10 to-transparent blur-[90px]" />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 pb-16">
        {/* Header */}
        <header className="flex items-center justify-between pt-8">
          <div className="flex items-center gap-3 text-xl font-black tracking-tight text-white">
            <span className="relative inline-flex items-center gap-1">
              <span className="relative">Summ
                <span className="relative inline-block">
                  ar
                  <span className="absolute -top-2 left-1 h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(0,240,255,0.9)] pulse-dot" />
                </span>
                izer
              </span>
              <span className="text-cyan-300">.AI</span>
            </span>
            <span className="text-[11px] px-2 py-1 rounded-full border border-white/10 bg-white/5 uppercase tracking-widest text-slate-300">Neon Stack</span>
          </div>
          {result && (
            <button
              onClick={handleGoBack}
              className="
                text-xs px-3 py-1 rounded-full
                border border-red-500/40
                bg-red-500/10
                text-red-300
                hover:bg-red-500/20
                hover:text-red-200
                transition
              "
            >
              ← Restart
            </button>
          )}
        </header>

        {/* Hero */}
        <section className="mt-12 text-center">
          <h1 className="text-4xl md:text-5xl font-extrabold text-white leading-tight">
            Summarize any YouTube video in an instant.
          </h1>
          <p className="mt-3 text-lg text-slate-300 max-w-3xl mx-auto">
            Let AI condense hours of content into minutes of reading.
          </p>

          <div className="mt-8 relative overflow-hidden rounded-3xl border border-white/10 bg-[#0c111f]/80 shadow-[0_25px_80px_rgba(0,0,0,0.45)]">
            <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_20%_20%,rgba(0,240,255,0.18),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(189,0,255,0.18),transparent_25%),linear-gradient(120deg,rgba(255,255,255,0.04)_0,rgba(255,255,255,0)_35%,rgba(255,255,255,0.04)_70%)]" />
            <div className="absolute inset-0 bg-grid pointer-events-none" />
            <div className="relative p-6 md:p-8 space-y-4">
              {!loading ? (
                <>
                  <div className="flex flex-wrap justify-center gap-2">
                    {sourceTabs.map((s) => (
                      <PillTab key={s.key} active={sourceTab === s.key} label={s.label} onClick={() => setSourceTab(s.key)} />
                    ))}
                  </div>

                  <div className="flex flex-col md:flex-row gap-3 items-stretch">
                    <div
                      className={`flex-1 relative rounded-2xl border ${
                        inputFocused
                          ? "border-cyan-400/70 shadow-[0_0_40px_rgba(0,240,255,0.25)]"
                          : "border-white/10"
                      } bg-black/40 backdrop-blur-sm transition-all duration-200`}
                    >
                      <span className="absolute left-4 top-4 text-cyan-300 font-mono text-sm flex items-center gap-1">
                        &gt;<span className="cmd-caret" aria-hidden>|</span>
                      </span>
                      {sourceTab === "youtube" && (
                        <textarea
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          onFocus={() => setInputFocused(true)}
                          onBlur={() => setInputFocused(false)}
                          placeholder="Paste a YouTube URL to ignite the AI..."
                          className={linkInputClass}
                          aria-label="YouTube URL"
                        />
                      )}
                      {sourceTab === "web" && (
                        <textarea
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          onFocus={() => setInputFocused(true)}
                          onBlur={() => setInputFocused(false)}
                          placeholder="Paste an article or webpage URL to summarize"
                          className={linkInputClass}
                          aria-label="Web URL"
                        />
                      )}
                      {sourceTab === "text" && (
                        <textarea
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          onFocus={() => setInputFocused(true)}
                          onBlur={() => setInputFocused(false)}
                          placeholder="Paste long text or notes here"
                          className="w-full min-h-[200px] border border-white/10 bg-black/40 rounded-xl px-10 py-4 text-sm md:text-base text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-transparent font-mono"
                        />
                      )}
                    </div>

                    <button
                      onClick={analyze}
                      disabled={loading}
                      className="md:w-40 w-full h-[140px] md:h-auto rounded-2xl font-bold text-white text-base bg-gradient-to-br from-[#00f0ff] via-[#00b7ff] to-[#bd00ff] shadow-[0_20px_60px_rgba(0,240,255,0.4)] hover:translate-y-[-2px] transition active:translate-y-0"
                    >
                      SUMMARIZE
                    </button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3 text-left text-sm">
                    {sourceDetails.map((item) => (
                      <div
                        key={item.key}
                        className={`rounded-xl border ${sourceTab === item.key ? "border-cyan-400/50 bg-white/5" : "border-white/5 bg-white/5"} p-3 backdrop-blur-sm`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-slate-400">{item.title}</p>
                            <p className="text-sm text-white font-semibold">{item.desc}</p>
                          </div>
                          {item.sample ? (
                            <button
                              onClick={() => {
                                setSourceTab(item.key);
                                setUrl(item.sample);
                              }}
                              className="text-[11px] px-2 py-1 rounded-full bg-white/10 text-cyan-100 border border-cyan-300/40"
                            >
                              Use sample
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-500">Paste text</span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate mt-1">
                          {item.sample || "Paste your own text in the box above."}
                        </div>
                      </div>
                    ))}
                  </div>

                  {error && (
                    <div className="text-sm text-red-200 bg-red-950/60 border border-red-800 rounded-lg px-3 py-2 text-left">
                      {error}
                    </div>
                  )}
                </>
              ) : (
                <LoadingPanel />
              )}
            </div>
          </div>
        </section>

        {/* Results */}
        <section className="mt-12">
          <div className="grid gap-6 xl:grid-cols-[1.05fr_1fr]">
            <div className="bg-white/5 border border-white/10 rounded-3xl p-4 shadow-[0_20px_60px_rgba(0,0,0,0.4)] backdrop-blur-sm">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-slate-400">
                <span>Preview</span>
                <span />
              </div>
              <div className="mt-3 rounded-2xl overflow-hidden border border-white/10 aspect-video bg-black/30">
                {renderPreview()}
              </div>

              {hasMatchingResult ? (
                <div className="mt-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-50 line-clamp-2">{result.title}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{result.channel}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button onClick={copySummary} className="text-[11px] px-2.5 py-1 rounded-full bg-white/10 text-slate-100 border border-white/10 hover:border-cyan-300/60">
                        <IconCopy /> <span className="ml-1">Copy overview</span>
                      </button>
                      <button onClick={downloadJSON} className="text-[11px] px-2.5 py-1 rounded-full bg-cyan-200 text-slate-900 hover:bg-white flex items-center gap-1">
                        <IconDownload /> <span>JSON</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    <div className="px-2 py-1 rounded-full text-[11px] border border-cyan-400/40 bg-white/5 text-cyan-100">
                      {result.type ?? sourceTab}
                    </div>
                    <div className="px-2 py-1 rounded-full text-[11px] border border-white/10 text-slate-200 bg-white/5">Tags: {tags.length}</div>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-400">
                  Select {sourceNames[sourceTab]} and generate a summary to see a preview here.
                </p>
              )}

              <TranscriptBlock
                transcript={result?.transcript}
                onSeek={(sec) => seekYouTubeIframe(sec)}
                onCopy={copyTranscript}
              />

            </div>

            <div className="bg-white/5 border border-white/10 rounded-3xl p-5 shadow-[0_20px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              {result ? (
                <>
                  <div className="mt-1 flex flex-wrap gap-2 bg-white/5 border border-white/10 rounded-full p-1">
                    {[{ key: "quick", label: "Quick Summary" }, { key: "timeline", label: "Timeline" }, { key: "transcript", label: "Transcript" }, { key: "mindmap", label: "Mind Map" }, { key: "chat", label: "AI Chat" }].map((t) => (
                      <button
                        key={t.key}
                        className={`px-3 py-1.5 text-[12px] rounded-full transition font-semibold ${
                          tab === t.key
                            ? "bg-gradient-to-r from-[#00f0ff]/40 to-[#bd00ff]/50 text-white shadow-[0_10px_30px_rgba(0,240,255,0.2)]"
                            : "text-slate-300 hover:text-white"
                        }`}
                        onClick={() => setTab(t.key)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                    <div className="px-3 py-1.5 rounded-full text-[11px] border border-cyan-400/50 bg-white/5 text-cyan-100 shadow-[0_10px_30px_rgba(0,240,255,0.15)]">
                      {result.type ?? sourceTab}
                    </div>
                    <div className="flex items-center gap-2 text-[12px]">
                      <button
                        onClick={() => setFlashOpen(true)}
                        className="px-2.5 py-1 rounded-full bg-gradient-to-r from-[#00f0ff]/30 to-[#bd00ff]/40 text-white border border-cyan-300/50 hover:shadow-[0_10px_35px_rgba(0,240,255,0.25)]"
                        disabled={flashcardCount === 0}
                      >
                        Flashcards ({flashcardCount})
                      </button>
                      <button
                        onClick={() => setQuizOpen(true)}
                        className="px-2.5 py-1 rounded-full bg-emerald-500 text-white hover:bg-emerald-600"
                        disabled={quizCount === 0}
                      >
                        Quiz ({quizCount})
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 space-y-4">
                    {/* QUICK SUMMARY */}
                    {tab === "quick" && (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold">Core Message</h3>
                            <button
                              onClick={copySummary}
                              className="text-[11px] px-2.5 py-1 rounded-full bg-white/10 text-slate-200 border border-white/10 hover:border-cyan-300/60"
                            >
                              <IconCopy /> <span className="ml-1">Copy</span>
                            </button>
                          </div>
                          <p className="mt-2 text-sm leading-relaxed text-slate-100 whitespace-pre-wrap font-mono">
                            {result.overview || "No overview provided."}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {tags.length === 0 ? (
                              <span className="text-[11px] text-slate-500 italic">No tags provided.</span>
                            ) : (
                              tags.map((tag, i) => (
                                <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-slate-100 border border-white/10">
                                  {tag}
                                </span>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">Key Moments</h3>
                            <span className="text-[11px] text-slate-400">{keyMoments.length} chips</span>
                          </div>
                          {keyMoments.length === 0 ? (
                            <p className="mt-2 text-sm text-slate-400 italic">No timeline available.</p>
                          ) : (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {keyMoments.map((m, idx) => (
                                <KeyMomentChip key={idx} label={m.label} ts={m.ts || "--:--"} onClick={() => handleMomentClick(m.ts)} />
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold">Key Terms & Concepts</h3>
                            <span className="text-[11px] text-slate-400">{terms.length} items</span>
                          </div>
                          {terms.length === 0 ? (
                            <p className="mt-2 text-sm text-slate-400 italic">No terms extracted.</p>
                          ) : (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {terms.map((t, i) => (
                                <div key={i} className="px-2.5 py-1 rounded-full bg-white/5 text-[12px] text-slate-100 border border-white/10">
                                  <span className="font-semibold">{t.term ?? t.name ?? `Term ${i + 1}`}:</span> {t.definition ?? t.desc ?? ""}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* TIMELINE */}
                    {tab === "timeline" && (
                      <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold">Timeline</h3>
                          <span className="text-[11px] text-slate-400">{chapters.length} items</span>
                        </div>
                        {chapters.length === 0 ? (
                          <p className="mt-2 text-sm text-slate-400 italic">No chapters generated.</p>
                        ) : (
                          <ul className="mt-3 space-y-3">
                            {chapters.map((c, i) => {
                              const title = c.title || c.summary || `Chapter ${i + 1}`;
                              const ts = c.timestamp ?? c.start ?? "";
                              return (
                                <li key={i} className="flex gap-3 items-start">
                                  <div className="h-10 w-10 rounded-xl bg-white/5 border border-white/10 text-cyan-200 grid place-items-center font-mono text-xs">
                                    {ts || i + 1}
                                  </div>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-semibold text-white">{title}</span>
                                      {sourceTab === "youtube" && <TimestampBadge ts={ts} />}
                                    </div>
                                    {c.summary && <p className="text-xs text-slate-300 mt-1 leading-relaxed">{c.summary}</p>}
                                    {ts && sourceTab === "youtube" && (
                                      <button
                                        onClick={() => handleMomentClick(ts)}
                                        className="mt-1 text-[11px] text-cyan-200 underline decoration-dotted"
                                      >
                                        Jump to video
                                      </button>
                                    )}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    )}

                    {/* TRANSCRIPT TAB */}
                    {tab === "transcript" && (
                      <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                        <TranscriptBlock
                          transcript={result?.transcript}
                          onSeek={(sec) => seekYouTubeIframe(sec)}
                          onCopy={copyTranscript}
                        />

                      </div>
                    )}

                    {/* MINDMAP TAB */}
                    {tab === "mindmap" && (
                      <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">Mind Map</h3>
                            <span className="text-[11px] text-slate-400">{normalizedMindmap.length} roots</span>
                          </div>
                          <p className="text-xs text-slate-400">Outline of the main knowledge branches.</p>
                        </div>
                        {normalizedMindmap.length === 0 ? (
                          <div className="mt-3 rounded-xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-slate-400 italic">No mindmap was generated for this content.</div>
                        ) : (
                          <div className="mt-3 space-y-4">
                            {normalizedMindmap.map((node, i) => (
                              <MindmapNode key={i} node={node} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* CHAT TAB */}
                    {tab === "chat" && (
                      <div className="rounded-2xl border border-white/10 bg-black/30 flex flex-col h-[420px]">

                        {/* Chat messages */}
                        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin scrollbar-thumb-cyan-400/30">

                          {chatHistory.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 text-sm px-6">
                              <div className="mb-2 text-cyan-300 font-semibold">AI Chat</div>
                              Ask follow-up questions about this content.<br />
                              <span className="text-xs mt-1 block">
                                Example: “Explain the science behind the second key moment”
                              </span>
                            </div>
                          ) : (
                            chatHistory.map((m, i) => (
                              <div
                                key={i}
                                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                              >
                                <div
                                  className={`max-w-[78%] px-4 py-2 rounded-2xl text-sm leading-relaxed ${
                                    m.role === "user"
                                      ? "bg-gradient-to-r from-cyan-400/70 to-purple-500/70 text-white rounded-br-sm"
                                      : "bg-white/5 border border-white/10 text-slate-100 rounded-bl-sm"
                                  }`}
                                >
                                  {m.content}
                                </div>
                              </div>
                            ))
                          
                          )}
                          {assistantTyping && (
                            <div className="flex justify-start">
                              <div className="max-w-[78%] px-4 py-2 rounded-2xl bg-white/5 border border-white/10 text-slate-300 text-sm font-mono">
                                <span style={{ display: "inline-flex", gap: "6px" }}>
                                  <span style={{ animation: "dot 1.4s infinite" }}>•</span>
                                  <span style={{ animation: "dot 1.4s infinite 0.2s" }}>•</span>
                                  <span style={{ animation: "dot 1.4s infinite 0.4s" }}>•</span>
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Auto scroll anchor */}
                          <div ref={chatEndRef} />
                        </div>

                        {/* Input bar */}
                        <div className="border-t border-white/10 bg-[#070c18] p-3">
                          <div className="flex gap-2">
                            <input
                              ref={chatRef}
                              placeholder="Ask about the video..."
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  sendChat();
                                }
                              }}
                              className="flex-1 px-4 py-2 rounded-full bg-black/40 border border-white/10 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/60"
                            />
                            <button
                              onClick={sendChat}
                              className="px-5 py-2 rounded-full bg-gradient-to-r from-cyan-400 to-purple-500 text-white text-sm font-semibold hover:shadow-[0_0_20px_rgba(0,240,255,0.4)]"
                            >
                              Send
                            </button>
                          </div>
                        </div>

                      </div>
                    )}

                  </div>
                </>
              ) : (
                <div className="flex-1 min-h-[22rem] bg-black/30 border border-dashed border-white/10 rounded-2xl grid place-items-center text-center px-8">
                  <div>
                    <p className="text-lg font-semibold text-slate-100">Ready when you are</p>
                    <p className="text-sm text-slate-400 mt-1">Paste a link above and click Summarize to view the full features here.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Flashcards modal */}
      <Modal title="Flashcards" open={flashOpen} onClose={() => setFlashOpen(false)}>
        {safeArray(result?.flashcards).length === 0 ? (
          <div className="text-sm text-slate-300 italic">
            No flashcards provided.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {safeArray(result.flashcards).map((f, i) => {
              const flipped = !!flippedCards[i];

              return (
                <div
                  key={i}
                  onClick={() =>
                    setFlippedCards((prev) => ({
                      ...prev,
                      [i]: !prev[i],
                    }))
                  }
                  style={{
                    perspective: "1000px",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      minHeight: "140px",
                      transformStyle: "preserve-3d",
                      transition: "transform 0.6s ease",
                      transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
                    }}
                  >
                    {/* FRONT */}
                    <div
                      style={{
                        backfaceVisibility: "hidden",
                        position: "absolute",
                        inset: 0,
                      }}
                      className="p-4 rounded-xl border border-cyan-300/30 bg-[#0b1224]/80"
                    >
                      <div className="text-[11px] uppercase tracking-wide text-cyan-100 font-semibold">
                        Card {i + 1}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-white">
                        {f.q ?? f.question ?? `Question ${i + 1}`}
                      </div>
                      <div className="mt-4 text-[11px] text-slate-400">
                        Click to reveal answer
                      </div>
                    </div>

                    {/* BACK */}
                    <div
                      style={{
                        backfaceVisibility: "hidden",
                        transform: "rotateY(180deg)",
                        position: "absolute",
                        inset: 0,
                      }}
                      className="p-4 rounded-xl border border-cyan-400/40 bg-[#08121f]"
                    >
                      <div className="text-[11px] uppercase tracking-wide text-cyan-100 font-semibold">
                        Answer
                      </div>
                      <div className="mt-3 text-sm text-cyan-100 font-mono leading-relaxed">
                        {f.a ?? f.answer ?? "No answer"}
                      </div>
                      <div className="mt-4 text-[11px] text-slate-400">
                        Click to flip back
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>




      {/* Quiz modal */}
      <Modal title="Quiz (MCQs)" open={quizOpen} onClose={() => setQuizOpen(false)}>
        {safeArray(result?.quiz).length === 0 ? (
          <div className="text-sm text-slate-300 italic">No quiz provided.</div>
        ) : (
          safeArray(result.quiz).map((q, i) => (
            <div
              key={i}
              className="relative overflow-hidden p-4 mb-3 last:mb-0 rounded-xl border border-purple-300/40 bg-[#0f1b2f]/80 shadow-[0_12px_38px_rgba(189,0,255,0.18)] transition transform hover:-translate-y-[3px]"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-[#bd00ff]/20 via-transparent to-[#00f0ff]/18 opacity-80 blur-xl" aria-hidden />
              <div className="relative">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-purple-100 font-semibold">
                  <span>Question {i + 1}</span>
                  <span className="h-2 w-2 rounded-full bg-purple-300 animate-pulse" />
                </div>
                <div className="mt-2 font-semibold text-sm text-white">{q.q ?? q.question ?? `Question ${i + 1}`}</div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {safeArray(q.choices).map((c, j) => {
                    const picked = selectedAnswers[i] === j;
                    const isCorrect = c === q.answer;

                    return (
                      <button
                        key={j}
                        onClick={() =>
                          setSelectedAnswers({ ...selectedAnswers, [i]: j })
                        }
                        className={`px-3 py-2 rounded-lg text-xs border ${
                          picked
                            ? isCorrect
                              ? "bg-green-500/30 border-green-400"
                              : "bg-red-500/30 border-red-400"
                            : "bg-white/5 border-white/10"
                        }`}
                      >
                        {c}
                      </button>
                    );

                    
                  })}
                </div>
                {selectedAnswers[i] !== undefined && (
                  <div className="mt-3 text-xs text-cyan-200 font-semibold">
                    Correct answer:{" "}
                    <span className="text-cyan-100">{q.answer}</span>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </Modal>
    </div>
  );
}
