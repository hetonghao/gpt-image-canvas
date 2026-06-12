!macro AI_COVE_DESIGN_CLOSE_PROCESS PROCESS_NAME
  DetailPrint "Closing ${PROCESS_NAME} if it is running..."
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM "${PROCESS_NAME}" /T /F'
!macroend

!macro AI_COVE_DESIGN_CLOSE_SIDECAR_NODE
  DetailPrint "Closing AI Cove Design sidecar node.exe if it is running..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = ''SilentlyContinue''; $targets = @(''$INSTDIR\resources\sidecar\node\node.exe'', ''$LOCALAPPDATA\AI Cove Design\resources\sidecar\node\node.exe'', ''$LOCALAPPDATA\AI-Cove-Design\resources\sidecar\node\node.exe'') | Where-Object { $_ }; $processes = Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq ''node.exe'' -and $_.ExecutablePath }; foreach ($target in $targets) { $normalizedTarget = [System.IO.Path]::GetFullPath($target); foreach ($process in $processes) { $processPath = [System.IO.Path]::GetFullPath($process.ExecutablePath); if ([System.StringComparer]::OrdinalIgnoreCase.Equals($processPath, $normalizedTarget)) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue; Wait-Process -Id $process.ProcessId -ErrorAction SilentlyContinue } } }"'
!macroend

!macro AI_COVE_DESIGN_CLOSE_RUNNING_APP
  !insertmacro AI_COVE_DESIGN_CLOSE_PROCESS "AI Cove Design.exe"
  !insertmacro AI_COVE_DESIGN_CLOSE_PROCESS "AI-Cove-Design.exe"
  !insertmacro AI_COVE_DESIGN_CLOSE_PROCESS "ai-cove-design-tauri.exe"
  !insertmacro AI_COVE_DESIGN_CLOSE_SIDECAR_NODE
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro AI_COVE_DESIGN_CLOSE_RUNNING_APP
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro AI_COVE_DESIGN_CLOSE_RUNNING_APP
!macroend
