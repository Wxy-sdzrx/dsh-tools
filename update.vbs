' BianjieTools updater launcher -- no console window.
'
' Why a .vbs instead of a .bat:
'   Windows runs .bat via cmd.exe, which always creates a console window;
'   the user sees a black box flash (or stay open for the whole update).
'   .vbs is run by wscript.exe, a GUI host that creates NO console at all.
'   The script also passes window-mode 0 (hidden) to the powershell it starts.
'   Kept ASCII-only on purpose: wscript reads .vbs as ANSI.
'
' The plugin launches this file via wps.OAAssist.ShellExecute.
' Measured: ShellExecute(powershell.exe, args) and ShellExecute(url scheme)
' both throw in WPS, so a plain file path is the only form that works.
' update.bat is kept as a last-resort fallback.
'
Dim sh, base
Set sh = CreateObject("WScript.Shell")
base = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & base & "updater.ps1""", 0, False
