# =====================================================================
# EntradasYa v1 · Crea el servidor en AWS con la AWS CLI (PowerShell)
#
#   powershell -ExecutionPolicy Bypass -File infra\scripts\create-ec2.ps1
#
# Crea (solo si no existen): key pair "entradasya" (.pem en ~/.ssh),
# security group (puertos 22 y 80), instancia Ubuntu 24.04 t3.micro con 20 GB
# y una Elastic IP asociada. Se puede ejecutar varias veces sin duplicar nada.
# Requisitos: AWS CLI v2 instalada y configurada (aws configure).
# =====================================================================
param(
  [string]$Region = "us-east-2",
  [string]$Name = "entradasya",
  [string]$InstanceType = "t3.micro",
  [int]$DiskGB = 20
)
$ErrorActionPreference = "Stop"

function Invoke-AwsCli {
  # Ejecuta la AWS CLI y devuelve la salida en texto; si falla, detiene el script.
  $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"   # avisos en stderr no detienen el script
  $out = & aws.exe @args --region $Region --output text 2>&1
  $ErrorActionPreference = $prev
  if ($LASTEXITCODE -ne 0) { throw "Falló: aws $($args -join ' ')`n$out" }
  return ($out | Out-String).Trim()
}
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  throw "No se encontró la AWS CLI. Instálala con: winget install -e --id Amazon.AWSCLI  (y abre una terminal nueva)"
}

Step "Comprobando credenciales de AWS"
$account = Invoke-AwsCli sts get-caller-identity --query Account
Write-Host "   Cuenta: $account · Región: $Region"

# --- Key pair -----------------------------------------------------------
Step "Key pair '$Name'"
$sshDir = Join-Path $env:USERPROFILE ".ssh"
New-Item -ItemType Directory -Force $sshDir | Out-Null
$pem = Join-Path $sshDir "$Name.pem"
$keyExists = (Invoke-AwsCli ec2 describe-key-pairs --filters "Name=key-name,Values=$Name" --query "KeyPairs[0].KeyName") -ne "None"
if (-not $keyExists) {
  $material = Invoke-AwsCli ec2 create-key-pair --key-name $Name --key-type rsa --key-format pem --query KeyMaterial
  [System.IO.File]::WriteAllText($pem, ($material -replace "`r", "") + "`n")
  icacls $pem /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null
  Write-Host "   Creada y guardada en $pem"
} elseif (Test-Path $pem) {
  Write-Host "   Ya existe ($pem)"
} else {
  throw "El key pair '$Name' existe en AWS pero no tienes el archivo $pem. Bórralo en EC2 > Key pairs y vuelve a ejecutar."
}

# --- Security group -----------------------------------------------------
Step "Security group (puertos 22 SSH y 80 HTTP)"
$sg = Invoke-AwsCli ec2 describe-security-groups --filters "Name=group-name,Values=$Name" --query "SecurityGroups[0].GroupId"
if ($sg -eq "None") {
  $sg = Invoke-AwsCli ec2 create-security-group --group-name $Name --description "EntradasYa v1: SSH y HTTP" --query GroupId
  foreach ($port in 22, 80) {
    Invoke-AwsCli ec2 authorize-security-group-ingress --group-id $sg --protocol tcp --port $port --cidr 0.0.0.0/0 | Out-Null
  }
  Write-Host "   Creado: $sg"
} else {
  Write-Host "   Ya existe: $sg"
}

# --- Instancia ----------------------------------------------------------
Step "Instancia EC2 '$Name'"
$instance = Invoke-AwsCli ec2 describe-instances `
  --filters "Name=tag:Name,Values=$Name" "Name=instance-state-name,Values=pending,running,stopping,stopped" `
  --query "Reservations[0].Instances[0].InstanceId"
if ($instance -eq "None") {
  try {
    $ami = Invoke-AwsCli ssm get-parameter --name "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id" --query Parameter.Value
  } catch {
    # Si SSM no está permitido, se busca la AMI oficial de Canonical directamente en EC2
    $ami = Invoke-AwsCli ec2 describe-images --owners 099720109477 `
      --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*" "Name=state,Values=available" `
      --query "sort_by(Images,&CreationDate)[-1].ImageId"
  }
  Write-Host "   AMI Ubuntu 24.04: $ami"
  $instance = Invoke-AwsCli ec2 run-instances --image-id $ami --instance-type $InstanceType --key-name $Name `
    --security-group-ids $sg `
    --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=$DiskGB,VolumeType=gp3,DeleteOnTermination=true}" `
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$Name}]" `
    --query "Instances[0].InstanceId"
  Write-Host "   Creada: $instance"
} else {
  Write-Host "   Ya existe: $instance"
  $state = Invoke-AwsCli ec2 describe-instances --instance-ids $instance --query "Reservations[0].Instances[0].State.Name"
  if ($state -eq "stopped") { Invoke-AwsCli ec2 start-instances --instance-ids $instance | Out-Null; Write-Host "   Estaba detenida: encendiendo" }
}
Write-Host "   Esperando a que esté 'running'..."
Invoke-AwsCli ec2 wait instance-running --instance-ids $instance | Out-Null

# --- Elastic IP ---------------------------------------------------------
Step "Elastic IP"
$alloc = Invoke-AwsCli ec2 describe-addresses --filters "Name=tag:Name,Values=$Name" --query "Addresses[0].AllocationId"
if ($alloc -eq "None") {
  $alloc = Invoke-AwsCli ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$Name}]" --query AllocationId
}
Invoke-AwsCli ec2 associate-address --instance-id $instance --allocation-id $alloc --allow-reassociation | Out-Null
$ip = Invoke-AwsCli ec2 describe-addresses --allocation-ids $alloc --query "Addresses[0].PublicIp"
Set-Content -Path (Join-Path $PSScriptRoot "..\..\.ec2-ip") -Value $ip -Encoding ascii

Write-Host "`n✅ Servidor listo" -ForegroundColor Green
Write-Host @"

   Instancia:  $instance ($InstanceType, $Region)
   IP pública: $ip
   Llave:      $pem

   Siguiente (espera ~1 minuto a que arranque SSH):
     scp -i "$pem" infra\scripts\setup-server.sh ubuntu@${ip}:~
     ssh -i "$pem" ubuntu@$ip "sudo bash setup-server.sh"

   Secretos en GitHub (Settings > Secrets and variables > Actions):
     EC2_HOST    = $ip
     EC2_USER    = ubuntu
     EC2_SSH_KEY = contenido de $pem   (Get-Content "$pem" -Raw | Set-Clipboard)

   Apagar para no gastar:   aws ec2 stop-instances  --instance-ids $instance --region $Region
   Encender:                aws ec2 start-instances --instance-ids $instance --region $Region
"@
