!macro customInstall
  ; Folders
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenWithCompile" "" "Open with comπle"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenWithCompile" "Icon" "$INSTDIR\compile-editor.exe"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenWithCompile\command" "" '"$INSTDIR\compile-editor.exe" "%1"'

  ; Directory Background (right clicking inside a folder)
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenWithCompile" "" "Open with comπle"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenWithCompile" "Icon" "$INSTDIR\compile-editor.exe"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenWithCompile\command" "" '"$INSTDIR\compile-editor.exe" "%V"'

  ; Files
  WriteRegStr HKCU "Software\Classes\*\shell\OpenWithCompile" "" "Open with comπle"
  WriteRegStr HKCU "Software\Classes\*\shell\OpenWithCompile" "Icon" "$INSTDIR\compile-editor.exe"
  WriteRegStr HKCU "Software\Classes\*\shell\OpenWithCompile\command" "" '"$INSTDIR\compile-editor.exe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenWithCompile"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenWithCompile"
  DeleteRegKey HKCU "Software\Classes\*\shell\OpenWithCompile"
!macroend
