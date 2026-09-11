!ifndef BUILD_UNINSTALLER
  ; electron-builder updates normally ask the old uninstaller to atomically move
  ; every installed file before deletion. Large unpacked installations can make
  ; that old uninstaller return code 2 even after the application has exited.
  ; Retry only that failed case with the old uninstaller's regular removal path.
  ; User data remains outside $installationDir and the package contract keeps
  ; deleteAppDataOnUninstall disabled.
  !macro DshRecoverFailedAtomicUninstall INSTALL_SCOPE LABEL_SUFFIX
    IfErrors DshLegacyUninstallNeeded_${LABEL_SUFFIX} 0
    StrCmp $R0 "0" DshLegacyUninstallDone_${LABEL_SUFFIX}

    DshLegacyUninstallNeeded_${LABEL_SUFFIX}:
      StrCmp $installationDir "" DshLegacyUninstallFailed_${LABEL_SUFFIX}
      IfFileExists "$installationDir\*.*" 0 DshLegacyUninstallDone_${LABEL_SUFFIX}
      IfFileExists "$installationDir\${APP_EXECUTABLE_FILENAME}" 0 DshLegacyUninstallFailed_${LABEL_SUFFIX}
      IfFileExists "$uninstallerFileNameTemp" DshLegacyUninstallRetry_${LABEL_SUFFIX} DshLegacyUninstallFailed_${LABEL_SUFFIX}

    DshLegacyUninstallRetry_${LABEL_SUFFIX}:
      StrCpy $R8 0
      StrCpy $R9 "/currentuser"
      StrCmp "${INSTALL_SCOPE}" "shell" 0 DshLegacyUninstallAttempt_${LABEL_SUFFIX}
      StrCmp $installMode "CurrentUser" DshLegacyUninstallAttempt_${LABEL_SUFFIX}
      StrCpy $R9 "/allusers"

    DshLegacyUninstallAttempt_${LABEL_SUFFIX}:
      IntOp $R8 $R8 + 1
      ClearErrors
      DetailPrint "Retrying previous-version cleanup without atomic relocation (attempt $R8 of 3)."
      ExecWait '"$uninstallerFileNameTemp" /S /KEEP_APP_DATA $R9 _?=$installationDir' $R0
      IfErrors DshLegacyUninstallRetryOrFail_${LABEL_SUFFIX} 0
      StrCmp $R0 "0" 0 DshLegacyUninstallRetryOrFail_${LABEL_SUFFIX}
      IfFileExists "$installationDir\*.*" DshLegacyUninstallRetryOrFail_${LABEL_SUFFIX} DshLegacyUninstallDone_${LABEL_SUFFIX}

    DshLegacyUninstallRetryOrFail_${LABEL_SUFFIX}:
      IntCmp $R8 3 DshLegacyUninstallFailed_${LABEL_SUFFIX} DshLegacyUninstallRetryDelay_${LABEL_SUFFIX} DshLegacyUninstallFailed_${LABEL_SUFFIX}

    DshLegacyUninstallRetryDelay_${LABEL_SUFFIX}:
      Sleep 1000
      Goto DshLegacyUninstallAttempt_${LABEL_SUFFIX}

    DshLegacyUninstallFailed_${LABEL_SUFFIX}:
      StrCpy $R0 2
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
      DetailPrint "Previous-version cleanup still left files in $installationDir."
      SetErrorLevel 2
      Quit

    DshLegacyUninstallDone_${LABEL_SUFFIX}:
      ClearErrors
      StrCpy $R0 0
  !macroend

  !macro customUnInstallCheck
    !insertmacro DshRecoverFailedAtomicUninstall "shell" "Shell"
  !macroend

  !macro customUnInstallCheckCurrentUser
    !insertmacro DshRecoverFailedAtomicUninstall "current-user" "CurrentUser"
  !macroend

  !ifndef ONE_CLICK
    !include "LogicLib.nsh"
    !include "nsDialogs.nsh"

    Var DshDirectoryPage
    Var DshDirectoryEdit
    Var DshDirectoryNormalizationActive

    ; MUI invokes this after the assisted installer's directory page is ready.
    ; Normalize a selected drive root immediately so the page does not reject it
    ; before electron-builder's later install-time sanitization can run.
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW DshDirectoryPageShow

    Function DshDirectoryPageShow
      FindWindow $DshDirectoryPage "#32770" "" $HWNDPARENT
      GetDlgItem $DshDirectoryEdit $DshDirectoryPage 1019
      ${NSD_OnChange} $DshDirectoryEdit DshDirectoryChanged
      Call DshNormalizeDriveRoot
    FunctionEnd

    Function DshDirectoryChanged
      Pop $0
      Call DshNormalizeDriveRoot
    FunctionEnd

    Function DshNormalizeDriveRoot
      ${If} $DshDirectoryNormalizationActive == "1"
        Return
      ${EndIf}

      ${NSD_GetText} $DshDirectoryEdit $0
      StrLen $1 $0

      ; Accept both forms produced by typing or the Windows folder picker:
      ; "D:" and "D:\". Any non-root directory is left untouched.
      ${If} $1 == 2
        StrCpy $2 $0 1 1
        ${If} $2 != ":"
          Return
        ${EndIf}
        StrCpy $3 "$0\${APP_FILENAME}"
      ${ElseIf} $1 == 3
        StrCpy $2 $0 1 1
        ${If} $2 != ":"
          Return
        ${EndIf}
        StrCpy $2 $0 1 2
        ${If} $2 != "\"
          Return
        ${EndIf}
        StrCpy $3 "$0${APP_FILENAME}"
      ${Else}
        Return
      ${EndIf}

      StrCpy $DshDirectoryNormalizationActive "1"
      StrCpy $INSTDIR $3
      ${NSD_SetText} $DshDirectoryEdit $3
      StrCpy $DshDirectoryNormalizationActive "0"
    FunctionEnd

    ; Auto-create the installation directory tree before install begins.
    ; This allows users to type any path (e.g. D:\dsh-desktop) directly
    ; without needing to pre-create parent folders first.
    !define MUI_PAGE_CUSTOMFUNCTION_LEAVE DshEnsureInstDirExists

    Function DshEnsureInstDirExists
      CreateDirectory "$INSTDIR"
    FunctionEnd

    ; Accept any directory path the user types, even if it does not exist yet.
    ; Without this override NSIS rejects non-existent paths before the user
    ; can click Next.
    !macro preInit
    !macroend
    Function .onVerifyInstDir
      ; Always pass; we create the directory in DshEnsureInstDirExists.
    FunctionEnd

  !endif
!endif
