$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$playing = $false
try {
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($payload.system) {
    $playing = $true
    [System.Media.SystemSounds]::Asterisk.Play()
    Start-Sleep -Milliseconds 600
  } else {
    $player = [System.Media.SoundPlayer]::new([string]$payload.path)
    $player.Load()
    $playing = $true
    $player.PlaySync()
    $player.Dispose()
  }
  [Console]::Out.Write('played')
} catch {
  if ($playing) { [Console]::Out.Write('unknown') } else { [Console]::Out.Write('not-started') }
}
