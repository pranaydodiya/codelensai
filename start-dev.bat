@echo off
echo ==========================================
echo   CodeLens Dev Startup
echo ==========================================
echo.

echo [1/3] Flushing DNS cache (fixes ENOTFOUND on network switch)...
ipconfig /flushdns
echo Done.
echo.

echo [2/3] Waiting for network to stabilize...
timeout /t 3 /nobreak > nul
echo Done.
echo.

echo [3/3] Testing database connection...
ping -n 1 ep-wild-bread-ai1qrdld-pooler.c-4.us-east-1.aws.neon.tech > nul 2>&1
if %errorlevel% == 0 (
    echo Database host reachable!
) else (
    echo WARNING: Database host not reachable yet. Will retry automatically via app.
    echo If this persists, check your internet connection.
)
echo.

echo ==========================================
echo   Starting services in separate windows
echo ==========================================
echo.

echo Starting: bun run dev
start "CodeLens - Dev Server" cmd /k "bun run dev"

timeout /t 2 /nobreak > nul

echo Starting: Prisma Studio
start "CodeLens - Prisma Studio" cmd /k "bunx prisma studio"

timeout /t 2 /nobreak > nul

echo Starting: Ngrok
start "CodeLens - Ngrok" cmd /k "ngrok http 3000"

timeout /t 2 /nobreak > nul

echo Starting: Inngest Dev
start "CodeLens - Inngest" cmd /k "npx inngest-cli@latest dev"

echo.
echo ==========================================
echo   All services started!
echo   Dev:     http://localhost:3000
echo   Inngest: http://localhost:8288
echo   Prisma:  http://localhost:5555
echo ==========================================
echo.
pause
