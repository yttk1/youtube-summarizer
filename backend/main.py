import os
import re
import json
import asyncio
import traceback
from typing import List, Any, Dict, Optional

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import httpx
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
    CouldNotRetrieveTranscript,
)
from dotenv import load_dotenv
from pathlib import Path

# --- Configuration ---
ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

try:
    import yt_dlp
except ImportError:
    yt_dlp = None

OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
MODEL = "gpt-4o-mini"
MAX_OUTPUT_TOKENS = 10000

# --- FastAPI app ---
app = FastAPI(title="YouTube & Article Summarizer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Request models (Retained ChatRequest) ---
class AnalyzeRequest(BaseModel):
    url: Optional[str] = None
    text: Optional[str] = None
    source: Optional[str] = None

class ChatRequest(BaseModel):
    context: Dict[str, Any] = {}
    history: List[Dict[str, str]]


# --- Utility: extract video id (Keep) ---
def extract_video_id(url: str) -> str:
    # typical youtube url patterns
    m = re.search(r"v=([A-Za-z0-9_-]{11})", url)
    if m:
        return m.group(1)
    m2 = re.search(r"youtu\.be/([A-Za-z0-9_-]{11})", url)
    if m2:
        return m2.group(1)
    # fallback: maybe user passed id directly
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", url):
        return url
    raise ValueError("Could not extract YouTube video id from URL.")


# --- Non-blocking transcript fetch (Keep all helpers) ---
def _parse_json3_captions(body: str) -> List[dict]:
    try:
        data = json.loads(body)
    except Exception:
        return []

    events = data.get("events", [])
    out = []
    for ev in events:
        segs = ev.get("segs") or []
        text = "".join(seg.get("utf8", "") for seg in segs).strip()
        if not text:
            continue
        start = float(ev.get("tStartMs", 0)) / 1000.0
        dur = float(ev.get("dDurationMs", 0)) / 1000.0
        out.append({"text": text, "start": start, "duration": dur})
    return out


def _parse_vtt_captions(body: str) -> List[dict]:
    def to_seconds(t: str) -> float:
        parts = t.split(":")
        if len(parts) == 2:
            mins, rest = parts
            hrs = 0
        else:
            hrs, mins, rest = parts
        return float(hrs) * 3600 + float(mins) * 60 + float(rest.replace(",", "."))

    entries = []
    blocks = re.split(r"\r?\n\r?\n", body.strip())
    for block in blocks:
        lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        if len(lines) < 2:
            continue

        times_line = lines[0]
        m = re.search(r"(?P<start>[0-9:.]+)\s+-->\s+(?P<end>[0-9:.]+)", times_line)
        if not m:
            continue
        start_s = to_seconds(m.group("start"))
        end_s = to_seconds(m.group("end"))
        text = " ".join(lines[1:]).strip()
        if not text:
            continue
        entries.append({"text": text, "start": start_s, "duration": max(end_s - start_s, 0.0)})
    return entries


def format_timestamp(seconds: float) -> str:
    """Return hh:mm:ss or mm:ss for a numeric timestamp."""
    try:
        total = int(seconds)
    except Exception:
        return ""
    hrs, rem = divmod(total, 3600)
    mins, secs = divmod(rem, 60)
    if hrs:
        return f"{hrs:02d}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"


def detect_language_hint(text: str) -> str:
    """Detect language hint for Vietnamese."""
    if not text:
        return "english"
    sample = text[:400].lower()
    if re.search(r"[ăâêôơưđáàạảãắằặẳẵấầậẩẫéèẹẻẽóòọỏõốồộổỗớờợởỡúùụủũứừựửữíìịỉĩýỳỵỷỹ]", sample):
        return "vietnamese"
    return "english"


def fetch_transcript_via_yt_dlp(video_id: str, languages: List[str] | None = None) -> List[dict]:
    """Fallback transcript fetch."""
    if yt_dlp is None:
        raise NoTranscriptFound("yt-dlp is not installed in the environment.")

    lang_candidates = languages or ["vi", "en"]
    lang_candidates = list(dict.fromkeys(lang_candidates + [l.split("-")[0] for l in lang_candidates if "-" in l]))
    url = f"https://www.youtube.com/watch?v={video_id}"
    ydl_opts = {"quiet": True, "skip_download": True, "writesubtitles": True, "writeautomaticsub": True}

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

    subtitles = info.get("subtitles") or {}
    auto_subtitles = info.get("automatic_captions") or {}

    def pick_track(caption_dict: Dict[str, Any]) -> Optional[dict]:
        if not caption_dict:
            return None
        for lang in lang_candidates + list(caption_dict.keys()):
            tracks = caption_dict.get(lang)
            if not tracks:
                continue
            ext_priority = {"json3": 0, "srv3": 1, "vtt": 2}
            sorted_tracks = sorted(tracks, key=lambda t: ext_priority.get(t.get("ext"), 99))
            return sorted_tracks[0]
        return None

    track = pick_track(subtitles) or pick_track(auto_subtitles)
    if not track:
        raise NoTranscriptFound(f"No captions available via yt-dlp for video {video_id}")

    caption_url = track.get("url")
    if not caption_url:
        raise NoTranscriptFound(f"yt-dlp provided an empty caption URL for video {video_id}")

    resp = httpx.get(caption_url, timeout=20.0)
    resp.raise_for_status()

    ext = (track.get("ext") or "").lower()
    if ext in ("json3", "srv3"):
        parsed = _parse_json3_captions(resp.text)
    elif ext == "vtt":
        parsed = _parse_vtt_captions(resp.text)
    else:
        parsed = []

    if not parsed:
        raise NoTranscriptFound(f"Could not parse captions from yt-dlp track ({ext}) for video {video_id}")

    return parsed


def fetch_transcript_sync(video_id: str, languages: List[str] | None = None):
    """Try multiple transcript strategies."""
    api = YouTubeTranscriptApi()
    preferred = languages or ["vi", "en", "en-US", "en-GB"]

    def _list_available_transcripts():
        if hasattr(api, "list_transcripts"):
            return api.list_transcripts(video_id)
        if hasattr(api, "list"):
            return api.list(video_id)
        raise RuntimeError("Incompatible youtube-transcript-api version (missing list/list_transcripts)")

    try:
        transcripts = _list_available_transcripts()
    except NoTranscriptFound as e:
        raise e

    transcript_obj = None
    try:
        transcript_obj = transcripts.find_transcript(preferred)
    except NoTranscriptFound:
        try:
            transcript_obj = transcripts.find_generated_transcript(preferred)
        except NoTranscriptFound:
            transcript_obj = None

    if not transcript_obj:
        try:
            transcript_obj = next(iter(transcripts))
        except StopIteration as e:
            raise NoTranscriptFound(f"No transcripts available for video {video_id}") from e

    lang_code = (transcript_obj.language_code or "").lower()
    should_translate_to_en = (
        "en" in preferred
        and not lang_code.startswith("en")
        and not lang_code.startswith("vi")
        and getattr(transcript_obj, "is_translatable", False)
    )

    if should_translate_to_en:
        try:
            transcript_obj = transcript_obj.translate("en")
        except Exception:
            pass

    raw = transcript_obj.fetch()
    if hasattr(raw, "to_raw_data"):
        raw = raw.to_raw_data()

    entries = []
    for item in raw:
        if isinstance(item, dict):
            text = item.get("text", "")
            start = float(item.get("start", 0))
            dur = float(item.get("duration", 0))
        else:
            text = getattr(item, "text", "")
            start = float(getattr(item, "start", 0))
            dur = float(getattr(item, "duration", 0))
        if not text:
            continue
        entries.append({"text": text, "start": start, "duration": dur})

    if not entries:
        raise NoTranscriptFound(f"Empty transcript for video {video_id}")

    return entries

async def fetch_transcript(video_id: str, languages: List[str] | None = None):
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(None, lambda: fetch_transcript_sync(video_id, languages))
    except TranscriptsDisabled as e:
        try:
            return await loop.run_in_executor(None, lambda: fetch_transcript_via_yt_dlp(video_id, languages))
        except Exception as yt_e:
            raise RuntimeError(f"TranscriptsDisabled; yt_dlp_fallback: {yt_e}") from yt_e
    except NoTranscriptFound as e:
        try:
            return await loop.run_in_executor(None, lambda: fetch_transcript_via_yt_dlp(video_id, languages))
        except Exception as yt_e:
            raise RuntimeError(f"NoTranscriptFound: {e}; yt_dlp_fallback: {yt_e}") from yt_e
    except VideoUnavailable as e:
        raise RuntimeError("VideoUnavailable") from e
    except CouldNotRetrieveTranscript as e:
        raise RuntimeError(f"CouldNotRetrieveTranscript: {e}") from e
    except Exception as e:
        raise RuntimeError(f"TranscriptFetchFailed: {e}") from e


# --- Metadata via YouTube oEmbed (Keep) ---
async def fetch_video_metadata(video_id: str) -> Dict[str, Any]:
    url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"

    async with httpx.AsyncClient() as client:
        r = await client.get(url)
        if r.status_code != 200:
            raise RuntimeError(f"MetadataFetchFailed: {r.text}")

    data = r.json()
    return {
        "title": data.get("title"),
        "channel": data.get("author_name"),
        "duration": None
    }


# --- Generic helpers (Keep) ---
def normalize_terms_and_points(payload: dict) -> dict:
    terms = payload.get("terminologies")

    if isinstance(terms, dict):
        payload["terminologies"] = [terms]
    elif terms is None:
        payload["terminologies"] = []
    elif isinstance(terms, str):
        payload["terminologies"] = [{"term": "", "definition": terms}]
    elif not isinstance(terms, list):
        payload["terminologies"] = []

    mp = payload.get("major_points")
    if isinstance(mp, dict):
        payload["major_points"] = [mp]
    elif mp is None:
        payload["major_points"] = []
    elif isinstance(mp, str):
        payload["major_points"] = [{"timestamp": "", "title": "", "summary": mp}]
    elif not isinstance(mp, list):
        payload["major_points"] = []

    chapters = payload.get("chapters")
    if isinstance(chapters, dict):
        payload["chapters"] = [chapters]
    elif chapters is None:
        payload["chapters"] = []
    elif isinstance(chapters, str):
        payload["chapters"] = [{"timestamp": "", "title": "", "summary": chapters}]
    elif not isinstance(chapters, list):
        payload["chapters"] = []
        
    # Also normalize mindmap, flashcards, quiz data just in case model returns non-array types
    def safe_normalize_list(key, default_item=None):
        val = payload.get(key)
        if isinstance(val, dict):
            payload[key] = [val]
        elif isinstance(val, str) and default_item:
             payload[key] = [{**default_item, 'summary': val}]
        elif not isinstance(val, list):
            payload[key] = []
    
    safe_normalize_list('mindmap')
    safe_normalize_list('flashcards', default_item={'q': '', 'a': ''})
    safe_normalize_list('quiz', default_item={'q': '', 'choices': [], 'answer': ''})

    # Ensure quiz items are consistent and always have 4 choices.
    quiz = payload.get("quiz")
    if isinstance(quiz, list):
        normalized_quiz = []
        for item in quiz:
            if not isinstance(item, dict):
                continue

            q_text = item.get("q") or item.get("question") or ""
            answer = item.get("answer") or item.get("a") or item.get("correct") or item.get("correct_answer") or ""
            raw_choices = item.get("choices") or item.get("options") or item.get("answers") or []

            if isinstance(raw_choices, str):
                raw_choices = [c.strip() for c in re.split(r"[\r\n]+|[|;/]", raw_choices) if c.strip()]
            elif not isinstance(raw_choices, list):
                raw_choices = []

            cleaned = []
            for c in raw_choices:
                if c is None:
                    continue
                s = str(c).strip()
                if s and s not in cleaned:
                    cleaned.append(s)

            ans = str(answer).strip() if answer is not None else ""
            if ans and ans not in cleaned:
                cleaned.append(ans)

            # Keep exactly 4 choices, making sure the answer is included.
            if len(cleaned) > 4:
                if ans and ans in cleaned[:4]:
                    cleaned = cleaned[:4]
                elif ans:
                    cleaned = cleaned[:3] + [ans]
                else:
                    cleaned = cleaned[:4]

            if len(cleaned) < 4:
                fillers = ["None of the above", "All of the above", "Not enough information", "Cannot be determined"]
                for f in fillers:
                    if len(cleaned) >= 4:
                        break
                    if f not in cleaned and f != ans:
                        cleaned.append(f)
                while len(cleaned) < 4:
                    cleaned.append(f"Option {len(cleaned) + 1}")

            if q_text.strip() and ans:
                normalized_quiz.append({"q": q_text.strip(), "choices": cleaned[:4], "answer": ans})

        payload["quiz"] = normalized_quiz

    return payload


def clean_html_to_text(html: str) -> str:
    no_script = re.sub(r"(?is)<script.*?>.*?</script>", " ", html)
    no_style = re.sub(r"(?is)<style.*?>.*?</style>", " ", no_script)
    text_only = re.sub(r"(?s)<[^>]+>", " ", no_style)
    text_only = re.sub(r"\s+", " ", text_only)
    return text_only.strip()


async def fetch_webpage_text(url: str) -> str:
    async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
    return clean_html_to_text(resp.text)


async def summarize_text_block(text: str, source_label: str = "text", title_hint: Optional[str] = None) -> dict:
    trimmed = (text or "").strip()
    if not trimmed:
        raise ValueError("No text provided for summarization.")

    if len(trimmed) > 20000:
        trimmed = trimmed[:20000]
    
    # Restored features (mindmap, flashcards, quiz) to schema
    system_prompt = (
        "You are an assistant that returns JSON ONLY (no markdown). "
        "Schema keys must include: title, overview, tags, chapters, major_points, terminologies, mindmap, flashcards, quiz. "
        "Mindmap must be pure JSON (no prose), rooted in a central theme with 4-6 branches, each branch having a summary and 3-4 children using the {title, summary, children} format. "
        "Flashcards must be 6-12 items. Quiz must be 5-10 MCQs with 4 choices each. "
        ""
        "Core Content requirements (MUST BE FOLLOWED STRICTLY): "
        "- title: MUST be a new, concise, and engaging title (Summary Title). "
        "- overview: MUST be 2-3 dense paragraphs summarizing the core message, key findings, or primary conclusion (Core Message). "
        "- major_points: MUST contain 3-5 high-impact, actionable insights derived from the text (Key Takeaways). "
        "- chapters: MUST contain 5-8 major sections, using section titles/markers (instead of timestamps) in the 'timestamp' field. Each has a short title and 1-2 sentence summary with concrete facts (Detailed Topic Breakdown). "
        "- terminologies: MUST contain 3-7 important vocabulary/concepts with concise definitions (Key Terms & Concepts). "
        "- tags: MUST contain 6-12 short tags (no hashtags), derived from the text. "
        "Keep the output language consistent with the source text. Return strictly JSON."
    )

    user_payload = (
        f"SOURCE_TYPE: {source_label}\n"
        f"TITLE_HINT: {title_hint or ''}\n"
        f"CONTENT:\n{trimmed}\n\n"
        "TASK:\n"
        "- Produce detailed JSON strictly following the defined schema and content requirements.\n"
        "- Return strictly JSON with no extra text."
    )

    resp = await call_openai(
        [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_payload}],
        temperature=0.2,
        max_tokens=MAX_OUTPUT_TOKENS,
    )

    model_text = extract_text_from_responses_api(resp)

    parsed = None
    try:
        parsed = json.loads(model_text)
    except Exception:
        m = re.search(r"\{[\s\S]*\}\s*$", model_text)
        if m:
            candidate = m.group(0)
            try:
                parsed = json.loads(candidate)
            except Exception:
                parsed = None

    if not isinstance(parsed, dict):
        parsed = {"overview": model_text}

    parsed.setdefault("title", title_hint or "Text summary")
    parsed.setdefault("channel", "Custom input")
    parsed.setdefault("type", parsed.get("type", source_label))
    parsed.setdefault("tags", parsed.get("tags", []))
    parsed.setdefault("major_points", parsed.get("major_points", []))
    parsed.setdefault("chapters", parsed.get("chapters", []))
    parsed.setdefault("terminologies", parsed.get("terminologies", []))
    parsed.setdefault("mindmap", parsed.get("mindmap", []))
    parsed.setdefault("flashcards", parsed.get("flashcards", []))
    parsed.setdefault("quiz", parsed.get("quiz", []))
    parsed.setdefault("source", source_label)

    normalize_terms_and_points(parsed)
    return parsed


# --- OpenAI Responses API helper (Keep) ---
async def call_openai(messages: list, temperature: float = 0.1, max_tokens: int = MAX_OUTPUT_TOKENS) -> dict:
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set in environment")
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": MODEL,
        "input": messages,
        "temperature": temperature,
        "max_output_tokens": max_tokens,
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.post(OPENAI_RESPONSES_URL, json=payload, headers=headers)
        try:
            r.raise_for_status()
        except httpx.HTTPStatusError:
            raise RuntimeError(f"OpenAI API error: {r.status_code} {r.text}")
        return r.json()

def extract_text_from_responses_api(resp_json: dict) -> str:
    if not isinstance(resp_json, dict):
        return str(resp_json)
    out = ""
    for item in resp_json.get("output", []):
        if isinstance(item, dict) and item.get("type") == "message":
            for c in item.get("content", []):
                if c.get("type") == "output_text":
                    out += c.get("text", "")
    if out:
        return out
    if "output_text" in resp_json:
        return resp_json["output_text"]
    return json.dumps(resp_json)

# --- /api/analyze endpoint (Finalized Source Handling) ---
@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest):
    source = (req.source or "youtube").lower()

    if source in ("text", "long_text", "raw_text", "web"):
        if source == "web":
            if not req.url:
                return JSONResponse(status_code=400, content={"error": "missing_url", "detail": "URL is required for webpage summarization."})
            try:
                page_text = await fetch_webpage_text(req.url)
            except Exception as e:
                return JSONResponse(status_code=500, content={"error": "web_fetch_failed", "detail": str(e)})

            if not page_text:
                return JSONResponse(status_code=400, content={"error": "empty_page", "detail": "Could not extract readable text from the page."})

            try:
                parsed = await summarize_text_block(page_text, source_label="web", title_hint=req.url)
            except Exception as e:
                return JSONResponse(status_code=500, content={"error": "web_summarize_failed", "detail": str(e)})

            parsed.setdefault("source", "web")
            parsed.setdefault("source_url", req.url)
            parsed.setdefault("source_input", req.url)
            return parsed
        
        else: # source is text
            text_input = req.text or req.url
            if not text_input:
                return JSONResponse(status_code=400, content={"error": "missing_text", "detail": "Text content is required for long text mode."})
            try:
                parsed = await summarize_text_block(text_input, source_label="text")
            except Exception as e:
                return JSONResponse(status_code=500, content={"error": "text_summarize_failed", "detail": str(e)})
            parsed.setdefault("source", "text")
            parsed.setdefault("source_input", text_input)
            return parsed

    # --- YouTube Summarization Logic ---
    if source == "youtube":
        if not req.url:
            return JSONResponse(status_code=400, content={"error": "missing_url", "detail": "YouTube URL is required for this mode."})

        try:
            vid = extract_video_id(req.url)
        except Exception as e:
            return JSONResponse(status_code=400, content={"error": "invalid_url", "detail": str(e)})

        try:
            meta = await fetch_video_metadata(vid)
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": "metadata_fetch_failed", "detail": str(e)})

        try:
            transcript_entries = await fetch_transcript(vid, languages=["vi", "en", "en-US", "en-GB"])
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": "transcript_error", "detail": str(e)})

        full_text = "\n".join([f"[{format_timestamp(e.get('start', 0))}]{e.get('text','')}" for e in transcript_entries])
        snippet = full_text[:20000]
        language_hint = detect_language_hint(full_text)

        # System Prompt for YouTube: Enforcing all features
        system_prompt = (
            "You are a careful YouTube transcript analyzer. Return JSON ONLY (no markdown, no extra text). "
            "Output must be a single valid JSON object that strictly follows this schema keys: "
            "type, title, channel, overview, tags, chapters, major_points, terminologies, mindmap, flashcards, quiz. "
            "Mindmap must be pure JSON, rooted in a central theme with 4-6 branches, each branch having a summary and 3-4 children using the {title, summary, children} format. "
            "Flashcards must be 6-12 items. Quiz must be 5-10 MCQs with 4 choices each. "
            ""
            "Core Content requirements (MUST BE FOLLOWED STRICTLY): "
            "- title: MUST be a new, concise, and engaging title (Summary Title). "
            "- overview: MUST be 2-3 robust paragraphs (Core Message). "
            "- major_points: MUST contain 3-5 high-impact, actionable insights (Key Takeaways). "
            "- chapters: MUST contain 8-14 items, chronological, each with a required timestamp, sharp title, and a 1-2 sentence factual summary (Detailed Topic Breakdown). **The summary text for each chapter MUST explicitly begin with a reference to its timestamp.** "
            "- terminologies: MUST contain 3-7 important vocabulary or core concepts with concise definitions (Key Terms & Concepts). "
            "- tags: MUST contain 6-12 short tags (no hashtags), derived from transcript terms. "
            "Return strictly JSON."
        )


        user_payload = (
            f"LANGUAGE_HINT: {language_hint}\n"
            f"METADATA:\ntitle: {meta.get('title')}\nchannel: {meta.get('channel')}\n\n"
            f"TRANSCRIPT_SNIPPET:\n{snippet}\n\n"
            "TASK:\n"
            "- Classify the video type: educational, song, or other (store in `type`).\n"
            "- Apply the strict constraints from the SYSTEM PROMPT.\n"
            "- Respond entirely in Vietnamese when LANGUAGE_HINT is Vietnamese; otherwise respond in English.\n"
            "- Return strictly JSON."
        )

        try:
            resp = await call_openai(
                [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_payload}],
                temperature=0.15,
                max_tokens=MAX_OUTPUT_TOKENS,
            )
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": "openai_call_failed", "detail": str(e)})

        model_text = extract_text_from_responses_api(resp)

        parsed = None
        try:
            parsed = json.loads(model_text)
        except Exception:
            m = re.search(r"\{[\s\S]*\}\s*$", model_text)
            if m:
                candidate = m.group(0)
                try:
                    parsed = json.loads(candidate)
                except Exception as e:
                    return JSONResponse(status_code=500, content={"error": "model_json_parse_failed", "detail": str(e), "model_text": model_text[:4000]})
            else:
                return JSONResponse(status_code=500, content={"error": "no_json_in_model_response", "model_text": model_text[:4000]})

        parsed.setdefault("title", meta.get("title"))
        parsed.setdefault("channel", meta.get("channel"))
        parsed.setdefault("overview", parsed.get("overview", ""))
        parsed.setdefault("type", parsed.get("type", "other"))
        parsed.setdefault("tags", parsed.get("tags", []))
        parsed.setdefault("major_points", parsed.get("major_points", []))
        parsed.setdefault("chapters", parsed.get("chapters", []))
        parsed.setdefault("terminologies", parsed.get("terminologies", []))
        parsed.setdefault("mindmap", parsed.get("mindmap", []))
        parsed.setdefault("flashcards", parsed.get("flashcards", []))
        parsed.setdefault("quiz", parsed.get("quiz", []))
        
        parsed.setdefault("source", "youtube")
        parsed.setdefault("video_id", vid)
        parsed.setdefault("source_input", req.url)

        normalize_terms_and_points(parsed)

        return parsed
    
    # Catch any unsupported sources (file uploads)
    return JSONResponse(
        status_code=400,
        content={"error": "unsupported_source", "detail": f"Processing for {source} is not supported. Only youtube, web, and text modes are available."},
    )

# --- /api/chat endpoint (Restored) ---
@app.post("/api/chat")
async def chat(req: ChatRequest):
    context = req.context or {}

    context_text = (
        f"Title: {context.get('title', '')}\n"
        f"Overview: {context.get('overview', '')}\n\n"
        "Key Topics:\n"
    )

    for c in context.get("chapters", [])[:10]:
        context_text += (
            f"- [{c.get('timestamp','')}] "
            f"{c.get('title','')} — {c.get('summary','')}\n"
        )

    messages = [
        {
            "role": "system",
            "content": (
                "You are a helpful assistant. "
                "Answer ONLY using the provided context. "
                "Use timestamps when relevant."
            ),
        },
        {"role": "system", "content": context_text},
    ]

    for h in req.history:
        messages.append(
            {"role": h.get("role"), "content": h.get("content")}
        )

    try:
        resp = await call_openai(
            messages,
            temperature=0.2,
            max_tokens=800,
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": "openai_chat_failed", "detail": str(e)},
        )

    answer = extract_text_from_responses_api(resp)
    return {"answer": answer}
