import json
import os
import urllib.error
import urllib.request
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory


BASE_DIR = Path(__file__).resolve().parent
DIST_DIR = BASE_DIR / "dist"

app = Flask(__name__, static_folder=str(DIST_DIR), static_url_path="")


def _build_openai_payload(messages: list[dict], chart_report: str) -> dict:
    cleaned_messages: list[dict] = []
    for item in messages[-12:]:
        role = item.get("role") if isinstance(item, dict) else None
        content = item.get("content") if isinstance(item, dict) else None
        if role in ("user", "assistant") and isinstance(content, str):
            cleaned_messages.append({"role": role, "content": content.strip()})

    return {
        "model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        "temperature": 0.7,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Ban la chuyen gia chiem tinh Tay phuong. Tra loi bang tieng Viet co dau, "
                    "ro rang, trung lap, co canh bao ve gioi han cua chiem tinh. "
                    "Khong khang dinh tuyet doi ve suc khoe, tai chinh, phap ly."
                ),
            },
            {"role": "system", "content": f"Du lieu ban do sao hien tai:\n{chart_report}"},
            *cleaned_messages,
        ],
    }


@app.post("/api/ai-chat")
def ai_chat():
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return jsonify({"error": "Missing OPENAI_API_KEY on server"}), 500

    body = request.get_json(silent=True) or {}
    messages = body.get("messages") if isinstance(body.get("messages"), list) else []
    chart_report = body.get("chartReport") if isinstance(body.get("chartReport"), str) else "Chua co du lieu chart."

    payload = _build_openai_payload(messages, chart_report)
    data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            error_data = json.loads(exc.read().decode("utf-8"))
            message = error_data.get("error", {}).get("message", "OpenAI request failed")
        except Exception:
            message = "OpenAI request failed"
        return jsonify({"error": message}), exc.code
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    reply = (
        result.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )
    return jsonify({"reply": reply or "AI chua tra ve noi dung."})


@app.get("/")
def index():
    if not DIST_DIR.exists():
        return "Frontend chua duoc build. Hay chay: npm run build", 500
    return send_from_directory(DIST_DIR, "index.html")


@app.get("/<path:path>")
def static_proxy(path: str):
    if not DIST_DIR.exists():
        return "Frontend chua duoc build. Hay chay: npm run build", 500

    target = DIST_DIR / path
    if target.exists() and target.is_file():
        return send_from_directory(DIST_DIR, path)
    return send_from_directory(DIST_DIR, "index.html")


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    app.run(host="0.0.0.0", port=port)