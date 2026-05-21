# PowerShell Web Server for Code-Flow
$port = 8000
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")

try {
    $listener.Start()
    Write-Host "=========================================================="
    Write-Host " Code-Flow 로컬 웹 서버가 성공적으로 시작되었습니다!"
    Write-Host " URL: http://localhost:$port/index.html"
    Write-Host " 종료하려면 이 터미널 창에서 Ctrl + C를 누르세요."
    Write-Host "=========================================================="
} catch {
    Write-Error "웹 서버를 시작할 수 없습니다. 포트 $port 가 이미 사용 중이거나 권한이 필요할 수 있습니다: $_"
    exit 1
}

$baseDir = $PSScriptRoot

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $rawUrl = $request.Url.LocalPath
        
        # Default to index.html
        if ($rawUrl -eq "/" -or $rawUrl -eq "") {
            $filePath = Join-Path $baseDir "index.html"
        } else {
            # Remove leading slash and combine
            $cleanUrl = $rawUrl.TrimStart('/')
            $filePath = Join-Path $baseDir $cleanUrl
        }

        # Resolve directory traversal
        $fullPath = [System.IO.Path]::GetFullPath($filePath)
        if (-not $fullPath.StartsWith($baseDir)) {
            $response.StatusCode = 403
            $errBytes = [System.Text.Encoding]::UTF8.GetBytes("403 Forbidden")
            $response.ContentType = "text/plain; charset=utf-8"
            $response.ContentLength64 = $errBytes.Length
            $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
            $response.OutputStream.Close()
            continue
        }

        if (Test-Path $fullPath -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($fullPath)
            
            # Set content type
            if ($fullPath.EndsWith(".html")) {
                $response.ContentType = "text/html; charset=utf-8"
            } elseif ($fullPath.EndsWith(".css")) {
                $response.ContentType = "text/css; charset=utf-8"
            } elseif ($fullPath.EndsWith(".js")) {
                $response.ContentType = "application/javascript; charset=utf-8"
            } elseif ($fullPath.EndsWith(".png")) {
                $response.ContentType = "image/png"
            } elseif ($fullPath.EndsWith(".jpg") -or $fullPath.EndsWith(".jpeg")) {
                $response.ContentType = "image/jpeg"
            } else {
                $response.ContentType = "application/octet-stream"
            }

            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $errBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.ContentType = "text/plain; charset=utf-8"
            $response.ContentLength64 = $errBytes.Length
            $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
        }
        $response.OutputStream.Close()
    } catch {
        # Log error but don't stop the server loop
        Write-Host "요청 처리 중 오류 발생: $_"
    }
}
