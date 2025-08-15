param(
  [string]$SolutionFolder = 'ImpactGanttSolution',
  [string]$PublisherName = 'ImpactPlumbing',
  [string]$PublisherPrefix = 'ip',
  [switch]$ForceInit
)

Write-Host '=== Impact Gantt Timeline Build & Pack ==='

# 1. Build PCF first (always up-to-date bundle)
Write-Host 'Building PCF (npm run build)...' -ForegroundColor Cyan
npm run build
if(!$?) { Write-Error 'npm build failed.'; exit 1 }

# 2. Ensure solution folder exists
if(!(Test-Path $SolutionFolder)) {
  Write-Host "Creating solution folder $SolutionFolder" -ForegroundColor Cyan
  New-Item -ItemType Directory -Path $SolutionFolder | Out-Null
}

# 3. Initialize solution if cdsproj missing or forced
$cdsproj = Get-ChildItem -Path $SolutionFolder -Filter '*.cdsproj' -ErrorAction SilentlyContinue | Select-Object -First 1
if($ForceInit -or -not $cdsproj) {
  Write-Host 'Initializing solution (pac solution init)...' -ForegroundColor Cyan
  pac solution init --publisher-name $PublisherName --publisher-prefix $PublisherPrefix --outputDirectory $SolutionFolder
  if(!$?) { Write-Error 'pac solution init failed.'; exit 1 }
  $cdsproj = Get-ChildItem -Path $SolutionFolder -Filter '*.cdsproj' -ErrorAction SilentlyContinue | Select-Object -First 1
}
if(-not $cdsproj) { Write-Error 'Solution .cdsproj not found after init.'; exit 1 }

# 4. Add reference to PCF project if not already added
$pcfProj = Get-ChildItem -Filter '*.pcfproj' | Select-Object -First 1
if(!$pcfProj) { Write-Error 'No .pcfproj found in root.'; exit 1 }

$refMarker = Join-Path $SolutionFolder '.pcfref'
Push-Location $SolutionFolder
if(!(Test-Path (Join-Path (Get-Location) '.pcfref'))) {
  Write-Host "Adding project reference ($($pcfProj.Name))" -ForegroundColor Cyan
  pac solution add-reference --path $pcfProj.FullName
  if(!$?) { Pop-Location; Write-Error 'pac solution add-reference failed.'; exit 1 }
  New-Item -ItemType File -Path '.pcfref' | Out-Null
}

# Determine solution content root (matches SolutionRootPath in .cdsproj, usually 'src')
$solutionContentRoot = Join-Path (Get-Location) 'src'
if(!(Test-Path $solutionContentRoot)) { Write-Error "Solution content root $solutionContentRoot missing"; exit 1 }

# Ensure Other folder and Customizations.xml (minimal) for solution packager inside content root
$otherFolder = Join-Path $solutionContentRoot 'Other'
if(!(Test-Path $otherFolder)) { New-Item -ItemType Directory -Path $otherFolder | Out-Null }
$customizationsPath = Join-Path $otherFolder 'Customizations.xml'
if(!(Test-Path $customizationsPath)) {
  Write-Host 'Creating minimal Customizations.xml (src)' -ForegroundColor Cyan
  @'
<ImportExportXml>
  <Entities />
  <Solutions />
  <Workflows />
  <PluginAssemblies />
  <CustomControls />
</ImportExportXml>
'@ | Out-File -FilePath $customizationsPath -Encoding utf8
}

# 5. Bump solution version (patch) automatically and pack with PAC (no MSBuild required)
$solutionXmlPath = Join-Path $solutionContentRoot 'Other/Solution.xml'
if(!(Test-Path $solutionXmlPath)) { Write-Error "Missing Solution.xml at $solutionXmlPath"; exit 1 }
[xml]$sol = Get-Content $solutionXmlPath
$currVer = $sol.ImportExportXml.SolutionManifest.Version
if(-not $currVer) { $currVer = '1.0.0.0' }
$parts = $currVer.Split('.')
while($parts.Count -lt 4){ $parts += '0' }
$parts[2] = ([int]$parts[2] + 1).ToString()
$newVer = ($parts -join '.')
Write-Host "Using SolutionVersion $newVer" -ForegroundColor Cyan

# Persist version bump in Solution.xml
$sol.ImportExportXml.SolutionManifest.Version = $newVer
$sol.Save($solutionXmlPath)

# 6. Pack solution zips using pac (unmanaged and managed)
Write-Host 'Packing solution (Unmanaged)...' -ForegroundColor Cyan
pac solution pack --folder $solutionContentRoot --zipfile ../ImpactGantt_Unmanaged.zip --packagetype Unmanaged
if(!$?) { Write-Error 'pac solution pack (Unmanaged) failed.'; exit 1 }

Write-Host 'Packing solution (Managed)...' -ForegroundColor Cyan
pac solution pack --folder $solutionContentRoot --zipfile ../ImpactGantt_Managed.zip --packagetype Managed
if(!$?) { Write-Error 'pac solution pack (Managed) failed.'; exit 1 }

Write-Host "Created ../ImpactGantt_Unmanaged.zip and ../ImpactGantt_Managed.zip" -ForegroundColor Green
Pop-Location

Write-Host 'Done. Files:' -ForegroundColor Green
Get-ChildItem ImpactGantt_*Managed.zip,ImpactGantt_*Unmanaged.zip | Format-Table Name,Length -AutoSize
