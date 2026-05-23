import os
import sys
import sqlite3
import logging
import cv2
import yt_dlp
import easyocr
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Reconfigure standard streams to UTF-8 to prevent encoding errors on Windows when printing unicode characters
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

# Logger configuration
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("CodeFlowBackend")

DB_FILE = "ocr_cache.db"

app = FastAPI(
    title="Code-Flow OCR Sync Backend",
    description="FastAPI backend for extracting code from YouTube frames using yt-dlp, OpenCV and EasyOCR.",
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

# Global EasyOCR Reader
ocr_reader = None

def get_db_conn():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def reconstruct_code_from_easyocr(results):
    if not results:
        return ""
    
    # Calculate average height of boxes to group lines
    heights = []
    for box, text, conf in results:
        h = box[2][1] - box[0][1]
        heights.append(h)
    avg_height = sum(heights) / len(heights) if heights else 15
    
    # Sort results primarily by y-coordinate (top-left y)
    sorted_results = sorted(results, key=lambda r: r[0][0][1])
    
    lines = []
    current_line = []
    current_y = None
    
    for box, text, conf in sorted_results:
        y_top = box[0][1]
        y_bottom = box[2][1]
        y_center = (y_top + y_bottom) / 2
        x_left = box[0][0]
        
        if current_y is None:
            current_y = y_center
            current_line.append((x_left, text))
        else:
            # If the difference in y_center is within 0.6 * avg_height, group as same line
            if abs(y_center - current_y) < (0.6 * avg_height):
                current_line.append((x_left, text))
            else:
                # Sort current line by x-coordinate and join
                current_line.sort(key=lambda item: item[0])
                lines.append(" ".join([item[1] for item in current_line]))
                
                # Start new line
                current_line = [(x_left, text)]
                current_y = y_center
                
    if current_line:
        current_line.sort(key=lambda item: item[0])
        lines.append(" ".join([item[1] for item in current_line]))
        
    return "\n".join(lines)

@app.on_event("startup")
def startup_event():
    global ocr_reader
    logger.info("EasyOCR Reader 모델 로드 중...")
    try:
        # GPU 사용 여부는 라이브러리가 알아서 선택하도록 둡니다.
        ocr_reader = easyocr.Reader(['ko', 'en'])
        logger.info("EasyOCR Reader 모델 로드 완료!")
    except Exception as e:
        logger.error(f"EasyOCR Reader 초기화 실패: {e}")

    # Initialize DB table
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
        conn.commit()
        logger.info("SQLite database cache table initialized successfully.")
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
            return {
                "video_id": video_id,
                "timestamp_sec": timestamp_sec,
                "extracted_code": row["extracted_code"],
                "cached": True
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


# 4. Local EasyOCR
    try:
        if ocr_reader is None:
            raise RuntimeError("EasyOCR Reader 모델이 로드되지 않았습니다.")
        
        # EasyOCR로 텍스트 추출 (색상 프레임을 직접 사용하여 가독성 극대화)
        results = ocr_reader.readtext(frame)
        extracted_text = reconstruct_code_from_easyocr(results)
    except Exception as e:
        logger.error(f"OCR processing failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"EasyOCR 텍스트 추출 중 에러 발생: {str(e)}"
        )

    # Clean the extracted text code
    cleaned_code = extracted_text.strip()

    # 6. Save back to SQLite (Caching)
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
        "cached": False
    }
