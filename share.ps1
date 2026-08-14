<#
    เปิดให้เครื่องอื่นเข้าใช้ระบบบัญชี
    ------------------------------------------------------------------
    วิธีใช้ (คลิกขวาที่ PowerShell แล้วเลือก Run as Administrator)

        .\share.ps1                 ตรวจสถานะและแสดงลิงก์ที่ใช้แชร์ได้
        .\share.ps1 -OpenFirewall   เปิดพอร์ต 3100 ให้เครื่องในวงแลนเดียวกัน
        .\share.ps1 -CloseFirewall  ปิดพอร์ตกลับเหมือนเดิม
#>

param(
    [switch]$OpenFirewall,
    [switch]$CloseFirewall
)

$RuleName = 'ระบบบัญชี Demo (พอร์ต 3100)'
$Port     = 3100

function Write-Head($text) {
    Write-Host ''
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host ('  ' + ('─' * 62)) -ForegroundColor DarkGray
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ─── ปิดพอร์ต ────────────────────────────────────────────────────────
if ($CloseFirewall) {
    if (-not (Test-Admin)) {
        Write-Host 'ต้องเปิด PowerShell แบบ Run as Administrator ก่อน' -ForegroundColor Red
        exit 1
    }
    Remove-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
    Write-Host 'ปิดพอร์ต 3100 เรียบร้อย เครื่องอื่นจะเข้าไม่ได้แล้ว' -ForegroundColor Green
    exit 0
}

# ─── เปิดพอร์ต ───────────────────────────────────────────────────────
if ($OpenFirewall) {
    if (-not (Test-Admin)) {
        Write-Host 'ต้องเปิด PowerShell แบบ Run as Administrator ก่อน' -ForegroundColor Red
        Write-Host 'คลิกขวาที่ไอคอน PowerShell แล้วเลือก "Run as administrator"' -ForegroundColor Yellow
        exit 1
    }
    Remove-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName $RuleName `
        -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port `
        -Profile Any `
        -RemoteAddress LocalSubnet `
        -Description 'อนุญาตเฉพาะเครื่องในวงเครือข่ายเดียวกัน เข้าใช้ระบบบัญชีสาธิต' | Out-Null
    Write-Host ''
    Write-Host '  เปิดพอร์ต 3100 เรียบร้อย' -ForegroundColor Green
    Write-Host '  อนุญาตเฉพาะเครื่องที่อยู่ในวงเครือข่ายเดียวกันเท่านั้น' -ForegroundColor DarkGray
}

# ─── รายงานสถานะ ─────────────────────────────────────────────────────
Write-Head 'สถานะระบบ'

$running = $false
try {
    $ps = docker compose ps --format '{{.Name}}|{{.Status}}' 2>$null
    if ($ps) {
        foreach ($line in $ps) {
            $parts = $line -split '\|'
            $ok = $parts[1] -match 'healthy'
            $color = if ($ok) { 'Green' } else { 'Yellow' }
            Write-Host ('    {0,-16} {1}' -f $parts[0], $parts[1]) -ForegroundColor $color
            if ($parts[0] -eq 'accounting-web' -and $ok) { $running = $true }
        }
    } else {
        Write-Host '    ยังไม่ได้เปิดระบบ' -ForegroundColor Yellow
    }
} catch {
    Write-Host '    เรียก docker ไม่ได้ — ตรวจว่า Docker Desktop เปิดอยู่' -ForegroundColor Red
}

if (-not $running) {
    Write-Host ''
    Write-Host '    เปิดระบบก่อนด้วยคำสั่ง:  docker compose up -d --build' -ForegroundColor Yellow
}

# ─── ที่อยู่สำหรับแชร์ ─────────────────────────────────────────────────
Write-Head 'ลิงก์สำหรับเปิดใช้งาน'

Write-Host '    เครื่องนี้เท่านั้น' -ForegroundColor White
Write-Host '      http://localhost:3100' -ForegroundColor Green

$lan = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
        $_.IPAddress -notlike '127.*' -and
        $_.IPAddress -notlike '169.254.*' -and
        $_.IPAddress -notlike '100.*' -and
        $_.InterfaceAlias -notlike '*WSL*' -and
        $_.InterfaceAlias -notlike '*vEthernet*' -and
        $_.PrefixOrigin -eq 'Dhcp'
    } | Select-Object -First 1

if ($lan) {
    Write-Host ''
    Write-Host '    เครื่องอื่นในออฟฟิศ/วงไวไฟเดียวกัน' -ForegroundColor White
    Write-Host ("      http://{0}:{1}" -f $lan.IPAddress, $Port) -ForegroundColor Green
}

$tsExe = 'C:\Program Files\Tailscale\tailscale.exe'
if (Test-Path $tsExe) {
    $tsIp = (& $tsExe ip -4 2>$null | Select-Object -First 1)
    if ($tsIp) {
        Write-Host ''
        Write-Host '    เครื่องที่เชื่อม Tailscale เดียวกัน (ข้ามออฟฟิศได้)' -ForegroundColor White
        Write-Host ("      http://{0}:{1}" -f $tsIp.Trim(), $Port) -ForegroundColor Green
    }
}

# ─── สถานะไฟร์วอลล์ ──────────────────────────────────────────────────
Write-Head 'ไฟร์วอลล์'

$rule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if ($rule) {
    Write-Host '    เปิดพอร์ต 3100 ไว้แล้ว เครื่องในวงเดียวกันเข้าได้' -ForegroundColor Green
} else {
    Write-Host '    ยังไม่ได้เปิดพอร์ต — เครื่องอื่นจะเข้าไม่ได้' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '    เปิดด้วยคำสั่งนี้ (ต้อง Run as Administrator):' -ForegroundColor White
    Write-Host '      .\share.ps1 -OpenFirewall' -ForegroundColor Cyan
}

$profiles = Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' }
if ($profiles) {
    Write-Host ''
    Write-Host ('    หมายเหตุ: เครือข่าย {0} ตั้งเป็นแบบ Public' -f ($profiles.InterfaceAlias -join ', ')) -ForegroundColor DarkGray
    Write-Host '    กฎที่สคริปต์นี้สร้างครอบคลุมแล้ว ไม่ต้องเปลี่ยนเป็น Private' -ForegroundColor DarkGray
}

# ─── คำเตือน ─────────────────────────────────────────────────────────
Write-Head 'ข้อควรรู้ก่อนแชร์'
Write-Host '    การเชื่อมต่อเป็น http ธรรมดา ไม่ได้เข้ารหัส' -ForegroundColor Yellow
Write-Host '    เหมาะกับการสาธิตในวงเครือข่ายที่ไว้ใจได้เท่านั้น' -ForegroundColor DarkGray
Write-Host '    ห้ามใส่ข้อมูลจริงของกิจการ และห้ามเปิดออกอินเทอร์เน็ตตรง ๆ' -ForegroundColor DarkGray
Write-Host ''
Write-Host '    ถ้าต้องการให้คนนอกออฟฟิศเข้าได้ ให้ใช้ Tailscale หรือ Cloudflare Tunnel' -ForegroundColor DarkGray
Write-Host '    อ่านวิธีทำที่ docs\getting-started.md หัวข้อ 3' -ForegroundColor DarkGray
Write-Host ''
