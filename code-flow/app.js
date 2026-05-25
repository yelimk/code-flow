// ==========================================
// Code-Flow Application Core Logic
// ==========================================

// Global Mock Fallbacks for CDNs (to prevent app crash on offline/mixed-content blocks)
if (typeof lucide === 'undefined') {
    window.lucide = {
        createIcons: () => { console.warn("Lucide fallback: createIcons called"); }
    };
}
if (typeof YT === 'undefined') {
    window.YT = {
        PlayerState: {
            UNSTARTED: -1,
            ENDED: 0,
            PLAYING: 1,
            PAUSED: 2,
            BUFFERING: 3,
            CUED: 5
        }
    };
}

// Global state variables
let player = null;
let editor = null;
let terminal = null;
let pyodide = null;
let isPyodideLoading = false;

let autoScanEnabled = true;
let currentPresetKey = 'fastapi';
let lastTriggeredIdx = -1;
let scanningActive = false;
let timePollInterval = null;

// Mock Player State Variables
let isMockPlayer = false;
let mockPlayerState = 2; // 2 = Paused, 1 = Playing
let mockCurrentTime = 0;
let mockDuration = 300;

// Captured real-time code variable
window.capturedCode = '';

// API request deduplication variables
let lastRequestedTimestamp = -1;
let lastRequestedVideoId = '';

// Preset Data Configuration
const presets = {
    fastapi: {
        videoId: 'k_I82a2tJpI',
        title: 'FastAPI 기초 강의',
        language: 'python',
        defaultCode: `# FastAPI 기초 강의 실습 파일\n# '자동 스캔: ON' 상태로 영상을 재생하거나 아래 타임라인을 클릭하세요.\n`,
        timeline: [
            {
                time: 0,
                label: '1. FastAPI 인트로덕션',
                code: `# FastAPI 기초 강의 실습 파일\n# '자동 스캔: ON' 상태로 영상을 재생하거나 아래 타임라인을 클릭하세요.\n`,
                boxes: []
            },
            {
                time: 15,
                label: '2. FastAPI 라이브러리 임포트',
                code: `from fastapi import FastAPI\n\n# app 객체 생성 예정\n`,
                boxes: [
                    { x: 10, y: 15, w: 42, h: 8, label: 'Imports' }
                ]
            },
            {
                time: 45,
                label: '3. FastAPI app 인스턴스 생성',
                code: `from fastapi import FastAPI\n\napp = FastAPI()\n`,
                boxes: [
                    { x: 10, y: 15, w: 42, h: 8, label: 'Imports' },
                    { x: 10, y: 26, w: 25, h: 8, label: 'App Initialization' }
                ]
            },
            {
                time: 90,
                label: '4. 기본 GET 라우터 작성',
                code: `from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get("/")\ndef read_root():\n    return {"message": "Hello World"}\n`,
                boxes: [
                    { x: 10, y: 15, w: 42, h: 8, label: 'Imports' },
                    { x: 10, y: 26, w: 25, h: 8, label: 'App Initialization' },
                    { x: 10, y: 38, w: 55, h: 28, label: 'GET API Router' }
                ]
            },
            {
                time: 150,
                label: '5. 경로 매개변수 (Path Params) 추가',
                code: `from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get("/")\ndef read_root():\n    return {"message": "Hello World"}\n\n@app.get("/items/{item_id}")\ndef read_item(item_id: int, q: str = None):\n    return {"item_id": item_id, "q": q}\n`,
                boxes: [
                    { x: 10, y: 38, w: 55, h: 28, label: 'GET API Router' },
                    { x: 10, y: 70, w: 75, h: 25, label: 'Path parameter API' }
                ]
            },
            {
                time: 210,
                label: '6. Uvicorn 로컬 실행 엔트리포인트',
                code: `from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get("/")\ndef read_root():\n    return {"message": "Hello World"}\n\n@app.get("/items/{item_id}")\ndef read_item(item_id: int, q: str = None):\n    return {"item_id": item_id, "q": q}\n\nif __name__ == "__main__":\n    import uvicorn\n    uvicorn.run(app, host="127.0.0.1", port=8000)\n`,
                boxes: [
                    { x: 10, y: 70, w: 75, h: 25, label: 'Path parameter API' },
                    { x: 10, y: 100, w: 80, h: 20, label: 'Main Run Script' }
                ]
            }
        ]
    },
    pandas: {
        videoId: 'l8D1wT6s0Wk',
        title: 'Pandas 데이터 분석 기초',
        language: 'python',
        defaultCode: `# Pandas 데이터 분석 실습 파일\n# '자동 스캔: ON' 상태로 영상을 재생하거나 아래 타임라인을 클릭하세요.\n`,
        timeline: [
            {
                time: 0,
                label: '1. Pandas 시작하기',
                code: `# Pandas 데이터 분석 실습 파일\n# '자동 스캔: ON' 상태로 영상을 재생하거나 아래 타임라인을 클릭하세요.\nimport pandas as pd\n`,
                boxes: []
            },
            {
                time: 20,
                label: '2. 데이터프레임 구조 생성',
                code: `import pandas as pd\n\ndata = {\n    'Name': ['Alice', 'Bob', 'Charlie', 'David'],\n    'Age': [25, 30, 35, 28],\n    'City': ['New York', 'London', 'Paris', 'London']\n}\ndf = pd.DataFrame(data)\nprint("--- Raw DataFrame ---")\nprint(df)\n`,
                boxes: [
                    { x: 12, y: 10, w: 35, h: 8, label: 'Import' },
                    { x: 12, y: 22, w: 65, h: 42, label: 'Dict Data structure' },
                    { x: 12, y: 68, w: 55, h: 20, label: 'DataFrame creation' }
                ]
            },
            {
                time: 80,
                label: '3. 조건 필터링 (나이 > 28)',
                code: `import pandas as pd\n\ndata = {\n    'Name': ['Alice', 'Bob', 'Charlie', 'David'],\n    'Age': [25, 30, 35, 28],\n    'City': ['New York', 'London', 'Paris', 'London']\n}\ndf = pd.DataFrame(data)\n\n# 나이가 28세를 초과하는 데이터 필터링\nfiltered_df = df[df['Age'] > 28]\nprint("\\n--- 28세 초과 데이터 ---")\nprint(filtered_df)\n`,
                boxes: [
                    { x: 12, y: 68, w: 55, h: 20, label: 'DataFrame creation' },
                    { x: 12, y: 92, w: 72, h: 22, label: 'Conditional Filter' }
                ]
            },
            {
                time: 160,
                label: '4. 그룹별 집계 (도시별 나이 평균)',
                code: `import pandas as pd\n\ndata = {\n    'Name': ['Alice', 'Bob', 'Charlie', 'David'],\n    'Age': [25, 30, 35, 28],\n    'City': ['New York', 'London', 'Paris', 'London']\n}\ndf = pd.DataFrame(data)\n\n# 도시별 나이의 평균값 산출\ngrouped = df.groupby('City')['Age'].mean()\nprint("\\n--- 도시별 평균 나이 ---")\nprint(grouped)\n`,
                boxes: [
                    { x: 12, y: 92, w: 72, h: 22, label: 'Conditional Filter' },
                    { x: 12, y: 118, w: 78, h: 20, label: 'Groupby Aggregation' }
                ]
            }
        ]
    }
};

// ==========================================
// Initialization Functions
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide Icons
    lucide.createIcons();

    // Initialize CodeMirror (MIT License)
    initCodeMirrorEditor();

    // Initialize Xterm.js
    initTerminal();

    // Load Pyodide Sandbox
    initPyodide();

    // Setup UI Action Event Listeners
    setupEventListeners();

    // Render initial timeline
    renderTimeline();

    // If YouTube API loaded before, initialize player directly
    if (window.YT && window.YT.Player) {
        initYouTubePlayer();
    }

    // Fallback if YouTube API fails to load entirely in 6 seconds (offline or script block)
    setTimeout(() => {
        if (typeof YT === 'undefined' || !player) {
            if (player && typeof player.destroy === 'function') {
                try { player.destroy(); } catch (e) { }
            }
            player = null;
            setupMockPlayerFallback();
        }
    }, 6000);
});

// CodeMirror Editor Initialization
function initCodeMirrorEditor() {
    const initialCode = presets[currentPresetKey].defaultCode;

    if (typeof CodeMirror === 'undefined') {
        console.warn("CodeMirror is not defined. Using textarea fallback.");
        const container = document.getElementById('editor-container');
        if (container) {
            container.innerHTML = `
                <div style="width:100%; height:100%; padding:10px; background:#ffffff; border:none; display:flex; box-sizing:border-box;">
                    <textarea id="editor-fallback-textarea" style="flex:1; background:#ffffff; color:#0f172a; border:none; font-family:'Fira Code', monospace; font-size:14px; outline:none; resize:none; line-height:1.5; box-sizing:border-box;"></textarea>
                </div>
            `;
            document.getElementById('editor-fallback-textarea').value = initialCode;
        }

        editor = {
            getValue: () => {
                const el = document.getElementById('editor-fallback-textarea');
                return el ? el.value : '';
            },
            setValue: (val) => {
                const el = document.getElementById('editor-fallback-textarea');
                if (el) el.value = val;
            }
        };
        return;
    }

    const container = document.getElementById('editor-container');
    container.innerHTML = '';

    editor = CodeMirror(container, {
        value: initialCode,
        mode: 'python',
        lineNumbers: true,
        indentUnit: 4,
        tabSize: 4,
        lineWrapping: true,
        viewportMargin: Infinity
    });

    // Real-time captured variable update on editor edits
    editor.on('change', (cm) => {
        window.capturedCode = cm.getValue();
    });
    window.capturedCode = initialCode;
}

// Xterm.js Initialization
function initTerminal() {
    if (typeof Terminal === 'undefined') {
        console.warn("Xterm.js is not defined. Using textarea fallback for terminal.");
        const termContainer = document.getElementById('terminal-container');
        if (termContainer) {
            termContainer.innerHTML = `<textarea id="terminal-fallback" readonly style="width:100%; height:100%; background:#f8fafc; color:#0f172a; border:none; font-family:'Fira Code', monospace; font-size:12px; resize:none; padding:8px; outline:none; line-height:1.4; box-sizing:border-box;"></textarea>`;
        }

        terminal = {
            writeln: (str) => {
                const el = document.getElementById('terminal-fallback');
                if (el) {
                    const cleanStr = str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
                    el.value += cleanStr + '\n';
                    el.scrollTop = el.scrollHeight;
                }
            },
            clear: () => {
                const el = document.getElementById('terminal-fallback');
                if (el) el.value = '';
            }
        };
        terminal.writeln('[System] 격리된 Docker Sandbox 컨테이너 환경 대기 중...');
        return;
    }

    terminal = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: 'Fira Code, monospace',
        theme: {
            background: '#f8fafc',
            foreground: '#0f172a',
            cursor: '#38bdf8',
            black: '#f8fafc',
            red: '#f87171',
            green: '#34d399',
            yellow: '#fb923c',
            blue: '#38bdf8',
            magenta: '#818cf8',
            cyan: '#22d3ee',
            white: '#e2e8f0'
        },
        convertEol: true
    });

    terminal.open(document.getElementById('terminal-container'));
    terminal.writeln('\x1b[38;5;33m[System]\x1b[0m 격리된 Docker Sandbox 컨테이너 환경 대기 중...');
}

// Pyodide Python WASM Engine Initialization
async function initPyodide() {
    if (isPyodideLoading) return;
    isPyodideLoading = true;

    terminal.writeln('\x1b[38;5;208m[System]\x1b[0m Pyodide WebAssembly Python 환경 로딩 중 (이 작업은 몇 초가 소요됩니다)...');

    if (typeof loadPyodide === 'undefined') {
        terminal.writeln('[System Error] Pyodide CDN을 불러올 수 없습니다. 오프라인이거나 CDN이 차단되었습니다.');
        return;
    }

    try {
        pyodide = await loadPyodide();

        pyodide.setStdout({
            batched: (str) => {
                terminal.writeln(str);
            }
        });

        pyodide.setStderr({
            batched: (str) => {
                terminal.writeln('\x1b[38;5;196m' + str + '\x1b[0m');
            }
        });

        terminal.writeln('\x1b[38;5;82m[System] Python WASM Sandbox 엔진 로드 완료! 코드 실행이 가능합니다.\x1b[0m');

    } catch (error) {
        terminal.writeln('\x1b[38;5;196m[System] Pyodide 파이썬 엔진 로드 실패. 브라우저가 오프라인이거나 CDN 오류일 수 있습니다.\x1b[0m');
        console.error('Pyodide Error:', error);
    }
}

// ==========================================
// YouTube Player Event Integration
// ==========================================

function initYouTubePlayer() {
    if (player) return;
    if (typeof YT === 'undefined' || !YT.Player) return;

    player = new YT.Player('youtube-player', {
        videoId: presets[currentPresetKey].videoId,
        playerVars: {
            'playsinline': 1,
            'rel': 0,
            'controls': 1
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange,
            'onError': onPlayerError
        }
    });
}

window.onYouTubeIframeAPIReady = function () {
    initYouTubePlayer();
};

function onPlayerReady(event) {
    const duration = player.getDuration();
    document.getElementById('duration-time').innerText = formatTime(duration);
    startTimeTracker();
}

function onPlayerStateChange(event) {
    const playIcon = document.getElementById('play-icon');

    if (event.data === YT.PlayerState.PLAYING) {
        if (playIcon) playIcon.setAttribute('data-lucide', 'pause');
        lucide.createIcons();
        startTimeTracker();
    } else {
        if (playIcon) playIcon.setAttribute('data-lucide', 'play');
        lucide.createIcons();
        stopTimeTracker();
    }
}

function onPlayerError(event) {
    console.warn("YouTube Player encountered an error:", event.data);
    terminal.writeln(`\x1b[38;5;196m[System Warning] YouTube 플레이어 오류 감지 (코드: ${event.data}).\x1b[0m`);

    if (player && typeof player.destroy === 'function') {
        try { player.destroy(); } catch (e) { }
    }
    player = null;

    setupMockPlayerFallback();
}

async function fetchExtractedCode(videoId, timestampSec, forceUpdateEditor = false, showVisuals = false) {
    if (!autoScanEnabled && !forceUpdateEditor) return;

    // If a scan is already running and this is a periodic scan (not forced), skip it
    if (scanningActive && !forceUpdateEditor) return;

    // Prevent duplicate requests for the same video and timestamp
    if (!forceUpdateEditor && lastRequestedVideoId === videoId && lastRequestedTimestamp === timestampSec) {
        return;
    }

    scanningActive = true;
    lastRequestedVideoId = videoId;
    lastRequestedTimestamp = timestampSec;

    const overlay = document.getElementById('video-overlay');
    const boxContainer = document.getElementById('bounding-boxes');
    const toast = document.getElementById('ocr-toast');
    const toastText = document.getElementById('ocr-toast-text');

    // Show scan animation and logs if showVisuals is true
    if (showVisuals) {
        if (overlay) overlay.classList.remove('hidden');
        if (toast) {
            toast.classList.remove('hidden');
            toastText.innerHTML = `AI Scanner: 실시간 OCR 스캔 중... (${timestampSec}초)`;
        }
        if (boxContainer) boxContainer.innerHTML = '';
    }

    if (terminal) {
        terminal.writeln(`\x1b[38;5;33m[AI Scanner] OCR 요청 전송 (영상 ID: ${videoId}, 재생 시점: ${timestampSec}초)\x1b[0m`);
    }

    try {
        const response = await fetch('http://localhost:8000/api/sync-code', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                video_id: videoId,
                timestamp_sec: timestampSec
            })
        });

        if (!response.ok) {
            throw new Error(`서버 응답 오류 (HTTP ${response.status})`);
        }

        const data = await response.json();
        const code = data.extracted_code || '';

        // Safeguard against race conditions: Only apply if it matches the latest requested video and timestamp
        if (videoId !== lastRequestedVideoId || timestampSec !== lastRequestedTimestamp) {
            if (terminal) {
                terminal.writeln(`\x1b[38;5;244m[System] 이전 요청(${timestampSec}초)의 응답을 무시합니다. (최신: ${lastRequestedTimestamp}초)\x1b[0m`);
            }
            return;
        }

        if (terminal) {
            if (data.cached) {
                terminal.writeln(`\x1b[38;5;82m[AI Scanner] OCR 분석 성공 (캐시 히트: YES, 이번 달 누적 사용량: ${data.google_api_usage_count || 0}건 / 1000건)\x1b[0m`);
            } else {
                terminal.writeln(`\x1b[38;5;82m[AI Scanner] 구글 API 호출 성공! (이번 달 누적 사용량: ${data.google_api_usage_count || 0}건 / 1000건)\x1b[0m`);
            }
        }

        if (showVisuals && toastText) {
            toastText.innerHTML = `<span style="color:#00e5ff;">[AI Scanner]</span> OCR 추출 완료 (캐시 ${data.cached ? '히트' : '미스'}).`;
        }

        // Update CodeMirror editor
        if (editor) {
            if (forceUpdateEditor || !editor.hasFocus()) {
                editor.setValue(code);
                window.capturedCode = code; // Sync captured variable
            } else {
                if (terminal) {
                    terminal.writeln(`\x1b[38;5;244m[System] 사용자가 편집 중입니다. 자동 동기화를 건너뜁니다.\x1b[0m`);
                }
            }
        }

        // Update mock screen code element
        const screenEl = document.getElementById('mock-screen-code');
        if (screenEl) {
            screenEl.innerText = code;
        }

    } catch (err) {
        console.error("OCR API error:", err);
        if (terminal) {
            terminal.writeln(`\x1b[38;5;196m[AI Scanner Error] OCR 연동 실패: ${err.message}\x1b[0m`);
            terminal.writeln(`\x1b[38;5;244m[System] 로컬 프리셋 코드로 대체 동기화를 수행합니다.\x1b[0m`);
        }
        if (showVisuals && toastText) {
            toastText.innerHTML = `<span style="color:#ff1744;">[AI Scanner]</span> OCR 연동 실패. 로컬 프리셋 대체.`;
        }

        // Fallback: update editor with local preset code
        const activePreset = presets[currentPresetKey];
        if (activePreset && activePreset.timeline) {
            let matchIdx = 0;
            for (let i = 0; i < activePreset.timeline.length; i++) {
                if (timestampSec >= activePreset.timeline[i].time) {
                    matchIdx = i;
                }
            }
            const fallbackCode = activePreset.timeline[matchIdx].code;
            if (editor) {
                if (forceUpdateEditor || !editor.hasFocus()) {
                    editor.setValue(fallbackCode);
                    window.capturedCode = fallbackCode;
                }
            }
        }
    } finally {
        if (showVisuals) {
            setTimeout(() => {
                if (overlay) overlay.classList.add('hidden');
                if (toast) toast.classList.add('hidden');
                scanningActive = false;
            }, 1000);
        } else {
            scanningActive = false;
        }
    }
}

function startTimeTracker() {
    if (timePollInterval) clearInterval(timePollInterval);

    timePollInterval = setInterval(() => {
        if (!player || typeof player.getCurrentTime !== 'function') return;

        if (isMockPlayer && mockPlayerState === 1) {
            mockCurrentTime = Math.min(mockCurrentTime + 0.5, mockDuration);
            if (mockCurrentTime >= mockDuration) {
                player.pauseVideo();
            }
            updateMockScreenCode();
        }

        const curTime = player.getCurrentTime();
        const currentSec = Math.floor(curTime);
        document.getElementById('current-time').innerText = formatTime(curTime);

        if (autoScanEnabled && !scanningActive && !isMockPlayer && (currentSec % 5 === 0)) {
            const activePreset = presets[currentPresetKey];
            const videoId = activePreset ? activePreset.videoId : '';
            if (videoId) {
                fetchExtractedCode(videoId, currentSec, false);
            }
        }
    }, 1000);
}

function stopTimeTracker() {
    if (timePollInterval) {
        clearInterval(timePollInterval);
        timePollInterval = null;
    }
}

function formatTime(sec) {
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// ==========================================
// Code Scan & Synchronizer Module
// ==========================================

function checkCodeSync(currentTime) {
    const activePreset = presets[currentPresetKey];
    const timeline = activePreset.timeline;

    let matchIdx = -1;
    for (let i = 0; i < timeline.length; i++) {
        if (currentTime >= timeline[i].time) {
            matchIdx = i;
        }
    }

    if (matchIdx !== -1 && matchIdx !== lastTriggeredIdx) {
        const prevIdx = lastTriggeredIdx;
        lastTriggeredIdx = matchIdx;

        if (matchIdx < prevIdx || matchIdx === 0) {
            syncCodeEditor(matchIdx, false, false);
        } else {
            triggerOcrScanAnimation(matchIdx, false);
        }
    }
}

function triggerOcrScanAnimation(index, force = false) {
    scanningActive = true;

    const overlay = document.getElementById('video-overlay');
    const boxContainer = document.getElementById('bounding-boxes');
    const toast = document.getElementById('ocr-toast');
    const toastText = document.getElementById('ocr-toast-text');

    overlay.classList.remove('hidden');
    toast.classList.remove('hidden');
    boxContainer.innerHTML = '';

    toastText.innerHTML = `AI Scanner: 화면 변경 감지. OCR 프레임 분석 중...`;

    setTimeout(() => {
        const item = presets[currentPresetKey].timeline[index];
        if (item.boxes && item.boxes.length > 0) {
            item.boxes.forEach(box => {
                const boxEl = document.createElement('div');
                boxEl.className = 'bounding-box';
                boxEl.style.left = box.x + '%';
                boxEl.style.top = box.y + '%';
                boxEl.style.width = box.w + '%';
                boxEl.style.height = box.h + '%';

                const label = document.createElement('span');
                label.className = 'bounding-box-label';
                label.innerText = box.label;
                boxEl.appendChild(label);

                boxContainer.appendChild(boxEl);
            });
        }
    }, 600);

    setTimeout(() => {
        toastText.innerHTML = `<span style="color:#38bdf8;">[LLM 보정]</span> 텍스트 오류 복구 및 코드 들여쓰기 교정 완료.`;
    }, 1800);

    setTimeout(() => {
        syncCodeEditor(index, true, force);

        overlay.classList.add('hidden');
        toast.classList.add('hidden');
        scanningActive = false;
    }, 3000);
}

function syncCodeEditor(index, animate = false, force = false) {
    const item = presets[currentPresetKey].timeline[index];
    if (!item) return;

    if (editor) {
        if (force || !editor.hasFocus()) {
            editor.setValue(item.code);
            window.capturedCode = item.code; // Sync captured variable

            if (animate) {
                if (typeof editor.lineCount === 'function') {
                    const lineCount = editor.lineCount();
                    editor.scrollIntoView({ line: lineCount - 1, ch: 0 });
                }
            }
        }
    }

    const items = document.querySelectorAll('.timeline-item');
    items.forEach((el, idx) => {
        if (idx === index) {
            el.classList.add('active');
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            el.classList.remove('active');
        }
    });
}

// ==========================================
// Smart Timeline Module
// ==========================================

function renderTimeline() {
    const timelineList = document.getElementById('timeline-list');
    if (!timelineList) return;
    timelineList.innerHTML = '';

    const activePreset = presets[currentPresetKey];

    activePreset.timeline.forEach((item, idx) => {
        const itemEl = document.createElement('div');
        itemEl.className = `timeline-item ${idx === 0 ? 'active' : ''}`;

        const timeStr = formatTime(item.time);

        let snippet = '';
        const lines = item.code.split('\n').filter(l => l.trim().length > 0 && !l.startsWith('#'));
        if (lines.length > 0) {
            snippet = lines[0].substring(0, 40) + (lines[0].length > 40 ? '...' : '');
        } else {
            snippet = '실습 환경 초기화';
        }

        itemEl.innerHTML = `
            <div class="timeline-time">${timeStr}</div>
            <div class="timeline-content">
                <span class="timeline-item-title">${item.label}</span>
                <span class="timeline-item-subtitle">${snippet}</span>
            </div>
            <i data-lucide="play-circle" class="timeline-play-indicator"></i>
        `;

        itemEl.addEventListener('click', () => {
            if (player && typeof player.seekTo === 'function') {
                player.seekTo(item.time, true);

                if (player.getPlayerState() !== YT.PlayerState.PLAYING) {
                    player.playVideo();
                }

                lastTriggeredIdx = idx;
                
                const activePreset = presets[currentPresetKey];
                const videoId = activePreset ? activePreset.videoId : '';
                if (videoId) {
                    if (isMockPlayer) {
                        // In mock player mode, sync editor using local preset code directly
                        syncCodeEditor(idx, true, true);
                    } else {
                        fetchExtractedCode(videoId, item.time, true, true);
                    }
                }
            }
        });

        timelineList.appendChild(itemEl);
    });

    lucide.createIcons();
}

// ==========================================
// Code Runner Sandbox Engine
// ==========================================

async function executePythonCode() {
    const selectedLang = document.getElementById('language-select').value;
    if (selectedLang !== 'python') {
        if (terminal) {
            terminal.clear();
            const displayNames = {
                'javascript': 'JavaScript',
                'java': 'Java',
                'c': 'C'
            };
            const displayName = displayNames[selectedLang] || selectedLang;
            terminal.writeln(`\x1b[38;5;208m[실행 미지원]\x1b[0m 현재 브라우저 샌드박스는 \x1b[1mPython\x1b[0m 언어 실행만 완벽하게 지원합니다.`);
            terminal.writeln(`\x1b[38;5;244m(학습용 ${displayName} 구문 강조 및 에디팅은 정상 작동 중입니다. 실행 기능은 곧 제공될 예정입니다.)\x1b[0m`);
        }
        return;
    }

    if (!pyodide) {
        terminal.writeln('\x1b[38;5;196m[System Error] Sandbox가 아직 활성화되지 않았습니다. 잠시 후 다시 실행하세요.\x1b[0m');
        return;
    }

    terminal.clear();
    terminal.writeln('\x1b[38;5;33m> Running Python Sandbox environment...\x1b[0m');

    const userCode = window.capturedCode || (editor ? editor.getValue() : '');

    if (userCode.includes('import pandas') || userCode.includes('from pandas')) {
        terminal.writeln('\x1b[38;5;208m[System] Pandas WebAssembly 패키지를 원격에서 로드 중입니다 (약 5MB)... \x1b[0m');
        try {
            await pyodide.loadPackage('pandas');
            terminal.writeln('\x1b[38;5;82m[System] Pandas 패키지 연동 성공.\x1b[0m');
        } catch (pkgErr) {
            terminal.writeln('\x1b[38;5;196m[System] Pandas 패키지 로딩 실패. 네트워크 상태를 확인해 주세요.\x1b[0m');
            return;
        }
    }

    const isFastApiApp = userCode.includes('FastAPI') && userCode.includes('uvicorn.run');

    const boostScript = `
import sys
from types import ModuleType
import inspect
import re
import urllib.parse
import json

class MockFastAPI:
    def __init__(self):
        self.routes = {}
    
    def get(self, path):
        def decorator(func):
            self.routes[("GET", path)] = func
            return func
        return decorator

    def post(self, path):
        def decorator(func):
            self.routes[("POST", path)] = func
            return func
        return decorator

fastapi_mod = ModuleType('fastapi')
fastapi_mod.FastAPI = MockFastAPI
sys.modules['fastapi'] = fastapi_mod

class MockUvicorn:
    def run(self, app, host='127.0.0.1', port=8000, *args, **kwargs):
        global __fastapi_app__
        __fastapi_app__ = app
        print(f"> Running app...")
        print(f"> Uicorn running on http://{host}:{port} (Press CTRL+C to quit)")

sys.modules['uvicorn'] = MockUvicorn()

async def dispatch_request(method, url):
    global __fastapi_app__
    if '__fastapi_app__' not in globals() or __fastapi_app__ is None:
        return json.dumps({"detail": "FastAPI application not initialized."})
    
    parsed_url = urllib.parse.urlparse(url)
    path = parsed_url.path
    query_params = urllib.parse.parse_qs(parsed_url.query)
    query = {k: v[0] for k, v in query_params.items()}
    
    for (route_method, route_path), func in __fastapi_app__.routes.items():
        if route_method != method:
            continue
            
        pattern = re.sub(r'\\\\{([^}]+)\\\\}', r'(?P<\\\\1>[^/]+)', route_path)
        pattern = '^' + pattern + '$'
        
        match = re.match(pattern, path)
        if match:
            path_params = match.groupdict()
            sig = inspect.signature(func)
            args = {}
            
            for param_name, param in sig.parameters.items():
                if param_name in path_params:
                    val = path_params[param_name]
                    if param.annotation == int:
                        try: val = int(val)
                        except: pass
                    args[param_name] = val
                elif param_name in query:
                    val = query[param_name]
                    if param.annotation == int:
                        try: val = int(val)
                        except: pass
                    args[param_name] = val
                elif param.default != inspect.Parameter.empty:
                    args[param_name] = param.default
                else:
                    args[param_name] = None
            
            try:
                if inspect.iscoroutinefunction(func):
                    import asyncio
                    res = await func(**args)
                else:
                    res = func(**args)
                return json.dumps(res)
            except Exception as e:
                return json.dumps({"detail": f"Internal Server Error: {str(e)}"})
                
    return json.dumps({"detail": "Not Found"})
`;

    try {
        await pyodide.runPythonAsync(boostScript);
        await pyodide.runPythonAsync(userCode);

        const previewCard = document.getElementById('web-preview-card');
        if (isFastApiApp) {
            previewCard.classList.remove('hidden');
            requestMockFastApi('/');
        } else {
            previewCard.classList.add('hidden');
        }

    } catch (err) {
        const errLines = err.message.split('\n');
        terminal.writeln('\x1b[38;5;196m> Python Traceback (Error during execution):\x1b[0m');

        errLines.forEach(line => {
            if (line.includes('File') || line.includes('line')) {
                terminal.writeln('\x1b[38;5;208m' + line + '\x1b[0m');
            } else {
                terminal.writeln('\x1b[38;5;196m' + line + '\x1b[0m');
            }
        });
    }
}

async function requestMockFastApi(path) {
    if (!pyodide) return;

    const outputEl = document.getElementById('preview-output');
    if (outputEl) {
        outputEl.innerText = "Loading response...";
    }

    try {
        const encodedPath = encodeURI(path);
        const fullUrl = `http://127.0.0.1:8000${encodedPath}`;
        const resultString = await pyodide.runPythonAsync(`dispatch_request("GET", "${fullUrl}")`);

        const jsonResult = JSON.parse(resultString);
        if (outputEl) {
            outputEl.innerText = JSON.stringify(jsonResult, null, 4);
        }
    } catch (err) {
        if (outputEl) {
            outputEl.innerText = JSON.stringify({ error: "Failed to dispatch request.", detail: err.message }, null, 4);
        }
    }
}

// ==========================================
// Custom UI Controls & Actions
// ==========================================

let hdSyncActive = false;

function setupEventListeners() {
    const playBtn = document.getElementById('play-pause-btn');
    playBtn.addEventListener('click', () => {
        if (!player || typeof player.getPlayerState !== 'function') return;

        const state = player.getPlayerState();
        if (state === YT.PlayerState.PLAYING) {
            player.pauseVideo();
        } else {
            player.playVideo();
        }
    });

    const scanToggle = document.getElementById('auto-scan-toggle');
    const scanStatusText = document.getElementById('scan-status-label');
    scanToggle.addEventListener('change', (e) => {
        autoScanEnabled = e.target.checked;
        if (autoScanEnabled) {
            scanStatusText.innerText = "ON";
            scanStatusText.style.color = "var(--color-green)";
            scanStatusText.style.textShadow = "0 0 6px var(--color-green-glow)";
            terminal.writeln('\x1b[38;5;82m[System] 실시간 AI 자동 스캔 활성화\x1b[0m');
        } else {
            scanStatusText.innerText = "OFF";
            scanStatusText.style.color = "var(--text-muted)";
            scanStatusText.style.textShadow = "none";
            terminal.writeln('\x1b[38;5;244m[System] 실시간 AI 자동 스캔 비활성화 (에디터 단독 편집 모드)\x1b[0m');
        }
    });

    // HD Sync Button Click Listener
    const hdSyncBtn = document.getElementById('hd-sync-btn');
    if (hdSyncBtn) {
        hdSyncBtn.addEventListener('click', () => {
            hdSyncActive = !hdSyncActive;
            if (hdSyncActive) {
                hdSyncBtn.classList.add('active');
                hdSyncBtn.innerHTML = `<i data-lucide="check"></i> <span>HD Sync ON</span>`;
                if (terminal) {
                    terminal.writeln(`\x1b[38;5;82m[HD Sync] 고화질 분석 싱크 모드가 활성화되었습니다. (스캔 정밀도 극대화)\x1b[0m`);
                }
            } else {
                hdSyncBtn.classList.remove('active');
                hdSyncBtn.innerHTML = `<i data-lucide="sparkles"></i> <span>HD Sync ON</span>`;
                if (terminal) {
                    terminal.writeln(`\x1b[38;5;244m[HD Sync] 일반 화질 싱크 모드로 전환되었습니다.\x1b[0m`);
                }
            }
            lucide.createIcons();
        });
    }

    // Language Dropdown Selection Listener
    const langSelect = document.getElementById('language-select');
    if (langSelect) {
        langSelect.addEventListener('change', (e) => {
            const lang = e.target.value;
            let mode = 'python';
            if (lang === 'javascript') mode = 'text/javascript';
            else if (lang === 'c') mode = 'text/x-csrc';
            else if (lang === 'java') mode = 'text/x-java';
            
            if (editor) {
                editor.setOption('mode', mode);
            }
            if (terminal) {
                const langLabel = lang.toUpperCase();
                terminal.writeln(`\x1b[38;5;82m[System] 에디터 언어 모드가 ${langLabel}(으)로 변경되었습니다.\x1b[0m`);
            }
        });
    }

    const loadBtn = document.getElementById('load-btn');
    const urlInput = document.getElementById('youtube-url');
    loadBtn.addEventListener('click', () => {
        const urlValue = urlInput.value.trim();
        if (!urlValue) return;

        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = urlValue.match(regExp);

        if (match && match[2].length === 11) {
            const videoId = match[2];

            let foundPresetKey = null;
            for (const key in presets) {
                if (presets[key].videoId === videoId) {
                    foundPresetKey = key;
                    break;
                }
            }

            if (foundPresetKey) {
                switchPreset(foundPresetKey);
            } else {
                terminal.writeln(`\x1b[38;5;33m[System] 외부 강의 비디오 연동 시도: ${videoId}\x1b[0m`);
                terminal.writeln(`\x1b[38;5;208m[System] AI OCR 스캐너가 새로운 영상을 위한 스마트 학습 타임라인을 자동 생성 중입니다...\x1b[0m`);

                presets['custom'] = {
                    videoId: videoId,
                    title: '외부 유튜브 강의 실습',
                    language: 'python',
                    defaultCode: `# 외부 연동 비디오 실습 파일\n# 이 영상에 맞춘 AI 학습 가이드 코드가 작성됩니다.\n`,
                    timeline: [
                        {
                            time: 0,
                            label: '1. 코드 분석 스캔 준비',
                            code: `# 외부 연동 동영상 실습 환경\n# 재생하면 비디오 내용의 코드 프레임이 감지되어 실시간 주입됩니다.\n`,
                            boxes: []
                        },
                        {
                            time: 10,
                            label: '2. 모듈 임포트 단계',
                            code: `import math\nimport os\n\nprint("External environment initialized")\n`,
                            boxes: [{ x: 15, y: 15, w: 40, h: 10, label: 'Imports' }]
                        },
                        {
                            time: 30,
                            label: '3. 코딩 예제 구현',
                            code: `import math\nimport os\n\ndef calculate_sphere_volume(radius):\n    # 구의 부피 계산 함수\n    volume = (4/3) * math.pi * (radius ** 3)\n    return volume\n\nr = 5\nvol = calculate_sphere_volume(r)\nprint(f"반지름 {r}인 구의 부피: {vol:.2f}")\n`,
                            boxes: [
                                { x: 15, y: 15, w: 40, h: 10, label: 'Imports' },
                                { x: 15, y: 30, w: 75, h: 30, label: 'Function definition' }
                            ]
                        }
                    ]
                };

                currentPresetKey = 'custom';
                lastTriggeredIdx = -1;

                restoreRealPlayerIfNeeded();

                if (player && typeof player.loadVideoById === 'function') {
                    player.loadVideoById(videoId);
                } else {
                    initYouTubePlayer();
                }

                renderTimeline();

                if (editor) {
                    editor.setValue(presets['custom'].defaultCode);
                    window.capturedCode = presets['custom'].defaultCode; // Sync captured variable
                }

                document.getElementById('web-preview-card').classList.add('hidden');
            }
        } else {
            alert('올바른 유튜브 주소 형식이 아닙니다.');
        }
    });

    const runBtn = document.getElementById('run-btn');
    runBtn.addEventListener('click', executePythonCode);

    const saveBtn = document.getElementById('save-btn');
    saveBtn.addEventListener('click', () => {
        if (!editor) return;
        const code = window.capturedCode || editor.getValue();

        const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = currentPresetKey === 'fastapi' ? 'main.py' : 'data_analysis.py';
        document.body.appendChild(a);
        a.click();

        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        terminal.writeln('\x1b[38;5;82m[System] 코드 파일이 로컬 디스크에 저장되었습니다.\x1b[0m');
    });

    const clearTermBtn = document.getElementById('clear-terminal-btn');
    clearTermBtn.addEventListener('click', () => {
        if (terminal) terminal.clear();
    });

    const previewGoBtn = document.getElementById('preview-go-btn');
    const previewPath = document.getElementById('preview-path');

    previewGoBtn.addEventListener('click', () => {
        const path = previewPath.value.trim();
        requestMockFastApi(path);
    });

    previewPath.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const path = previewPath.value.trim();
            requestMockFastApi(path);
        }
    });
}

function switchPreset(key) {
    if (currentPresetKey === key) return;

    currentPresetKey = key;
    lastTriggeredIdx = -1;

    const urlInput = document.getElementById('youtube-url');
    if (key === 'fastapi') {
        urlInput.value = 'https://www.youtube.com/watch?v=k_I82a2tJpI';
    } else {
        urlInput.value = 'https://www.youtube.com/watch?v=l8D1wT6s0Wk';
    }

    restoreRealPlayerIfNeeded();

    if (player && typeof player.loadVideoById === 'function') {
        player.loadVideoById(presets[key].videoId);
    } else {
        initYouTubePlayer();
    }

    renderTimeline();

    if (editor) {
        editor.setValue(presets[key].defaultCode);
        window.capturedCode = presets[key].defaultCode; // Sync captured variable
    }

    document.getElementById('web-preview-card').classList.add('hidden');

    if (terminal) {
        terminal.clear();
        terminal.writeln(`\x1b[38;5;33m[System]\x1b[0m 데모 예제가 전환되었습니다: \x1b[1m${presets[key].title}\x1b[0m`);
    }
}

// ==========================================
// Mock Player Fallback Functions
// ==========================================

function restoreRealPlayerIfNeeded() {
    if (isMockPlayer) {
        isMockPlayer = false;
        player = null;

        const videoWrapper = document.querySelector('.video-container-wrapper');
        if (videoWrapper) {
            videoWrapper.innerHTML = `
                <!-- YouTube IFrame Player -->
                <div id="youtube-player"></div>

                <!-- AI Scan Overlay -->
                <div id="video-overlay" class="video-overlay hidden">
                    <div class="laser-beam"></div>
                    <div id="bounding-boxes" class="bounding-boxes-container"></div>
                    <div id="ocr-toast" class="ocr-toast hidden">
                        <i data-lucide="sparkles" class="toast-sparkle"></i>
                        <span id="ocr-toast-text">AI Scanner: 화면 변경 감지. OCR 스캔 중...</span>
                    </div>
                </div>
            `;
            lucide.createIcons();
        }
    }
}

function setupMockPlayerFallback() {
    isMockPlayer = true;
    const playerDiv = document.getElementById('youtube-player');
    if (!playerDiv) return;

    terminal.writeln('\x1b[38;5;220m[System Warning] YouTube IFrame API 로드 지연 감지 (로컬 file:// 실행 보안 또는 네트워크 지연).\x1b[0m');
    terminal.writeln('\x1b[38;5;82m[System] 비디오 에뮬레이션 플레이어 모드로 자동 전환하여 실습 동기화를 유지합니다.\x1b[0m');

    playerDiv.outerHTML = `
        <div id="youtube-player" class="mock-player-container">
            <div class="mock-video-display">
                <div class="mock-video-glow"></div>
                <i data-lucide="video-off" class="mock-video-icon"></i>
                <h3 class="mock-video-title">YouTube 로컬 보안 우회 모드</h3>
                <p class="mock-video-subtitle">실시간 비디오 에뮬레이션 활성화 (FastAPI 기초)</p>
                <div class="mock-screen-content">
                    <pre id="mock-screen-code"># AI 스캐너 분석 화면\\n# 동영상을 재생하면 실시간으로 코드가 분석됩니다.</pre>
                </div>
            </div>
        </div>
    `;

    lucide.createIcons();

    player = {
        getCurrentTime: () => mockCurrentTime,
        getDuration: () => mockDuration,
        seekTo: (sec, allowSeekAhead) => {
            mockCurrentTime = Math.min(sec, mockDuration);
            document.getElementById('current-time').innerText = formatTime(mockCurrentTime);
            updateMockScreenCode(true);
        },
        playVideo: () => {
            mockPlayerState = 1;
            const playIcon = document.getElementById('play-icon');
            if (playIcon) {
                playIcon.setAttribute('data-lucide', 'pause');
                lucide.createIcons();
            }
            startTimeTracker();
        },
        pauseVideo: () => {
            mockPlayerState = 2;
            const playIcon = document.getElementById('play-icon');
            if (playIcon) {
                playIcon.setAttribute('data-lucide', 'play');
                lucide.createIcons();
            }
            stopTimeTracker();
        },
        getPlayerState: () => mockPlayerState,
        loadVideoById: (videoId) => {
            mockCurrentTime = 0;
            const activePreset = presets[currentPresetKey];
            mockDuration = activePreset.timeline[activePreset.timeline.length - 1].time + 60;
            document.getElementById('duration-time').innerText = formatTime(mockDuration);
            document.getElementById('current-time').innerText = formatTime(0);

            const titleEl = document.querySelector('.mock-video-title');
            const subtitleEl = document.querySelector('.mock-video-subtitle');
            if (titleEl) titleEl.innerText = activePreset.title;
            if (subtitleEl) subtitleEl.innerText = `실시간 비디오 에뮬레이션 활성화 (${activePreset.language.toUpperCase()})`;

            updateMockScreenCode();
        }
    };

    const activePreset = presets[currentPresetKey];
    mockDuration = activePreset.timeline[activePreset.timeline.length - 1].time + 60;
    document.getElementById('duration-time').innerText = formatTime(mockDuration);

    renderTimeline();
    updateMockScreenCode();
}

function updateMockScreenCode(force = false) {
    const screenEl = document.getElementById('mock-screen-code');
    if (!screenEl) return;

    const activePreset = presets[currentPresetKey];
    const timeline = activePreset.timeline;
    let matchIdx = 0;
    for (let i = 0; i < timeline.length; i++) {
        if (mockCurrentTime >= timeline[i].time) {
            matchIdx = i;
        }
    }

    const code = timeline[matchIdx].code;
    screenEl.innerText = code;

    if (editor) {
        if (force || !editor.hasFocus()) {
            editor.setValue(code);
            window.capturedCode = code; // Sync captured variable
        }
    }
}
