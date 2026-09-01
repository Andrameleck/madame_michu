# Equivalent Windows de tools/package.sh : cette machine n'a pas `zip`.
#
# Compress-Archive n'est pas utilise ici : sous Windows PowerShell 5.1 il ecrit
# les noms d'entrees avec des antislashs, ce qu'un XPI ne tolere pas. On passe
# donc par ZipArchive, en imposant nous-memes le separateur.
#
#   .\tools\package.ps1                        -> empaquette manifest.json
#   .\tools\package.ps1 -Manifest manifest.next.json -Suffix next

[CmdletBinding()]
param(
  [string]$Manifest = "manifest.json",
  [string]$Suffix = ""
)

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location $projectDir

$manifestPath = Join-Path $projectDir $Manifest
if (-not (Test-Path $manifestPath)) { throw "Manifeste introuvable : $Manifest" }

$manifestJson = Get-Content $manifestPath -Raw | ConvertFrom-Json
$version = $manifestJson.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Version de manifeste invalide : $version" }

# Les dossiers a embarquer sont deduits du manifeste : un background dans src/
# signale la version 2, sinon on reprend l'arborescence historique.
$isNextLayout = $manifestJson.background.scripts[0] -like "src/*"
$payload = if ($isNextLayout) {
  @("src", "icons", "experiments")
} else {
  @("background", "calendar", "llm", "utils", "ui", "icons", "experiments")
}
$rootFiles = @("LICENSE", "PRIVACY.md")

$name = "madame-michu-$version" + $(if ($Suffix) { "-$Suffix" } else { "" }) + ".xpi"
$archivePath = Join-Path $projectDir "dist\$name"
New-Item -ItemType Directory -Force (Join-Path $projectDir "dist") | Out-Null
if (Test-Path $archivePath) { Remove-Item $archivePath -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Fichiers exclus de l'archive : ils ne servent qu'a l'outillage Node.
$excluded = @("package.json")

$stream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::CreateNew)
$zip = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  # Le manifeste est toujours ecrit sous le nom manifest.json, quel que soit
  # le fichier source : c'est le seul nom que Thunderbird lit.
  $entry = $zip.CreateEntry("manifest.json", [System.IO.Compression.CompressionLevel]::Optimal)
  $writer = New-Object System.IO.StreamWriter($entry.Open())
  $writer.Write([System.IO.File]::ReadAllText($manifestPath))
  $writer.Dispose()

  $files = @()
  foreach ($file in $rootFiles) {
    if (Test-Path $file) { $files += Get-Item $file }
  }
  foreach ($directory in $payload) {
    if (-not (Test-Path $directory)) { throw "Dossier absent du depot : $directory" }
    $files += Get-ChildItem $directory -Recurse -File
  }

  foreach ($file in $files) {
    if ($excluded -contains $file.Name -and $file.Directory.FullName -ne $projectDir) { continue }
    $relative = $file.FullName.Substring($projectDir.Length + 1).Replace("\", "/")
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, $file.FullName, $relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
  $stream.Dispose()
}

$hash = (Get-FileHash $archivePath -Algorithm SHA256).Hash.ToLower()
$size = [math]::Round((Get-Item $archivePath).Length / 1KB, 1)
Write-Output "$archivePath  ($size Ko)"
Write-Output "sha256: $hash"
