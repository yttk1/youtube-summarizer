# backend/main.py
import os
import re
import json
import asyncio
import traceback
from typing import List, Any, Dict

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
import yt_dlp

# -------------------------
# Configuration
# -------------------------
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
MODEL = "gpt-4o-mini"

# -------------------------
# FastAPI app
# -------------------------
app = FastAPI(title="YouTube Summarizer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------------------------
# Request models
# -------------------------
class AnalyzeRequest(BaseModel):
    url: str

class ChatRequest(BaseModel):
    url: str
    history: List[Dict[str, str]]

# -------------------------
# Utility: extract video id
# -------------------------
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

# -------------------------
# Non-blocking transcript fetch
# -------------------------
def fetch_transcript_sync(video_id: str, languages: List[str] | None = None):
    api = YouTubeTranscriptApi()
    if languages:
        fetched = api.fetch(video_id, languages=languages)
    else:
        fetched = api.fetch(video_id)
    raw = fetched.to_raw_data()
    return [{"text": item["text"], "start": float(item["start"]), "duration": float(item["duration"])} for item in raw]

async def fetch_transcript(video_id: str, languages: List[str] | None = None):
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(None, lambda: fetch_transcript_sync(video_id, languages))
    except TranscriptsDisabled as e:
        raise RuntimeError("TranscriptsDisabled") from e
    except NoTranscriptFound as e:
        raise RuntimeError("NoTranscriptFound") from e
    except VideoUnavailable as e:
        raise RuntimeError("VideoUnavailable") from e
    except CouldNotRetrieveTranscript as e:
        raise RuntimeError(f"CouldNotRetrieveTranscript: {e}") from e
    except Exception as e:
        raise RuntimeError(f"TranscriptFetchFailed: {e}") from e

# -------------------------
# Non-blocking metadata fetch via yt-dlp
# -------------------------
def fetch_video_metadata_sync(video_id: str) -> Dict[str, Any]:
    ydl_opts = {"quiet": True, "skip_download": True}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(video_id, download=False)
    return {"title": info.get("title"), "channel": info.get("uploader"), "duration": info.get("duration", 0)}

async def fetch_video_metadata(video_id: str) -> Dict[str, Any]:
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(None, lambda: fetch_video_metadata_sync(video_id))
    except Exception as e:
        raise RuntimeError(f"MetadataFetchFailed: {e}") from e

# -------------------------
# OpenAI Responses API helper (async)
# -------------------------
async def call_openai(messages: list, temperature: float = 0.1, max_tokens: int = 1500) -> dict:
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
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(OPENAI_RESPONSES_URL, json=payload, headers=headers)
        try:
            r.raise_for_status()
        except httpx.HTTPStatusError:
            # include response text for debugging
            raise RuntimeError(f"OpenAI API error: {r.status_code} {r.text}")
        return r.json()

# Extract text from Responses API robustly
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

# -------------------------
# /api/analyze endpoint
# -------------------------
@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest):
    # validate URL / extract id
    try:
        vid = extract_video_id(req.url)
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": "invalid_url", "detail": str(e)})

    # metadata
    try:
        meta = await fetch_video_metadata(vid)
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "metadata_fetch_failed", "detail": str(e)})

    # transcript
    try:
        transcript_entries = await fetch_transcript(vid, languages=["en"])
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "transcript_error", "detail": str(e)})

    # Build a compact transcript snippet
    full_text = "\n".join([f"[{int(e['start'])}]{e['text']}" for e in transcript_entries])
    snippet = full_text[:3800]

    system_prompt = (
        "You are an assistant that returns JSON only. Top-level keys: type (educational|song|other), "
        "title, channel, overview, major_points (list of {timestamp,title,summary}), terminologies (if educational), "
        "lyrics (if song), song_analysis (if song), flashcards (if educational), quiz (if educational)."
    )

    user_payload = (
        f"METADATA:\ntitle: {meta.get('title')}\nchannel: {meta.get('channel')}\n\n"
        f"TRANSCRIPT_SNIPPET:\n{snippet}\n\n"
        "TASK:\n1) Classify as 'educational','song', or 'other'.\n"
        "2) If educational: extract major points with timestamps, terminologies (term + 1-sentence), "
        "6 flashcards, 5 multiple-choice Qs, and a simple mindmap JSON.\n"
        "3) If song: title, probable artist, fetch lyrics if available, and brief analysis.\n"
        "4) If other: provide time-stamped major events and summary.\n"
        "Return parsable JSON only."
    )

    try:
        resp = await call_openai(
            [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_payload}],
            temperature=0.1,
            max_tokens=1500,
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "openai_call_failed", "detail": str(e)})

    model_text = extract_text_from_responses_api(resp)

    # Try to parse JSON from model_text
    parsed = None
    try:
        parsed = json.loads(model_text)
    except Exception:
        # attempt to extract last JSON object in the text
        m = re.search(r"\{[\s\S]*\}\s*$", model_text)
        if m:
            candidate = m.group(0)
            try:
                parsed = json.loads(candidate)
            except Exception as e:
                return JSONResponse(status_code=500, content={"error": "model_json_parse_failed", "detail": str(e), "model_text": model_text[:4000]})
        else:
            return JSONResponse(status_code=500, content={"error": "no_json_in_model_response", "model_text": model_text[:4000]})

    # enrich defaults
    parsed.setdefault("title", meta.get("title"))
    parsed.setdefault("channel", meta.get("channel"))
    parsed.setdefault("overview", parsed.get("overview", ""))
    parsed.setdefault("type", parsed.get("type", "other"))
    parsed.setdefault("major_points", parsed.get("major_points", []))
    parsed.setdefault("terminologies", parsed.get("terminologies", []))

    terms = parsed.get("terminologies")

    if isinstance(terms, dict):
        # Model returned a single terminology object
        parsed["terminologies"] = [terms]

    elif terms is None:
        # Model returned nothing
        parsed["terminologies"] = []

    elif isinstance(terms, str):
        # Model returned plain text instead of structured list
        parsed["terminologies"] = [
            {"term": "", "definition": terms}
        ]

    elif not isinstance(terms, list):
        # Unexpected shape (number? bool? etc.)
        parsed["terminologies"] = []

    mp = parsed.get("major_points")

    if isinstance(mp, dict):
        parsed["major_points"] = [mp]
    elif mp is None:
        parsed["major_points"] = []
    elif isinstance(mp, str):
        parsed["major_points"] = [{"timestamp": "", "title": "", "summary": mp}]
    elif not isinstance(mp, list):
        parsed["major_points"] = []


    return parsed

# -------------------------
# /api/chat endpoint
# -------------------------
@app.post("/api/chat")
async def chat(req: ChatRequest):
    # reuse the analyze flow to get context
    try:
        analysis = await analyze(AnalyzeRequest(url=req.url))
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "analysis_failed", "detail": str(e)})

    if isinstance(analysis, JSONResponse):
        return analysis

    context_text = f"Video title: {analysis.get('title')}\nChannel: {analysis.get('channel')}\nOverview: {analysis.get('overview')}\n\nMajor points:\n"
    for p in analysis.get("major_points", [])[:10]:
        context_text += f"- {p.get('timestamp','?')} {p.get('title','')} — {p.get('summary','')}\n"

    messages = [
        {"role": "system", "content": "Answer follow-up questions about the provided video. Use timestamps when relevant."},
        {"role": "system", "content": context_text},
    ]
    for h in req.history:
        messages.append({"role": h.get("role"), "content": h.get("content")})

    try:
        resp = await call_openai(messages, temperature=0.2, max_tokens=800)
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "openai_chat_failed", "detail": str(e)})

    answer_text = extract_text_from_responses_api(resp)
    return {"answer": answer_text}
