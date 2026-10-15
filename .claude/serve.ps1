$root = Split-Path -Parent $PSScriptRoot
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add('http://localhost:5178/')
$l.Start()
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.md'='text/plain; charset=utf-8'; '.csv'='text/csv; charset=utf-8'; '.pdf'='application/pdf'; '.wasm'='application/wasm'; '.gz'='application/gzip'; '.traineddata'='application/octet-stream' }
while ($l.IsListening) {
  $c = $l.GetContext()
  $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath)
  if ($p -eq '/') { $p = '/index.html' }
  $f = Join-Path $root ($p.TrimStart('/') -replace '/', '\')
  if ((Test-Path $f -PathType Leaf) -and $f.StartsWith($root)) {
    $b = [IO.File]::ReadAllBytes($f)
    $ct = $types[[IO.Path]::GetExtension($f)]; if (-not $ct) { $ct = 'application/octet-stream' }
    $c.Response.ContentType = $ct
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}
