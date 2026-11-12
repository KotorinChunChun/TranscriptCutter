#ifndef Version
  #error Version is required
#endif
#ifndef SourceDir
  #error SourceDir is required
#endif
#ifdef AllInOne
  #define ProductLabel "TranscriptCutter 完全一体版"
  #define ProductFolder "TranscriptCutter-AllInOne"
  #define ProductId "TranscriptCutter-AllInOne-User"
  #define OutputName "TranscriptCutter-AllInOne-Setup-v" + Version
#else
  #define ProductLabel "TranscriptCutter"
  #define ProductFolder "TranscriptCutter"
  #define ProductId "TranscriptCutter-Web-User"
  #define OutputName "TranscriptCutter-Setup-v" + Version
#endif

[Setup]
AppId={#ProductId}
AppName={#ProductLabel}
AppVersion={#Version}
AppVerName={#ProductLabel} v{#Version}
VersionInfoVersion={#Version}.0
DefaultDirName={localappdata}\Programs\{#ProductFolder}
DefaultGroupName={#ProductLabel}
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename={#OutputName}
Compression=lzma2/normal
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\TranscriptCutter.exe
CloseApplications=no
RestartApplications=no
DisableProgramGroupPage=yes
SetupLogging=yes
MinVersion=10.0

[Languages]
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#ProductLabel}"; Filename: "{app}\TranscriptCutter.exe"; WorkingDir: "{app}"

[Run]
Filename: "{app}\TranscriptCutter.exe"; WorkingDir: "{app}"; Description: "{#ProductLabel}を起動する"; Flags: nowait postinstall skipifsilent

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
#ifdef AllInOne
  if FileExists(ExpandConstant('{app}\TranscriptCutter.exe')) and
     not FileExists(ExpandConstant('{app}\TranscriptCutter.bundle.json')) then
    Result := '通常版と異なるインストール先を選択してください。';
#else
  if FileExists(ExpandConstant('{app}\TranscriptCutter.bundle.json')) then
    Result := '完全一体版と異なるインストール先を選択してください。';
#endif
end;
