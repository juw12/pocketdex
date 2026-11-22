; PocketDex for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\PocketDex> /DOutputDir=<dist> /DIconFile=<build\pocketdex.ico> pocketdex.iss
; Installs to %LOCALAPPDATA%\Programs\PocketDex, adds PocketDex to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\PocketDex, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\PocketDex"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\pocketdex.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=PocketDex
AppVersion={#AppVersion}
AppVerName=PocketDex {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/pocketdex/
AppSupportURL=https://github.com/juw12/pocketdex
DefaultDirName={autopf}\PocketDex
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=PocketDex-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\PocketDex.exe
UninstallDisplayName=PocketDex
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\PocketDex"; Filename: "{app}\PocketDex.exe"; Comment: "A quiet Pokedex companion: 1025 Pokemon, a partner with feelings"
Name: "{userdesktop}\PocketDex"; Filename: "{app}\PocketDex.exe"; Comment: "A quiet Pokedex companion: 1025 Pokemon, a partner with feelings"; Tasks: desktopicon

[Run]
Filename: "{app}\PocketDex.exe"; Description: "{cm:LaunchProgram,PocketDex}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\PocketDex.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopPocketDex"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open PocketDex window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\PocketDex.exe')) then
    Exec(ExpandConstant('{app}\PocketDex.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
