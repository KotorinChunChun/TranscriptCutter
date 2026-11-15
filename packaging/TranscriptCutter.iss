#ifndef Version
  #error Version is required
#endif
#ifndef SourceDir
  #error SourceDir is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif

[Setup]
AppId=TranscriptCutter-Unified-User
AppName=TranscriptCutter
AppVersion={#Version}
AppVerName=TranscriptCutter v{#Version}
VersionInfoVersion={#Version}.0
DefaultDirName={localappdata}\Programs\TranscriptCutter
DefaultGroupName=TranscriptCutter
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=TranscriptCutter-v{#Version}-setup-x64
Compression=lzma2/normal
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\TranscriptCutter.exe
CloseApplications=no
RestartApplications=no
DisableProgramGroupPage=yes
SetupLogging=yes
MinVersion=10.0
InfoAfterFile=client-connection.txt

[Languages]
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"

[Files]
Source: "{#SourceDir}\TranscriptCutter.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "client-connection.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\TranscriptCutter"; Filename: "{app}\TranscriptCutter.exe"; WorkingDir: "{app}"
Name: "{group}\TranscriptCutter サーバーを起動"; Filename: "{app}\TranscriptCutter.exe"; Parameters: "--server"; WorkingDir: "{app}"
Name: "{userdesktop}\TranscriptCutter サーバーを起動"; Filename: "{app}\TranscriptCutter.exe"; Parameters: "--server"; WorkingDir: "{app}"
Name: "{group}\クライアントからの接続方法"; Filename: "{app}\client-connection.txt"

; No Run/InstallDelete/UninstallDelete entries: programs are installed only.
; Recognition data remains outside {app}, under the launcher's dedicated state directory.
