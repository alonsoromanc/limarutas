@echo off
REM Cambia esta ruta si mueves la carpeta del proyecto
cd /d "D:\ARCHIVOS\OneDrive\Documents\UNI\Cursos adicionales\Rutas"

echo Estado actual:
git status

REM Pregunta mensaje de commit
set /p MSG=Mensaje de commit: 

REM Si no escribes nada, usa un mensaje por defecto
if "%MSG%"=="" set MSG=Auto: actualizacion rapida

echo.
echo Agregando archivos...
git add .

echo Haciendo commit...
git commit -m "%MSG%"
if errorlevel 1 (
    echo.
    echo No se hizo commit. Probablemente no hay cambios.
    goto end
)

echo.
echo Haciendo push a origin main...
git push origin main

:end
echo.
pause
