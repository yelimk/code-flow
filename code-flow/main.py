import os
import sys
import sqlite3
import logging
import cv2
import yt_dlp
import datetime
import re
import dotenv
import google.generativeai as genai
from google.cloud import vision
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Load environment variables from .env file
dotenv.load_dotenv(override=True)

# Reconfigure standard streams to UTF-8 to prevent encoding errors on Windows when printing unicode characters
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

# Cropping region configuration (percentage of original frame)
# To skip left sidebar (e.g. file explorer) and bottom area (e.g. terminal / status bar)
CROP_X_START_PCT = 23.0  # Skip left 23%
CROP_X_END_PCT = 100.0   # End at 100% of width
CROP_Y_START_PCT = 0.0   # Start from top
CROP_Y_END_PCT = 75.0    # End at 75% of height (skip bottom 25%)

# Bounding Box Filtering relative to cropped image (%)
# Skip editor tabs at the top or line numbers on the left of the cropped area
FILTER_X_START_PCT = 5.0  # Skip leftmost 5% of cropped area (usually line numbers)
FILTER_X_END_PCT = 98.0   # Skip rightmost 2% (usually scrollbars)
FILTER_Y_START_PCT = 8.0  # Skip top 8% of cropped area (usually editor tabs/filenames)
FILTER_Y_END_PCT = 98.0   # Skip bottom 2% (usually editor status bar)

# Logger configuration
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("CodeFlowBackend")

logger.info(f"GEMINI_API_KEY loaded: {os.environ.get('GEMINI_API_KEY')[:8] if os.environ.get('GEMINI_API_KEY') else 'None'}...")

DB_FILE = "ocr_cache.db"

app = FastAPI(
    title="Code-Flow Google Vision Sync Backend",
    description="FastAPI backend for extracting code from YouTube frames using yt-dlp, OpenCV and Google Cloud Vision API.",
    version="1.0.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SyncCodeRequest(BaseModel):
    video_id: str
    timestamp_sec: int

# Global Google Vision client
vision_client = None

def get_db_conn():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def get_vision_client():
    global vision_client
    if vision_client is None:
        try:
            # 환경 변수가 설정되어 있지 않거나 가리키는 파일이 존재하지 않는 경우, 로컬 gcp-key.json 파일을 찾아 사용합니다.
            cred_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
            if not cred_path or not os.path.exists(cred_path):
                local_key = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gcp-key.json')
                if os.path.exists(local_key):
                    os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = local_key
                    logger.info(f"GOOGLE_APPLICATION_CREDENTIALS 환경 변수를 로컬 파일로 설정했습니다: {local_key}")
            vision_client = vision.ImageAnnotatorClient()
        except Exception as e:
            logger.error(f"Google Cloud Vision Client 생성 실패: {e}")
            raise RuntimeError(
                "Google Cloud Vision API 인증을 위한 서비스 계정 키(JSON) 환경 변수가 설정되지 않았거나 올바르지 않습니다. "
                "GCP_VISION_SETUP.md 가이드를 참조하여 GOOGLE_APPLICATION_CREDENTIALS 환경 변수를 올바르게 설정해 주세요."
            )
    return vision_client

def increment_google_api_usage():
    conn = get_db_conn()
    try:
        cursor = conn.cursor()
        now = datetime.datetime.now()
        year_month = now.strftime("%Y-%m")
        cursor.execute("INSERT OR IGNORE INTO google_api_usage (year_month, call_count) VALUES (?, 0)", (year_month,))
        cursor.execute("UPDATE google_api_usage SET call_count = call_count + 1 WHERE year_month = ?", (year_month,))
        conn.commit()
        
        cursor.execute("SELECT call_count FROM google_api_usage WHERE year_month = ?", (year_month,))
        row = cursor.fetchone()
        return row["call_count"] if row else 1
    except Exception as e:
        logger.error(f"Error updating API usage counter: {e}")
        return 0
    finally:
        conn.close()

def get_current_google_api_usage():
    conn = get_db_conn()
    try:
        cursor = conn.cursor()
        now = datetime.datetime.now()
        year_month = now.strftime("%Y-%m")
        cursor.execute("INSERT OR IGNORE INTO google_api_usage (year_month, call_count) VALUES (?, 0)", (year_month,))
        conn.commit()
        cursor.execute("SELECT call_count FROM google_api_usage WHERE year_month = ?", (year_month,))
        row = cursor.fetchone()
        return row["call_count"] if row else 0
    except Exception as e:
        logger.error(f"Error fetching API usage counter: {e}")
        return 0
    finally:
        conn.close()

PYTHON_KEYWORDS = {
    'def', 'class', 'import', 'from', 'print', 'if', 'elif', 'else', 'for', 'while',
    'try', 'except', 'finally', 'with', 'as', 'return', 'yield', 'lambda', 'global',
    'nonlocal', 'assert', 'pass', 'break', 'continue', 'raise', 'in', 'and', 'or', 'not', 'is'
}

def is_valid_python_line(line: str) -> bool:
    line_stripped = line.strip()
    if not line_stripped:
        return True  # Keep empty lines
        
    # 0. Exclude VS Code IntelliSense auto-complete tooltip patterns
    tooltip_keywords = ['Optional[', 'param *', 'flush:', 'bool=...', 'CONC', '= ...', '(method)', '(function)', '(class)', 'object,']
    if any(kw in line_stripped for kw in tooltip_keywords):
        return False
        
    # Exclude tooltip type signature previews that do not end with a colon
    if '->' in line_stripped and not line_stripped.rstrip().endswith(':'):
        return False
        
    # Exclude signature list helpers (e.g. '*values: object')
    if '*' in line_stripped and 'object' in line_stripped:
        return False
    
    # 1. Comment lines are always valid
    if line_stripped.startswith('#'):
        return True
        
    # 2. Check for file path patterns (exclude them)
    if re.search(r'[a-zA-Z]:[\\/][\w\-.\\/]+', line_stripped):
        return False
    if line_stripped.startswith('PS ') or line_stripped.startswith('C:\\') or line_stripped.startswith('c:\\'):
        return False

    # 3. Exclude URL, IP addresses, and HTTP request logs
    if re.search(r'https?://|localhost:\d+|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}', line_stripped) or 'HTTP/' in line_stripped:
        return False

    # 4. Exclude timestamp lines (e.g., 6:01:28 or 00:00)
    if re.match(r'^\d{1,2}:\d{2}(:\d{2})?$', line_stripped):
        return False
        
    # 5. Check if line contains Python keywords as separate words
    words = re.findall(r'\b\w+\b', line_stripped)
    has_keyword = any(word in PYTHON_KEYWORDS for word in words)
    
    # 6. Check for common code structures (brackets, assignments, operator symbols, etc.)
    has_operators_or_brackets = any(char in line_stripped for char in ['=', '(', ')', '[', ']', '{', '}', ':', ',', '.', '+', '-', '*', '/', '"', "'"])
    
    # 7. Exclude lines that are single words representing editor UI
    MENU_ITEMS = {'file', 'edit', 'selection', 'view', 'go', 'run', 'terminal', 'help', 'problems', 'output', 'debug', 'console', 'ports'}
    if len(words) == 1 and words[0].lower() in MENU_ITEMS:
        return False

    # 8. If it has neither keywords nor code symbols, it's not code (e.g. Menu bar options)
    if not has_keyword and not has_operators_or_brackets:
        return False
        
    return True

def reconstruct_code_from_vision(response, crop_w=0, crop_h=0):
    if not response.full_text_annotation:
        return ""
    
    words_data = []
    
    # Calculate pixel bounds for filtering inside the cropped frame
    if crop_w > 0 and crop_h > 0:
        x_min_px = crop_w * (FILTER_X_START_PCT / 100.0)
        x_max_px = crop_w * (FILTER_X_END_PCT / 100.0)
        y_min_px = crop_h * (FILTER_Y_START_PCT / 100.0)
        y_max_px = crop_h * (FILTER_Y_END_PCT / 100.0)
    else:
        x_min_px = -1.0
        x_max_px = 1e9
        y_min_px = -1.0
        y_max_px = 1e9

    for page in response.full_text_annotation.pages:
        for block in page.blocks:
            for paragraph in block.paragraphs:
                for word in paragraph.words:
                    word_text = "".join([symbol.text for symbol in word.symbols])
                    vertices = word.bounding_box.vertices
                    if not vertices or len(vertices) < 4:
                        continue
                    
                    xs = [v.x for v in vertices if v.x is not None]
                    ys = [v.y for v in vertices if v.y is not None]
                    if not xs or not ys:
                        continue
                    
                    x0 = min(xs)
                    x1 = max(xs)
                    y0 = min(ys)
                    y1 = max(ys)
                    
                    # Compute center of the word bounding box
                    xc = (x0 + x1) / 2.0
                    yc = (y0 + y1) / 2.0
                    
                    # Coordinate-based filtering
                    if not (x_min_px <= xc <= x_max_px and y_min_px <= yc <= y_max_px):
                        continue
                        
                    words_data.append({
                        "text": word_text,
                        "x0": x0,
                        "x1": x1,
                        "y0": y0,
                        "y1": y1,
                        "yc": yc,
                        "height": y1 - y0
                    })
                    
    if not words_data:
        return ""
        
    # Group words into lines based on vertical overlap
    words_data.sort(key=lambda w: w["y0"])
    lines = []
    
    for word in words_data:
        placed = False
        for line in lines:
            line_y0 = line["y0"]
            line_y1 = line["y1"]
            line_height = line_y1 - line_y0
            overlap_y = min(word["y1"], line_y1) - max(word["y0"], line_y0)
            
            # If the y overlap is more than 40% of either the word height or line height,
            # or if the center y is very close
            if overlap_y > 0.4 * min(word["height"], line_height) or abs(word["yc"] - line["yc"]) < 0.3 * line_height:
                line["words"].append(word)
                line["x0"] = min(line["x0"], word["x0"])
                line["x1"] = max(line["x1"], word["x1"])
                line["y0"] = min(line["y0"], word["y0"])
                line["y1"] = max(line["y1"], word["y1"])
                line["yc"] = (line["y0"] + line["y1"]) / 2.0
                placed = True
                break
        if not placed:
            lines.append({
                "y0": word["y0"],
                "y1": word["y1"],
                "yc": word["yc"],
                "x0": word["x0"],
                "x1": word["x1"],
                "words": [word]
            })
            
    # Sort lines from top to bottom
    lines.sort(key=lambda l: l["yc"])
    
    # Sort words within each line from left to right
    for line in lines:
        line["words"].sort(key=lambda w: w["x0"])
        
    # Calculate average character width to estimate indentation
    char_widths = []
    for line in lines:
        for w in line["words"]:
            word_len = len(w["text"])
            if word_len > 0:
                char_widths.append((w["x1"] - w["x0"]) / word_len)
    avg_char_width = sum(char_widths) / len(char_widths) if char_widths else 8.0
    
    # Estimate leftmost margin of the code editor (minimum x0)
    min_x0 = min(l["x0"] for l in lines) if lines else 0
    
    output_lines = []
    for line in lines:
        line_text = ""
        prev_word = None
        for w in line["words"]:
            if prev_word is None:
                # First word of the line: estimate leading spaces
                indent_width = w["x0"] - min_x0
                spaces_count = max(0, int(round(indent_width / avg_char_width)))
                line_text += " " * spaces_count + w["text"]
            else:
                # Subsequent words: estimate spaces between words
                gap = w["x0"] - prev_word["x1"]
                gap_spaces = max(1, int(round(gap / avg_char_width)))
                
                # Punctuation spacing rules
                no_space_before = [":", "(", ")", "[", "]", ",", ".", ";"]
                no_space_after = [".", "(", "[", "{"]
                
                if gap < 0.25 * avg_char_width:
                    line_text += w["text"]
                elif w["text"] in no_space_before or prev_word["text"] in no_space_after:
                    line_text += w["text"]
                else:
                    line_text += " " * gap_spaces + w["text"]
            prev_word = w
        if is_valid_python_line(line_text):
            output_lines.append(line_text)
        
    return "\n".join(output_lines)

@app.on_event("startup")
def startup_event():
    global vision_client
    logger.info("Google Cloud Vision API Client 초기화 중...")
    try:
        # 비전 API 클라이언트는 최초 기동 시 시도하되, 환경 변수가 없어도 앱 구동 자체가 실패하지 않도록 예외 처리합니다.
        vision_client = get_vision_client()
        logger.info("Google Cloud Vision API Client 초기화 완료!")
    except Exception as e:
        logger.warning(f"Google Cloud Vision API Client 초기화 실패 (환경변수 설정 전일 수 있음): {e}")

    # Initialize DB tables
    conn = get_db_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS video_ocr_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id TEXT,
                timestamp_sec INTEGER,
                extracted_code TEXT,
                UNIQUE(video_id, timestamp_sec)
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS google_api_usage (
                year_month TEXT PRIMARY KEY,
                call_count INTEGER DEFAULT 0
            )
        """)
        conn.commit()
        logger.info("SQLite database tables initialized successfully.")
    except Exception as e:
        logger.error(f"Error initializing database: {e}")
    finally:
        conn.close()

@app.post("/api/sync-code")
async def sync_code(payload: SyncCodeRequest):
    video_id = payload.video_id
    timestamp_sec = payload.timestamp_sec

    if not video_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="video_id must not be empty"
        )
    if timestamp_sec < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="timestamp_sec must be non-negative"
        )

    # 1. DB cache check (Hit)
    conn = get_db_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT extracted_code FROM video_ocr_cache WHERE video_id = ? AND timestamp_sec = ?",
            (video_id, timestamp_sec)
        )
        row = cursor.fetchone()
        if row:
            logger.info(f"Cache HIT for video_id={video_id}, time={timestamp_sec}s")
            raw_code = row["extracted_code"]
            # Apply updated is_valid_python_line filter on-the-fly to cached code
            cleaned_lines = [line for line in raw_code.split('\n') if is_valid_python_line(line)]
            filtered_code = "\n".join(cleaned_lines)
            
            usage_count = get_current_google_api_usage()
            return {
                "video_id": video_id,
                "timestamp_sec": timestamp_sec,
                "extracted_code": filtered_code,
                "cached": True,
                "google_api_usage_count": usage_count
            }
    except Exception as e:
        logger.error(f"Database read error: {e}")
    finally:
        conn.close()

    # 2. Cache Miss: Extract video stream URL using yt-dlp
    logger.info(f"Cache MISS for video_id={video_id}, time={timestamp_sec}s. Starting extraction...")
    video_url = f"https://www.youtube.com/watch?v={video_id}"
    ydl_opts = {
        'format': 'best[ext=mp4]/best',
        'quiet': True,
        'no_warnings': True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)
            stream_url = info.get('url')
            if not stream_url:
                raise ValueError("No video stream URL found in yt-dlp output.")
    except Exception as e:
        logger.error(f"yt-dlp stream extraction failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"YouTube 비디오 스트림 주소 추출 실패: {str(e)}"
        )
    # 3. OpenCV frame capture
    cap = cv2.VideoCapture(stream_url)
    if not cap.isOpened():
        logger.error("Failed to open OpenCV video capture stream.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="동영상 비디오 스트림을 열 수 없습니다."
        )

    # Set timeline location in milliseconds
    cap.set(cv2.CAP_PROP_POS_MSEC, timestamp_sec * 1000)
    ret, frame = cap.read()
    cap.release()

    if not ret:
        logger.error(f"Failed to capture frame at time={timestamp_sec}s")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"해당 시간대({timestamp_sec}초) 프레임을 캡처할 수 없습니다."
        )

    # 3.1 Dynamic Cropping
    h, w, _ = frame.shape
    x_start = int(w * (CROP_X_START_PCT / 100.0))
    x_end = int(w * (CROP_X_END_PCT / 100.0))
    y_start = int(h * (CROP_Y_START_PCT / 100.0))
    y_end = int(h * (CROP_Y_END_PCT / 100.0))

    cropped_frame = frame[y_start:y_end, x_start:x_end]
    if cropped_frame.size == 0:
        logger.warning("Cropped frame size is 0, falling back to original frame.")
        cropped_frame = frame

    crop_h, crop_w, _ = cropped_frame.shape

    # 4. Google Cloud Vision API
    try:
        client = get_vision_client()
        
        # Convert OpenCV frame (BGR) to bytes (PNG format for lossless OCR resolution)
        success, encoded_image = cv2.imencode('.png', cropped_frame)
        if not success:
            raise RuntimeError("이미지 프레임 인코딩에 실패했습니다.")
        content = encoded_image.tobytes()
        
        image = vision.Image(content=content)
        response = client.document_text_detection(image=image)
        
        if response.error.message:
            raise RuntimeError(f"Google Cloud Vision API 오류: {response.error.message}")
            
        extracted_text = reconstruct_code_from_vision(response, crop_w, crop_h)
        # Increment usage counter
        usage_count = increment_google_api_usage()
        logger.info(f"Google Cloud Vision API 호출 성공! (이번 달 누적 사용량: {usage_count}건 / 1000건)")
    except Exception as e:
        logger.error(f"OCR processing failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Google Cloud Vision 텍스트 추출 중 에러 발생: {str(e)}"
        )

    # Clean the extracted text code
    cleaned_code = extracted_text.strip()

    # 5. Save back to SQLite (Caching)
    conn = get_db_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT OR REPLACE INTO video_ocr_cache (video_id, timestamp_sec, extracted_code) VALUES (?, ?, ?)",
            (video_id, timestamp_sec, cleaned_code)
        )
        conn.commit()
        logger.info(f"Successfully cached and saved OCR code for video_id={video_id}, time={timestamp_sec}s")
    except Exception as e:
        logger.error(f"Database write error: {e}")
    finally:
        conn.close()

    return {
        "video_id": video_id,
        "timestamp_sec": timestamp_sec,
        "extracted_code": cleaned_code,
        "cached": False,
        "google_api_usage_count": usage_count
    }

class ReviewGuideRequest(BaseModel):
    source_codes: list[str]

@app.post("/api/review-guide")
async def generate_review_guide(payload: ReviewGuideRequest):
    combined_code = "\n\n# --- 다음 코드 포인트 ---\n\n".join(payload.source_codes)
    if not combined_code.strip():
        return {"guide": "수집된 소스코드가 없습니다. 비디오를 재생하거나 타임라인을 클릭하여 코드를 수집해 주세요!"}

    dotenv.load_dotenv(override=True)
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.error("GEMINI_API_KEY environment variable is not set.")
        return {
            "guide": "🚨 **오류**: 백엔드 서버에 `GEMINI_API_KEY`가 설정되지 않았습니다.\n\n프로젝트 루트 디렉토리의 `.env` 파일에 발급받으신 Gemini API 키를 등록하고 서버를 재시작해 주세요!"
        }

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.5-flash")
        
        prompt = (
            "아래는 학습자가 오늘 유튜브 강의를 보며 작성한 파이썬 소스코드 데이터야.\n"
            f"```python\n{combined_code}\n```\n\n"
            "[제미나이 출력 가이드라인]\n"
            "1. 입력된 코드에서 가장 핵심이 되는 문법 개념(예: 특정 자료형들, 제어문 구조, 함수/클래스 등)을 스스로 분석하여 최대 2~4개 추출해 줘.\n"
            "2. 추출한 개념들의 핵심 차이점, 특징(순서, 수정 가능 여부, 작동 흐름 등)을 전공자 요약 노트 스타일로 대비/대조하여 설명해 줘.\n"
            "3. '추천 복습 포인트'나 학습 안내 가이드라인, 서론, 결론, 미사여구는 아예 완전히 배제하고 오직 아래의 2가지 마크다운(Markdown) 양식만 정확히 반환해 줘. 다른 어떠한 텍스트도 덧붙이지 말 것.\n"
            "4. 모든 설명은 한 줄 내외로 극단적으로 짧고 명확하게 압축해 줘. 절대 설명이 길어지지 않게 텍스트 양을 꽉 압축할 것.\n"
            "5. 텍스트 추출 과정이나 타이핑 중에 발생한 자잘한 '오타, 문법 에러, 실수, SyntaxError'에 대한 언급이나 분석은 **아예 완전히 배제(무시)**할 것.\n"
            "6. 결과물에 '오류', '실수', '잘못된', 'SyntaxError'라는 단어가 절대 포함되지 않도록 긍정적으로 작성할 것.\n\n"
            "--- 출력 양식 (이 구조를 100% 엄격하게 유지하면서 입력된 소스코드 데이터의 변수명이나 흐름을 자연스럽게 녹여서 채울 것) ---\n"
            "### 💡 오늘의 핵심 문법 요약\n"
            "- **[핵심개념A]**: (코드에 쓰인 문법 A의 핵심 정의와 작동 원리를 타 문법과 대비하여 한 줄 요약)\n"
            "- **[핵심개념B]**: (코드에 쓰인 문법 B의 핵심 정의와 작동 원리를 타 문법과 대비하여 한 줄 요약)\n"
            "- **[핵심개념C]**: (필요시 코드에 쓰인 문법 C나 상호 연동 흐름을 한 줄 요약)\n\n"
            "### 🛠️ 오늘 배운 주요 명령어\n"
            "| 명령어 / 키워드 | 핵심 기능 (한 줄 요약) |\n"
            "| :--- | :--- |\n"
            "| `코드에 쓰인 명령어1` | 해당 명령어의 역할과 핵심 기능 설명 |\n"
            "| `코드에 쓰인 명령어2` | 해당 명령어의 역할과 핵심 기능 설명 |\n"
            "| `코드에 쓰인 명령어3` | 해당 명령어의 역할과 핵심 기능 설명 |"
        )
        
        response = model.generate_content(prompt)
        if not response.text:
            raise ValueError("Gemini가 빈 응답을 반환했습니다.")
            
        return {"guide": response.text}
    except Exception as e:
        logger.error(f"Gemini API 호출 중 오류 발생: {e}")
        err_msg = str(e).lower()
        if "429" in err_msg or "resource_exhausted" in err_msg or "quota" in err_msg:
            return {"guide": "⚠️ **오늘의 무료 AI 요약 한도를 초과했습니다. 내일 다시 이용해 주세요!**"}
        else:
            return {"guide": f"🚨 **AI 요약 생성 중 에러가 발생했습니다**:\n\n{str(e)}"}
