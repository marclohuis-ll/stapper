# Genereert de app-iconen. Geen ontwerptool op deze machine, dus met GDI+.
# Het merk uit het ontwerp: een lime afgeronde vierkant met een donkere boom.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\make-icons.ps1

Add-Type -AssemblyName System.Drawing

$out = Join-Path (Split-Path -Parent $PSScriptRoot) 'icons'
New-Item -ItemType Directory -Force $out | Out-Null

$lime = [System.Drawing.Color]::FromArgb(201, 242, 110)
$ink  = [System.Drawing.Color]::FromArgb(12, 26, 23)

function New-Icon {
  param([int]$Size, [string]$Path, [double]$Inset = 0.20, [double]$Radius = 0.23)

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear($ink)

  # Afgeronde lime plaat. Bij een maskable icoon is Radius 0.5 (volledig rond
  # gevuld vlak) zodat Android er elke vorm uit kan snijden.
  $r = [int]($Size * $Radius)
  $plate = New-Object System.Drawing.Drawing2D.GraphicsPath
  if ($Radius -ge 0.5) {
    $plate.AddRectangle((New-Object System.Drawing.RectangleF(0, 0, $Size, $Size)))
  } else {
    $m = [int]($Size * 0.06)
    $w = $Size - 2 * $m
    $plate.AddArc($m, $m, 2*$r, 2*$r, 180, 90)
    $plate.AddArc($m + $w - 2*$r, $m, 2*$r, 2*$r, 270, 90)
    $plate.AddArc($m + $w - 2*$r, $m + $w - 2*$r, 2*$r, 2*$r, 0, 90)
    $plate.AddArc($m, $m + $w - 2*$r, 2*$r, 2*$r, 90, 90)
    $plate.CloseFigure()
  }
  $g.FillPath((New-Object System.Drawing.SolidBrush($lime)), $plate)

  # Boom: twee overlappende driehoeken plus een stam.
  $c = $Size / 2.0
  $h = $Size * (1 - 2 * $Inset)          # hoogte van het motief
  $top = $c - $h / 2
  $brush = New-Object System.Drawing.SolidBrush($ink)

  $wTop = $h * 0.52
  $tri1 = @(
    (New-Object System.Drawing.PointF([float]$c,           [float]$top)),
    (New-Object System.Drawing.PointF([float]($c - $wTop/2), [float]($top + $h*0.44))),
    (New-Object System.Drawing.PointF([float]($c + $wTop/2), [float]($top + $h*0.44)))
  )
  $wBot = $h * 0.72
  $tri2 = @(
    (New-Object System.Drawing.PointF([float]$c,           [float]($top + $h*0.22))),
    (New-Object System.Drawing.PointF([float]($c - $wBot/2), [float]($top + $h*0.76))),
    (New-Object System.Drawing.PointF([float]($c + $wBot/2), [float]($top + $h*0.76)))
  )
  $g.FillPolygon($brush, $tri1)
  $g.FillPolygon($brush, $tri2)

  $tw = $h * 0.13
  $g.FillRectangle($brush, [float]($c - $tw/2), [float]($top + $h*0.72),
                           [float]$tw, [float]($h * 0.28))

  $g.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ("{0}  ({1} bytes)" -f (Split-Path -Leaf $Path), (Get-Item $Path).Length)
}

New-Icon -Size 192 -Path (Join-Path $out 'icon-192.png')
New-Icon -Size 512 -Path (Join-Path $out 'icon-512.png')
New-Icon -Size 180 -Path (Join-Path $out 'apple-touch-icon.png')
# Maskable: vol vlak en meer lucht rond het motief, want Android snijdt eruit.
New-Icon -Size 512 -Path (Join-Path $out 'icon-512-maskable.png') -Inset 0.30 -Radius 0.5
