; Keep display/registry paths unchanged; use extended paths only for file I/O.
Var DshUninstallRoot
Var DshUninstallStage

!macro DshExtendedPath OUTPUT INPUT
  StrCpy ${OUTPUT} "${INPUT}" 4
  ${If} ${OUTPUT} == "\\?\"
    StrCpy ${OUTPUT} "${INPUT}"
  ${Else}
    StrCpy ${OUTPUT} "${INPUT}" 2
    ${If} ${OUTPUT} == "\\"
      StrCpy ${OUTPUT} "${INPUT}" "" 2
      StrCpy ${OUTPUT} "\\?\UNC\${OUTPUT}"
    ${Else}
      StrCpy ${OUTPUT} "\\?\${INPUT}"
    ${EndIf}
  ${EndIf}
!macroend

!macro DshPrepareUninstallPaths
  InitPluginsDir
  !insertmacro DshExtendedPath $DshUninstallRoot $INSTDIR
  !insertmacro DshExtendedPath $DshUninstallStage $PLUGINSDIR
!macroend
