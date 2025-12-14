import React, { useEffect, useState, useRef } from "react";

const API_BASE = import.meta.env.VITE_API_BASE;

const STORAGE_KEY = "ai_summarizer_state_v1";


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

function timestampToSeconds(ts) {
  if (ts == null) return null;

  if (typeof ts === "number") return ts;

  if (typeof ts === "string") {
    if (/^\d+$/.test(ts)) return Number(ts);

    const parts = ts.split(":").map(Number);
    if (parts.some(isNaN)) return null;

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
  }

  return null;
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

function IconChevronLeft() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function Logo({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 hover:opacity-90 transition"
      title="New summary"
    >
      <img
        src="/logo.png"
        alt="AI Summarizer Logo"
        className="h-10 w-10 rounded-lg"
      />
      <span className="text-xl sm:text-2xl font-bold tracking-tight text-slate-100">
        AI Summarizer
      </span>
    </button>
  );
}

/* ---------- Small UI helpers ---------- */

function PillTab({ active, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition border ${
        active
          ? "bg-[#152441] border-slate-700 text-sky-300 shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
          : "bg-[#0d162b] border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white"
      }`}
    >
      <span className="h-2 w-2 rounded-full bg-sky-400 inline-block" />
      <span>{label}</span>
    </button>
  );
}

function TimestampBadge({ ts, onClick }) {
  if (!ts) return null;
  return (
    <button
      onClick={onClick}
      className="text-[11px] px-2 py-0.5 rounded-full bg-[#101a30] text-slate-200 border border-slate-800 hover:bg-[#152441] hover:text-sky-300 transition"
      title={`Seek to ${ts}`}
    >
      {ts}
    </button>
  );
}

function Modal({ title, open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="bg-[#0f182d] text-slate-50 rounded-2xl shadow-2xl border border-slate-800 max-w-2xl w-full flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
          <h3 className="font-semibold text-lg">{title}</h3>
          <button
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-full border border-slate-700 text-slate-300 hover:text-white transition-colors"
          >
            X
          </button>
        </div>
        <div className="p-5 overflow-y-auto custom-scrollbar">
            {children}
        </div>
      </div>
    </div>
  );
}

/* ---------- Interactive Components ---------- */

function FlashcardCarousel({ cards }) {
    const [index, setIndex] = useState(0);
    const [flipped, setFlipped] = useState(false);

    if (!cards || cards.length === 0) return <div className="text-slate-400 italic">No flashcards available.</div>;

    const card = cards[index];

    const handleNext = () => {
        setFlipped(false);
        setIndex((prev) => (prev + 1) % cards.length);
    };

    const handlePrev = () => {
        setFlipped(false);
        setIndex((prev) => (prev - 1 + cards.length) % cards.length);
    };

    return (
        <div className="flex flex-col items-center w-full max-w-lg mx-auto">
            {/* Card Container */}
            <div 
                className="w-full h-72 cursor-pointer perspective-1000 group"
                style={{ perspective: "1000px" }}
                onClick={() => setFlipped(!flipped)}
            >
                <div 
                    className="relative w-full h-full transition-transform duration-500 shadow-xl rounded-2xl"
                    style={{ 
                        transformStyle: "preserve-3d", 
                        transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" 
                    }}
                >
                    {/* Front */}
                    <div 
                        className="absolute inset-0 w-full h-full bg-[#152441] border border-slate-700 rounded-2xl p-8 flex flex-col items-center justify-center text-center backface-hidden"
                        style={{ backfaceVisibility: "hidden" }}
                    >
                        <span className="text-xs font-bold uppercase tracking-wider text-sky-400 mb-4">Question</span>
                        <p className="text-lg md:text-xl font-medium text-slate-100 leading-relaxed">
                            {card.q ?? card.question}
                        </p>
                        <p className="absolute bottom-4 text-[10px] uppercase tracking-widest text-slate-500 opacity-70">Click to flip</p>
                    </div>

                    {/* Back */}
                    <div 
                        className="absolute inset-0 w-full h-full bg-[#0d162b] border border-sky-900 rounded-2xl p-8 flex flex-col items-center justify-center text-center backface-hidden"
                        style={{ 
                            backfaceVisibility: "hidden", 
                            transform: "rotateY(180deg)" 
                        }}
                    >
                        <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-4">Answer</span>
                        <p className="text-base md:text-lg text-slate-200 leading-relaxed">
                            {card.a ?? card.answer}
                        </p>
                    </div>
                </div>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-between w-full mt-6 px-4">
                <button 
                    onClick={handlePrev} 
                    className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                >
                    <IconChevronLeft />
                </button>
                <span className="text-sm font-medium text-slate-400 font-mono">
                    {index + 1} / {cards.length}
                </span>
                <button 
                    onClick={handleNext}
                    className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                >
                    <IconChevronRight />
                </button>
            </div>
        </div>
    );
}

function QuizInteractive({ questions }) {
    const [selections, setSelections] = useState({});

    if (!questions || questions.length === 0) return <div className="text-slate-400 italic">No quiz available.</div>;

    const handleSelect = (qIndex, choice) => {
        // Prevent changing answer
        if (selections[qIndex]) return; 
        setSelections(prev => ({...prev, [qIndex]: choice}));
    };

    return (
        <div className="space-y-8">
            {questions.map((q, i) => {
                const userChoice = selections[i];
                const isAnswered = !!userChoice;
                const correctAnswer = q.answer;
                const isCorrect = userChoice === correctAnswer;

                return (
                    <div key={i} className="p-5 border border-slate-800 rounded-xl bg-[#101a30]">
                        <div className="flex gap-3 mb-4">
                            <span className="flex-none flex items-center justify-center w-6 h-6 rounded-full bg-slate-800 text-xs font-bold text-slate-400 border border-slate-700">
                                {i + 1}
                            </span>
                            <p className="font-medium text-slate-100 pt-0.5">{q.q ?? q.question}</p>
                        </div>
                        
                        <div className="space-y-2.5 pl-9">
                            {(q.choices || []).map((c, cIdx) => {
                                let btnClass = "w-full text-left px-4 py-3 rounded-lg border text-sm transition-all duration-200 flex items-center justify-between group ";
                                
                                if (!isAnswered) {
                                    btnClass += "border-slate-700 bg-[#0d162b] hover:bg-[#152441] hover:border-slate-600 text-slate-300";
                                } else {
                                    if (c === correctAnswer) {
                                        // Always highlight correct answer
                                        btnClass += "bg-emerald-500/10 border-emerald-500/50 text-emerald-200 font-medium shadow-[0_0_15px_rgba(16,185,129,0.1)]";
                                    } else if (c === userChoice) {
                                        // Highlight wrong user selection
                                        btnClass += "bg-red-500/10 border-red-500/50 text-red-200";
                                    } else {
                                        // Dim others
                                        btnClass += "border-slate-800 bg-[#0d162b] text-slate-500 opacity-50";
                                    }
                                }

                                return (
                                    <button 
                                        key={cIdx}
                                        onClick={() => handleSelect(i, c)}
                                        disabled={isAnswered}
                                        className={btnClass}
                                    >
                                        <span>{c}</span>
                                        {isAnswered && c === correctAnswer && (
                                            <span className="text-emerald-400 text-xs font-bold uppercase ml-2">Correct</span>
                                        )}
                                        {isAnswered && c === userChoice && c !== correctAnswer && (
                                            <span className="text-red-400 text-xs font-bold uppercase ml-2">Your Answer</span>
                                        )}
                                    </button>
                                )
                            })}
                        </div>

                        {isAnswered && (
                            <div className={`mt-4 ml-9 text-xs px-4 py-3 rounded-lg border flex items-start gap-2 animate-in fade-in duration-300 ${isCorrect ? 'bg-emerald-900/10 border-emerald-900/30 text-emerald-200' : 'bg-red-900/10 border-red-900/30 text-red-200'}`}>
                                <div className="mt-0.5 font-bold text-lg">
                                    {isCorrect ? '✓' : '✕'}
                                </div>
                                <div>
                                    <span className="font-bold uppercase tracking-wide opacity-80 block mb-1">
                                        {isCorrect ? "Correct!" : "Incorrect"}
                                    </span>
                                    {!isCorrect && (
                                        <span>The correct answer is: <span className="font-semibold">{correctAnswer}</span></span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    );
}

/* ---------- Mindmap ---------- */

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
        {depth > 0 && (
          <span className="absolute -left-4 top-0 bottom-0 w-px bg-slate-800" />
        )}

        <div className="ml-2 mb-3 rounded-xl bg-[#101a30] border border-slate-800 p-3 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm font-semibold text-slate-50">{label}</div>
            {children.length > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#0d162b] text-slate-300 border border-slate-800">
                {children.length} sub
              </span>
            )}
          </div>
          {node.summary && (
            <p className="mt-1 text-xs text-slate-300 leading-relaxed">
              {node.summary}
            </p>
          )}
          {node.notes && (
            <p className="mt-1 text-[11px] text-slate-400">{node.notes}</p>
          )}
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
/* ---------- Main App ---------- */





let ytApiPromise = null;

function loadYouTubeAPI() {
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(tag);

    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
  });

  return ytApiPromise;
}

export default function App() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Restored: tab, flashOpen, quizOpen, chatHistory
  const [tab, setTab] = useState("summary");
  const [flashOpen, setFlashOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  
  const [sourceTab, setSourceTab] = useState("youtube");
  const chatRef = useRef();

  const playerRef = useRef(null);
  const iframeRef = useRef(null);

  const chatEndRef = useRef(null);
  const [isTyping, setIsTyping] = useState(false);


  function seekToTimestamp(ts) {
    const seconds = timestampToSeconds(ts);

    if (
      seconds == null ||
      !playerRef.current ||
      typeof playerRef.current.seekTo !== "function"
    ) {
      console.warn("Seek failed:", ts);
      return;
    }

    playerRef.current.seekTo(seconds, true);
    playerRef.current.playVideo();
  }


  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, isTyping]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const saved = JSON.parse(raw);

      if (saved.sourceTab) setSourceTab(saved.sourceTab);
      if (saved.url) setUrl(saved.url);
      if (saved.result) setResult(saved.result);
      if (saved.tab) setTab(saved.tab);
      if (saved.chatHistory) setChatHistory(saved.chatHistory);
    } catch (e) {
      console.warn("Failed to restore saved state", e);
    }
  }, []);


  useEffect(() => {
    // Avoid saving empty state
    if (!url && !result) return;

    const payload = {
      sourceTab,
      url,
      result,
      tab,
      chatHistory,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [sourceTab, url, result, tab, chatHistory]);


    useEffect(() => {
      if (sourceTab !== "youtube") return;
      if (!result?.video_id) return;
      if (!iframeRef.current) return;

      let destroyed = false;

      loadYouTubeAPI().then((YT) => {
        if (destroyed) return;

        // Destroy old player if exists
        if (playerRef.current) {
          playerRef.current.destroy();
          playerRef.current = null;
        }

        playerRef.current = new YT.Player(iframeRef.current, {
          videoId: result.video_id,
          playerVars: {
            modestbranding: 1,
            rel: 0,
          },
          events: {
            onReady: () => {
              console.log("YT player ready");
            },
          },
        });
      });

      return () => {
        destroyed = true;
      };
    }, [sourceTab, result?.video_id]);



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

  const majorPoints = safePoints(result?.major_points);
  const chapters = safePoints(result?.chapters);
  const tags = safeArray(result?.tags);
  const terms = safeTerms(result?.terminologies);
  const flashcardCount = safeArray(result?.flashcards).length;
  const quizCount = safeArray(result?.quiz).length;

  const sourceNames = {
    youtube: "YouTube video",
    web: "webpage",
    text: "long text",
  };

  const hasMatchingResult = !!(
    result && (result.source || "youtube") === sourceTab
  );

  // Simplified source definitions (no files)
  const sourceTabs = [
    { key: "youtube", label: "YouTube" },
    { key: "web", label: "Webpage" },
    { key: "text", label: "Long Text" },
  ];

  const sourceDetails = [
    {
      key: "youtube",
      title: "YouTube Video",
      desc: "Paste a video link to summarize.",
      sample: "https://www.youtube.com/watch?v=example",
    },
    {
      key: "web",
      title: "Webpage / Article",
      desc: "Summarize any article URL.",
      sample: "https://example.com/article",
    },
    {
      key: "text",
      title: "Long Text / Notes",
      desc: "Paste raw text or notes below.",
      sample: "",
    },
  ];

  const sourceLabels = {
    youtube: "YouTube Video",
    web: "Webpage",
    text: "Long Text",
  };

  const linkInputClass =
    "w-full min-h-[140px] border-2 border-dashed border-slate-700 bg-[#0b1429] rounded-xl px-4 py-4 text-sm md:text-base text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/60 resize-none";
  
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
      setTab("summary");
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

    const sourceInput = url.trim() || result?.source_input || "";

    setChatHistory((h) => [...h, { role: "user", content: q }]);
    chatRef.current.value = "";
    setIsTyping(true);

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: sourceInput,
          history: [...chatHistory, { role: "user", content: q }],
        }),
      });

      const json = await res.json();

      setChatHistory((h) => [
        ...h,
        { role: "assistant", content: json.answer },
      ]);
    } catch {
      setChatHistory((h) => [
        ...h,
        { role: "assistant", content: "(error contacting server)" },
      ]);
    } finally {
      setIsTyping(false);
    }
  }


  /* ---------- Small actions ---------- */

  function clearPreview() {
    // Destroy YouTube player if exists
    if (playerRef.current) {
      try {
        playerRef.current.destroy();
      } catch {}
      playerRef.current = null;
    }

    // Remove iframe contents
    if (iframeRef.current) {
      iframeRef.current.innerHTML = "";
    }
  }


  function resetSummarizer() {
    clearPreview();
    setUrl("");
    setResult(null);
    setError(null);
    setChatHistory([]);
    setTab("summary");
    localStorage.removeItem(STORAGE_KEY);
  }

  function goBack() {
    setChatHistory([]);
    clearPreview();
    setResult(null);
    setError(null);
    setTab("summary");
  }


  function downloadJSON() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(result?.title ?? "summary")
      .replace(/\s+/g, "_")
      .slice(0, 50)}.json`;
    a.click();
  }

  function copySummary() {
    if (!result?.overview) return;
    navigator.clipboard.writeText(result.overview);
  }

  function renderPreview() {
    const label = sourceNames[sourceTab] || "content";
    const placeholder = (
      <div className="h-full w-full grid place-items-center text-slate-500 text-sm px-4 text-center">
        {`Add a ${label} and click Generate Summary to preview it here.`}
      </div>
    );

    if (!hasMatchingResult) return placeholder;

    if (sourceTab === "youtube") {
      if (!result?.video_id) return placeholder;
      return (
          <div
            ref={iframeRef}
            className="w-full h-full"
            id="yt-player"
          />

      );
    }

    if (sourceTab === "web") {
      // For web/text, just show a preview of the source content
      return (
        <div className="h-full w-full bg-[#0b1429] p-4 text-left text-slate-100">
          <p className="text-xs text-slate-400 mb-2">Webpage Preview</p>
          <div className="text-sm break-words line-clamp-2 font-semibold">
            {result?.title || "Unknown URL"}
          </div>
          <p className="mt-2 text-xs text-slate-400 line-clamp-5">
            {result?.overview || "Summary available in the panel on the right."}
          </p>
        </div>
      );
    }

    if (sourceTab === "text") {
      const snippet = result?.source_input || result?.overview || "Long text preview";
      return (
        <div className="h-full w-full bg-[#0b1429] p-4 text-left text-slate-100 overflow-y-auto">
          <p className="text-xs text-slate-400 mb-2">Text Input Snippet</p>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {snippet.slice(0, 500)}...
          </p>
        </div>
      );
    }

    return (
      <div className="h-full w-full grid place-items-center text-slate-500 text-sm px-4 text-center">
        {`${label} preview not available.`}
      </div>
    );
  }
  
  /* ---------- UI ---------- */

  return (
    <div className="min-h-screen bg-[#0b1429] text-slate-100">
      <div className="px-4 sm:px-6 lg:px-10 py-8 max-w-7xl mx-auto">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center sm:items-end justify-between gap-6">
          
            <div className="flex items-center gap-3">
              {result && (
                <button
                  onClick={goBack}
                  className="h-9 w-9 rounded-lg border border-slate-700 bg-[#0d162b] hover:bg-[#152441] text-slate-300 hover:text-white transition"
                  title="Back"
                >
                  ←
                </button>
              )}

              <Logo onClick={resetSummarizer} />
            </div>

          <div className="text-center sm:text-right">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              AI Summarizer
            </h1>
            <p className="mt-2 text-base text-slate-300 max-w-xl">
              Generate comprehensive and in-depth summaries for videos and articles, complete with Mind Maps and Quizzes.
            </p>
          </div>
        </div>


        {/* top tabs */}
        <div className="mt-8">
          <div className="flex flex-wrap justify-center gap-2 max-w-5xl mx-auto bg-[#101a30] border border-slate-800 rounded-2xl p-2 shadow-[0_15px_40px_rgba(0,0,0,0.25)]">
            {sourceTabs.map((s) => (
              <PillTab
                key={s.key}
                active={sourceTab === s.key}
                label={s.label}
                onClick={() => setSourceTab(s.key)}
              />
            ))}
          </div>

          {/* Source Details */}
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {sourceDetails.map((item) => (
              <div
                key={item.key}
                className={`rounded-xl border ${
                  sourceTab === item.key ? "border-sky-600" : "border-slate-800"
                } bg-[#0f182d] p-3 flex flex-col gap-2`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-50">
                      {item.title}
                    </p>
                    <p className="text-xs text-slate-400">{item.desc}</p>
                  </div>
                  {item.sample ? (
                    <button
                      onClick={() => {
                        setSourceTab(item.key);
                        setUrl(item.sample);
                      }}
                      className="text-[11px] px-2 py-1 rounded-full bg-[#152441] text-sky-200 border border-slate-700 hover:border-slate-600"
                    >
                      Use sample
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-500">Paste text</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {item.sample || "Paste your own text in the box below."}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 max-w-5xl mx-auto bg-[#0f182d] border border-slate-800 rounded-2xl p-6 shadow-[0_20px_40px_rgba(0,0,0,0.35)]">
            
            {/* Input Section */}
            <div className="space-y-4">
              {/* YouTube Input */}
              {sourceTab === "youtube" && (
                <>
                  <label className="text-xs uppercase tracking-wide text-slate-400 flex items-center justify-between">
                    <span>Paste link for YouTube</span>
                    <button
                      onClick={() => setUrl("")}
                      className="text-[11px] text-slate-300 hover:text-white"
                    >
                      Clear
                    </button>
                  </label>
                  <textarea
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="Paste the YouTube video link, for example: https://www.youtube.com/watch?v=example"
                    className={linkInputClass}
                    aria-label="YouTube URL"
                  />
                </>
              )}

              {/* Web Input */}
              {sourceTab === "web" && (
                <>
                  <label className="text-xs uppercase tracking-wide text-slate-400 flex items-center justify-between">
                    <span>Paste link for webpage</span>
                    <button
                      onClick={() => setUrl("")}
                      className="text-[11px] text-slate-300 hover:text-white"
                    >
                      Clear
                    </button>
                  </label>
                  <textarea
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="Paste the article URL to summarize"
                    className={linkInputClass}
                    aria-label="Web URL"
                  />
                </>
              )}

              {/* Text Input */}
              {sourceTab === "text" && (
                <>
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Paste long text
                  </label>
                  <textarea
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="Paste your long text or notes here"
                    className="w-full min-h-[200px] border border-slate-800 bg-[#0b1429] rounded-xl px-4 py-4 text-sm md:text-base text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/60"
                  />
                </>
              )}
            </div>

            {error && (
              <div className="mt-3 text-sm text-red-200 bg-red-950/60 border border-red-800 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              onClick={analyze}
              disabled={loading}
              className="mt-6 w-full h-14 bg-[#2c7cf6] hover:bg-[#1f6de4] disabled:opacity-60 text-base font-semibold text-white rounded-xl shadow-[0_15px_45px_rgba(44,124,246,0.35)] flex items-center justify-center gap-2"
            >
              {loading ? "Generating..." : "Generate Summary"}
            </button>
          </div>
        </div>
        
        {/* results area */}
        <div className="mt-10 max-w-6xl mx-auto grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="bg-[#0f182d] border border-slate-800 rounded-2xl p-4 shadow-lg">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-slate-400">
              <span>Preview</span>
              <span className="px-2 py-1 rounded-full bg-[#101a30] border border-slate-800 text-[10px] text-slate-300">
                Model gpt-4o-mini
              </span>
            </div>
            <div className="mt-3 rounded-xl overflow-hidden border border-slate-800 aspect-video bg-[#0b1429]">
              {renderPreview()}
            </div>

            {hasMatchingResult ? (
              <div className="mt-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-50 line-clamp-2">
                    {result.title}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {result.channel}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                  <button
                    onClick={copySummary}
                    className="text-[11px] px-2.5 py-1 rounded-full bg-[#101a30] text-slate-100 border border-slate-800 hover:bg-[#152441]"
                  >
                    <IconCopy /> <span className="ml-1">Copy overview</span>
                  </button>
                  <button
                    onClick={downloadJSON}
                    className="text-[11px] px-2.5 py-1 rounded-full bg-slate-50 text-slate-900 hover:bg-white flex items-center gap-1"
                  >
                    <IconDownload /> <span>JSON</span>
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">
                Select {sourceNames[sourceTab]} and generate a summary to see a
                preview here.
              </p>
            )}
          </div>

          <div className="xl:col-span-2 bg-[#0f182d] border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col">
            {result ? (
              <>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex gap-2 bg-[#101a30] border border-slate-800 rounded-full p-1">
                    {["summary", "mindmap", "chat"].map((t) => (
                      <button
                        key={t}
                        className={`px-3 py-1.5 text-[11px] rounded-full transition ${
                          tab === t
                            ? "bg-[#152441] text-sky-200 shadow-sm"
                            : "text-slate-400 hover:text-slate-100"
                        }`}
                        onClick={() => setTab(t)}
                      >
                        {t === "summary"
                          ? "Summary"
                          : t === "mindmap"
                          ? "Mind map"
                          : "AI chat"}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 text-[12px]">
                    <button
                      onClick={() => setFlashOpen(true)}
                      className="px-2.5 py-1 rounded-full bg-[#2c7cf6] text-white hover:bg-[#1f6de4]"
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

                <div className="mt-4 overflow-y-auto space-y-4 max-h-[26rem] pr-1">
                  
                  {/* SUMMARY TAB */}
                  {tab === "summary" && (
                    <>
                      {/* Summary Metadata */}
                      <div className="rounded-xl border border-slate-800 bg-[#101a30] p-4">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                          <div>
                            <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-400 mb-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              <span>{result.type ?? sourceLabels[result.source] ?? "Content"}</span>
                            </div>
                            <h2 className="text-base sm:text-lg font-semibold text-slate-50">
                              {result.title}
                            </h2>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              {result.channel}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 text-[11px]">
                            <div className="px-2.5 py-1 rounded-lg bg-[#0d162b] border border-slate-800 text-slate-200">
                              Key points: {" "}
                              <span className="font-semibold">
                                {majorPoints.length}
                              </span>
                            </div>
                            <div className="px-2.5 py-1 rounded-lg bg-[#0d162b] border border-slate-800 text-slate-200">
                              Tags: {" "}
                              <span className="font-semibold">
                                {tags.length}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Core Message / Overview */}
                      <div className="rounded-xl border border-slate-800 bg-[#101a30] p-4">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold">Core Message (Summary)</h3>
                          <button
                            onClick={copySummary}
                            className="text-[11px] px-2.5 py-1 rounded-full bg-[#0d162b] text-slate-200 border border-slate-800 hover:bg-[#152441]"
                          >
                            <IconCopy /> <span className="ml-1">Copy text</span>
                          </button>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-slate-100 whitespace-pre-wrap">
                          {result.overview || "No overview provided."}
                        </p>

                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {tags.length === 0 ? (
                            <span className="text-[11px] text-slate-500 italic">
                              No tags provided.
                            </span>
                          ) : (
                            tags.map((tag, i) => (
                              <span
                                key={i}
                                className="text-[11px] px-2 py-0.5 rounded-full bg-[#0d162b] text-slate-100 border border-slate-800"
                              >
                                {tag}
                              </span>
                            ))
                          )}
                        </div>
                      </div>

                      {/* Detailed Topic Breakdown / Chapters */}
                      <div className="rounded-xl border border-slate-800 bg-[#101a30] p-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold">Detailed Topic Breakdown</h3>
                          <span className="text-[11px] text-slate-400">
                            {chapters.length} items
                          </span>
                        </div>

                        {chapters.length === 0 ? (
                          <p className="mt-2 text-sm text-slate-400 italic">
                            No chapters generated.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-2">
                            {chapters.map((c, i) => {
                              const title = c.title || c.summary || `Chapter ${i + 1}`;
                              const ts = c.timestamp ?? c.start ?? "";
                              return (
                                <li
                                  key={i}
                                  className="flex items-start gap-2 text-sm"
                                >
                                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-500" />
                                  <div className="flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-medium text-slate-50">
                                        {title}
                                      </span>
                                      {sourceTab === 'youtube' && <TimestampBadge
  ts={ts}
  onClick={() => seekToTimestamp(ts)}
/>
}
                                    </div>
                                    {c.summary && (
                                      <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
                                        {c.summary}
                                      </p>
                                    )}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>

                      {/* Key Takeaways / Major Points */}
                      <div className="rounded-xl border border-slate-800 bg-[#101a30] p-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold">
                            Key Takeaways
                          </h3>
                          <span className="text-[11px] text-slate-400">
                            {majorPoints.length} items
                          </span>
                        </div>

                        {majorPoints.length === 0 ? (
                          <p className="mt-2 text-sm text-slate-400 italic">
                            No key takeaways found.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-2">
                            {majorPoints.map((p, i) => {
                              const title =
                                p.title || p.summary || `Point ${i + 1}`;
                              const ts = p.timestamp ?? p.start ?? "";
                              return (
                                <li
                                  key={i}
                                  className="flex items-start gap-2 text-sm"
                                >
                                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-500" />
                                  <div className="flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-medium text-slate-50">
                                        {title}
                                      </span>
                                      {sourceTab === 'youtube' && <TimestampBadge
  ts={ts}
  onClick={() => seekToTimestamp(ts)}
/>}
                                    </div>
                                    {p.summary && (
                                      <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
                                        {p.summary}
                                      </p>
                                    )}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>

                      {/* Key Terms & Concepts / Terminology */}
                      <div className="rounded-xl border border-slate-800 bg-[#101a30] p-4">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold">
                            Key Terms & Concepts
                          </h3>
                          <span className="text-[11px] text-slate-400">
                            {terms.length} items
                          </span>
                        </div>

                        {terms.length === 0 ? (
                          <p className="mt-2 text-sm text-slate-400 italic">
                            No terms extracted.
                          </p>
                        ) : (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {terms.map((t, i) => (
                              <div
                                key={i}
                                className="px-2.5 py-1 rounded-full bg-[#0d162b] text-[12px] text-slate-100 border border-slate-800"
                              >
                                <span className="font-semibold">
                                  {t.term ?? t.name ?? `Term ${i + 1}`}:
                                </span>{" "}
                                {t.definition ?? t.desc ?? ""}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* MINDMAP TAB (Restored) */}
                  {tab === "mindmap" && (
                    <>
                      <div className="rounded-xl border border-slate-800 bg-[#101a30] p-4">
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">Mind map</h3>
                            <div className="flex gap-2">
                              <button className="text-[11px] px-2 py-1 rounded-full bg-[#0d162b] text-slate-200 border border-slate-800 hover:bg-[#152441]">
                                Expand
                              </button>
                              <button className="text-[11px] px-2 py-1 rounded-full bg-[#0d162b] text-slate-200 border border-slate-800 hover:bg-[#152441]">
                                Collapse
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-slate-400">
                            Clean outline of the main topics and subtopics
                            extracted from the content.
                          </p>
                        </div>
                      </div>

                      {normalizedMindmap.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-800 bg-[#0d162b] p-4 text-sm text-slate-400 italic">
                          No mindmap was generated for this content.
                        </div>
                      ) : (
                        <div className="rounded-xl border border-slate-800 bg-[#101a30] p-4">
                          <div className="space-y-4">
                            {normalizedMindmap.map((node, i) => (
                              <MindmapNode key={i} node={node} />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* CHAT TAB (Restored) */}
                  {tab === "chat" && (
                    <div className="flex flex-col h-full">
                      {/* Messages */}
                      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
                        {chatHistory.length === 0 && !isTyping ? (
                          <div className="text-sm text-slate-400 italic text-center mt-8">
                            Ask follow-up questions about this content.
                          </div>
                        ) : (
                          chatHistory.map((m, i) => (
                            <div
                              key={i}
                              className={`flex gap-3 ${
                                m.role === "user" ? "justify-end" : "justify-start"
                              }`}
                            >
                              {/* Avatar */}
                              {m.role === "assistant" && (
                                <div className="h-8 w-8 rounded-full bg-sky-600/20 text-sky-400 grid place-items-center text-sm font-bold">
                                  AI
                                </div>
                              )}

                              {/* Bubble */}
                              <div
                                className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                                  m.role === "user"
                                    ? "bg-[#2c7cf6] text-white rounded-br-md"
                                    : "bg-[#101a30] text-slate-100 border border-slate-800 rounded-bl-md"
                                }`}
                              >
                                {m.content}
                              </div>

                              {m.role === "user" && (
                                <div className="h-8 w-8 rounded-full bg-slate-700 text-slate-200 grid place-items-center text-xs font-bold">
                                  You
                                </div>
                              )}
                            </div>
                          ))
                        )}

                        {/* Typing indicator */}
                        {isTyping && (
                          <div className="flex gap-3 items-center">
                            <div className="h-8 w-8 rounded-full bg-sky-600/20 text-sky-400 grid place-items-center text-sm font-bold">
                              AI
                            </div>
                            <div className="px-4 py-2 rounded-2xl bg-[#101a30] border border-slate-800 text-slate-400 text-sm italic">
                              AI is typing…
                            </div>
                          </div>
                        )}

                        <div ref={chatEndRef} />
                      </div>

                      {/* Input */}
                      <div className="mt-3 flex gap-2 border-t border-slate-800 pt-3">
                        <textarea
                          ref={chatRef}
                          placeholder="Ask about the content…"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              sendChat();
                            }
                          }}
                          className="
                            flex-1
                            h-12
                            max-h-32
                            overflow-y-auto
                            resize-none
                            px-4
                            py-3
                            text-sm
                            rounded-xl
                            border
                            border-slate-800
                            bg-[#0d162b]
                            text-slate-100
                            placeholder:text-slate-500
                            focus:outline-none
                            focus:ring-2
                            focus:ring-sky-500/60
                            scrollbar-thin
                            scrollbar-thumb-slate-700
                            scrollbar-track-transparent
                          "
                        />


                        <button
                          onClick={sendChat}
                          disabled={isTyping}
                          className="px-4 py-2 rounded-xl bg-[#2c7cf6] text-white text-sm font-medium hover:bg-[#1f6de4] disabled:opacity-50"
                        >
                          Send
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              </>
            ) : (
              <div className="flex-1 min-h-[22rem] bg-[#0d162b] border border-dashed border-slate-800 rounded-xl grid place-items-center text-center px-8">
                <div>
                  <p className="text-lg font-semibold text-slate-100">
                    Ready when you are
                  </p>
                  <p className="text-sm text-slate-400 mt-1">
                    Paste a link above and click Generate Summary to view the
                    full features here.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Flashcards modal (Interactive) */}
      <Modal
        title="Flashcards"
        open={flashOpen}
        onClose={() => setFlashOpen(false)}
      >
        <FlashcardCarousel cards={safeArray(result?.flashcards)} />
      </Modal>

      {/* Quiz modal (Interactive) */}
      <Modal
        title="Quiz (MCQs)"
        open={quizOpen}
        onClose={() => setQuizOpen(false)}
      >
        <QuizInteractive questions={safeArray(result?.quiz)} />
      </Modal>
    </div>
  );
}