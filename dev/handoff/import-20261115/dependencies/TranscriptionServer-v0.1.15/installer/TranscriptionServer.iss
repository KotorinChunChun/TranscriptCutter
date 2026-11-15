#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef BundleDir
  #error BundleDir is required
#endif
#ifndef ReleaseDir
  #error ReleaseDir is required
#endif

[Setup]
#ifdef AcceptanceBuild
AppId={{1F122A77-AD76-4C10-B041-E010B942A412}
AppName=TranscriptionServer 検証候補
DefaultGroupName=TranscriptionServer 検証候補
AppMutex=Local\TranscriptionServer.AcceptanceSetup
DefaultDirName={localappdata}\Programs\TranscriptionServer-Acceptance
OutputBaseFilename=TranscriptionServer-v{#AppVersion}-candidate-setup-x64
#else
AppId={{6C0A7E36-24C5-4D67-8D18-0677E953741B}
AppName=TranscriptionServer
DefaultGroupName=TranscriptionServer
; PrepareToInstall performs an owned normal shutdown instead of a blind mutex prompt.
DefaultDirName={localappdata}\Programs\TranscriptionServer
OutputBaseFilename=TranscriptionServer-v{#AppVersion}-setup-x64
#endif
AppVersion={#AppVersion}
AppPublisher=i1643
AppPublisherURL=https://github.com/i1643/TranscriptionServer
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#ReleaseDir}
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
ShowLanguageDialog=no
CloseApplications=no
RestartApplications=no
UninstallDisplayIcon={app}\TranscriptionServer.exe
SetupLogging=yes
VersionInfoVersion={#AppVersion}

[Languages]
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"

[Tasks]
Name: "desktopicon"; Description: "デスクトップにサーバー起動ショートカットを作成"

[Files]
Source: "{#BundleDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "INSTALLATION.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#BundleDir}\TranscriptionServer.exe"; DestName: "TranscriptionSetupControl.exe"; Flags: dontcopy

[Icons]
#ifndef AcceptanceBuild
Name: "{group}\TranscriptionServer"; Filename: "{app}\TranscriptionServer.exe"; Parameters: "--installed --open"; WorkingDir: "{app}"
Name: "{group}\クライアント接続方法"; Filename: "{app}\TranscriptionServer.exe"; Parameters: "--installed --connection-guide"; WorkingDir: "{app}"
Name: "{autodesktop}\TranscriptionServer"; Filename: "{app}\TranscriptionServer.exe"; Parameters: "--installed --open"; WorkingDir: "{app}"; Tasks: desktopicon
#endif

[Run]
#ifndef AcceptanceBuild
Filename: "{app}\TranscriptionServer.exe"; Parameters: "--installed --connection-guide"; Description: "サーバーを起動してクライアント接続方法を表示"; Flags: nowait postinstall skipifsilent
#endif

[InstallDelete]
; Remove only the retired application-owned transcription UI files.
Type: files; Name: "{app}\dist\app.js"
Type: files; Name: "{app}\dist\browser-transcriber.mjs"
Type: files; Name: "{app}\dist\connection-profiles.mjs"
Type: files; Name: "{app}\dist\diarization-worker.js"
Type: files; Name: "{app}\dist\engine-catalog.mjs"
Type: files; Name: "{app}\dist\index.html"
Type: files; Name: "{app}\dist\job-timing.mjs"
Type: files; Name: "{app}\dist\local-client.mjs"
Type: files; Name: "{app}\dist\operations.mjs"
Type: files; Name: "{app}\dist\speaker-edits.mjs"
Type: files; Name: "{app}\dist\speaker-utils.mjs"
Type: files; Name: "{app}\dist\styles.css"
Type: files; Name: "{app}\dist\transcript-navigation.mjs"
Type: files; Name: "{app}\dist\transcript-utils.mjs"
Type: files; Name: "{app}\dist\updates.mjs"
Type: files; Name: "{app}\dist\vendor\LICENSE-jinja.txt"
Type: files; Name: "{app}\dist\vendor\LICENSE-onnxruntime.txt"
Type: files; Name: "{app}\dist\vendor\LICENSE-tokenizers.txt"
Type: files; Name: "{app}\dist\vendor\LICENSE-transformers.txt"
Type: files; Name: "{app}\dist\vendor\THIRD-PARTY-NOTICES-onnxruntime.txt"
Type: files; Name: "{app}\dist\vendor\THIRD-PARTY-NOTICES.md"
Type: files; Name: "{app}\dist\vendor\nemotron-build-package-lock.json"
Type: files; Name: "{app}\dist\vendor\nemotron-transformers-4993a4d3.js"
Type: files; Name: "{app}\dist\whisper-models.mjs"
Type: files; Name: "{app}\dist\worker.js"
Type: filesandordirs; Name: "{app}\_internal"; Check: IsLegacyPython
Type: files; Name: "{app}\TranscriptionUpdater.exe"; Check: IsLegacyPython

; No data/config/runtime directories are removed on uninstall.

[Code]
var
  WaitingForServer: Boolean;
  StopReport, StopCancel: String;
  InstallFence: THandle;

function CreateMutex(lpMutexAttributes: Integer; bInitialOwner: Boolean; lpName: String): THandle;
  external 'CreateMutexW@kernel32.dll stdcall';
function CloseHandle(hObject: THandle): Boolean;
  external 'CloseHandle@kernel32.dll stdcall';
function OpenProcess(dwDesiredAccess: LongWord; bInheritHandle: Boolean; dwProcessId: LongWord): THandle;
  external 'OpenProcess@kernel32.dll stdcall';
function WaitForSingleObject(hHandle: THandle; dwMilliseconds: LongWord): LongWord;
  external 'WaitForSingleObject@kernel32.dll stdcall';
function GetExitCodeProcess(hProcess: THandle; var lpExitCode: LongWord): Boolean;
  external 'GetExitCodeProcess@kernel32.dll stdcall';

procedure CancelButtonClick(CurPageID: Integer; var Cancel, Confirm: Boolean);
begin
  if WaitingForServer then begin
    SaveStringToFile(StopCancel, 'cancel', False);
    Cancel := False; Confirm := False;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var Progress: TOutputProgressWizardPage; Pid: Integer; Process: THandle;
    Raw: AnsiString; Compact: String; ExitCode: LongWord;
begin
  Result := '';
#ifndef AcceptanceBuild
  if InstallFence <> 0 then Exit;
  ExtractTemporaryFile('TranscriptionSetupControl.exe');
  StopReport := ExpandConstant('{tmp}\server-stop.json');
  StopCancel := ChangeFileExt(StopReport, '.cancel');
  DeleteFile(StopReport); DeleteFile(StopCancel);
  Progress := CreateOutputProgressPage('サーバーの更新準備', '受付済み処理の完了と正常終了を待っています。強制終了は行いません。');
  Progress.Show;
  WaitingForServer := True;
  Process := 0;
  try
    if not Exec(ExpandConstant('{tmp}\TranscriptionSetupControl.exe'),
      '__prepare-setup "' + ExpandConstant('{app}') + '" "' + StopReport + '"', '', SW_HIDE, ewNoWait, Pid) then begin
      Result := '正常停止ヘルパーを開始できません。'; Exit;
    end;
    Process := OpenProcess($00101000, False, Pid);
    repeat
      Progress.SetProgress(0, 1);
      Sleep(200);
      if Process <> 0 then begin
        if WaitForSingleObject(Process, 0) = 0 then Break;
      end else if FileExists(StopReport) then Break;
    until False;
    if Process <> 0 then begin
      if not GetExitCodeProcess(Process, ExitCode) or (ExitCode <> 0) then begin
        Result := 'サーバーを正常停止できませんでした。更新を続行しません。';
        if LoadStringFromFile(StopReport, Raw) then Result := Result + #13#10 + String(Raw);
        Exit;
      end;
    end;
    if not LoadStringFromFile(StopReport, Raw) then begin
      Result := '停止確認の記録がありません。更新を続行しません。'; Exit;
    end;
    Compact := String(Raw); StringChangeEx(Compact, ' ', '', True);
    if Pos('"state":"complete"', Compact) = 0 then begin
      Result := 'サーバーの停止未確認または更新取消です。' + #13#10 + String(Raw); Exit;
    end;
    if FileExists(StopCancel) then begin Result := '更新を取り消しました。'; Exit; end;
    { Fence normal installed starts during file replacement. }
    if CheckForMutexes('Local\TranscriptionServer.Installed') then begin
      Result := '別のサーバーが起動しました。更新を再実行してください。'; Exit;
    end;
    InstallFence := CreateMutex(0, False, 'Local\TranscriptionServer.Installed');
    if (InstallFence <> 0) and (DLLGetLastError = 183) then begin
      CloseHandle(InstallFence); InstallFence := 0;
      Result := '別のサーバーが起動しました。更新を再実行してください。';
    end else if InstallFence = 0 then Result := '更新中の起動抑止を確保できません。';
  finally
    if Process <> 0 then CloseHandle(Process);
    WaitingForServer := False; Progress.Hide;
  end;
#endif
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and (InstallFence <> 0) then begin
    CloseHandle(InstallFence); InstallFence := 0;
  end;
end;

procedure DeinitializeSetup();
begin
  if InstallFence <> 0 then CloseHandle(InstallFence);
end;

function IsLegacyPython(): Boolean;
var Build: AnsiString;
begin
  Result := False;
  if LoadStringFromFile(ExpandConstant('{app}\BUILD.json'), Build) then
    Result := (Pos('"runtime": "rust"', String(Build)) = 0) and
      ((Pos('"version": "4.1.0"', String(Build)) > 0) or (Pos('"version": "4.2.0"', String(Build)) > 0));
end;

function VersionPart(var Value: String): Integer;
var P: Integer; Part: String;
begin
  P := Pos('.', Value);
  if P = 0 then begin Part := Value; Value := ''; end
  else begin Part := Copy(Value, 1, P-1); Delete(Value, 1, P); end;
  Result := StrToIntDef(Part, 0);
end;

function InitializeSetup(): Boolean;
var Current, Incoming: String; I, A, B: Integer;
begin
  Result := True;
#ifdef AcceptanceBuild
  if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{1F122A77-AD76-4C10-B041-E010B942A412}_is1', 'DisplayVersion', Current) then begin
#else
  if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{6C0A7E36-24C5-4D67-8D18-0677E953741B}_is1', 'DisplayVersion', Current) then begin
#endif
    Incoming := '{#AppVersion}';
    { v0.1.0 is the explicitly authorized Rust generation, replacing Python v4. }
    if ((Incoming = '0.1.0') or (Incoming = '0.2.0')) and ((Current = '4.1.0') or (Current = '4.2.0')) then Exit;
    for I := 1 to 4 do begin
      A := VersionPart(Current); B := VersionPart(Incoming);
      if A > B then begin
        SuppressibleMsgBox('新しい版がインストールされています。旧版による上書きはできません。', mbError, MB_OK, IDOK);
        Result := False; Exit;
      end;
      if A < B then Exit;
    end;
  end;
end;
