!macro customCheckAppRunning
  Sleep 1000
  vapepos_check_again:
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "VapePOS sigue abierto. Guarda tu trabajo, cierra todas sus ventanas y pulsa Reintentar." /SD IDCANCEL IDRETRY vapepos_check_again
    Quit
  ${ElseIf} $R0 != 603
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "No se pudo verificar el cierre de VapePOS. Ejecuta el instalador como administrador." /SD IDCANCEL IDRETRY vapepos_check_again
    Quit
  ${EndIf}
  ${nsProcess::Unload}
!macroend
