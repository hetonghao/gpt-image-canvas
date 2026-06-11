!macro AI_COVE_DESIGN_CLOSE_PROCESS PROCESS_NAME
  DetailPrint "Closing ${PROCESS_NAME} if it is running..."
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM "${PROCESS_NAME}" /T /F'
!macroend

!macro AI_COVE_DESIGN_CLOSE_RUNNING_APP
  !insertmacro AI_COVE_DESIGN_CLOSE_PROCESS "AI Cove Design.exe"
  !insertmacro AI_COVE_DESIGN_CLOSE_PROCESS "AI-Cove-Design.exe"
  !insertmacro AI_COVE_DESIGN_CLOSE_PROCESS "ai-cove-design-tauri.exe"
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro AI_COVE_DESIGN_CLOSE_RUNNING_APP
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro AI_COVE_DESIGN_CLOSE_RUNNING_APP
!macroend
