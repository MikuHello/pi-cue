$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$submitting = $false
try {
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
  $identity = Get-StartApps | Where-Object { $_.AppID -eq 'Microsoft.WindowsTerminal_8wekyb3d8bbwe!App' } | Select-Object -First 1
  if ($null -eq $identity) { [Console]::Out.Write('not-submitted'); exit 0 }
  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text></text><text></text></binding></visual><audio silent="true"/></toast>')
  $nodes = $xml.GetElementsByTagName('text')
  $null = $nodes.Item(0).AppendChild($xml.CreateTextNode([string]$payload.title))
  $null = $nodes.Item(1).AppendChild($xml.CreateTextNode([string]$payload.body))
  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
  $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($identity.AppID)
  $submitting = $true
  $notifier.Show($toast)
  [Console]::Out.Write('submitted')
} catch {
  if ($submitting) { [Console]::Out.Write('unknown') } else { [Console]::Out.Write('not-submitted') }
}
