#!/bin/bash
# İNCELEME TASLAĞI — çalışan bir dağıtım yolu değildir.
# aws_deployment_architecture.md dosyasındaki eksikleri okuyun.
# Koruma: ağ, kaynak oluşturma, paket kurma ve servis değişikliğinden önce durur.
printf '%s\n' 'Bu AWS taslağı devre dışıdır; canlı dağıtım ayrı tasarım ve doğrulama gerektirir.' >&2
exit 1

# Aşağısı yalnız mimari inceleme için korunmuştur.
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
PROJECT="ecommerce-free"
ADMIN_IP=$(curl -s https://api.ipify.org)/32

echo "╔══════════════════════════════════════════════╗"
echo "║   AWS Dağıtım Taslağı E-Ticaret Kurulumu         ║"
echo "╚══════════════════════════════════════════════╝"
echo "Bölge: $AWS_REGION | Admin IP: $ADMIN_IP"
echo ""

# ─────────────────────────────────────────────────────────────────────────
# ADIM 1: VPC ve Alt Ağ (Taslak)
# ─────────────────────────────────────────────────────────────────────────
echo "📦 [1/5] VPC ve Ağ Yapılandırılıyor..."

VPC_ID=$(aws ec2 create-vpc \
  --cidr-block 10.0.0.0/16 \
  --region "$AWS_REGION" \
  --query 'Vpc.VpcId' --output text)

aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames
aws ec2 create-tags --resources "$VPC_ID" --tags Key=Name,Value="${PROJECT}-vpc"

# Tek bir Public Subnet (Hem EC2 hem RDS için ama RDS dış dünyaya kapalı olacak!)
SUBNET_A=$(aws ec2 create-subnet \
  --vpc-id "$VPC_ID" \
  --cidr-block 10.0.1.0/24 \
  --availability-zone "${AWS_REGION}a" \
  --query 'Subnet.SubnetId' --output text)
aws ec2 create-tags --resources "$SUBNET_A" --tags Key=Name,Value="${PROJECT}-subnet-1a"

# RDS DB Grubu için ikinci bir subnet zorunlu (RDS kuralı) fiyatlandırma ayrıca değerlendirilir.
SUBNET_B=$(aws ec2 create-subnet \
  --vpc-id "$VPC_ID" \
  --cidr-block 10.0.2.0/24 \
  --availability-zone "${AWS_REGION}b" \
  --query 'Subnet.SubnetId' --output text)
aws ec2 create-tags --resources "$SUBNET_B" --tags Key=Name,Value="${PROJECT}-subnet-1b"

# Internet Gateway
IGW_ID=$(aws ec2 create-internet-gateway --query 'InternetGateway.InternetGatewayId' --output text)
aws ec2 attach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"

# Route Table
RT_ID=$(aws ec2 create-route-table --vpc-id "$VPC_ID" --query 'RouteTable.RouteTableId' --output text)
aws ec2 create-route --route-table-id "$RT_ID" --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW_ID"
aws ec2 associate-route-table --route-table-id "$RT_ID" --subnet-id "$SUBNET_A"
aws ec2 associate-route-table --route-table-id "$RT_ID" --subnet-id "$SUBNET_B"

echo "  ✅ Ağ kurulumu tamam (NAT Gateway kullanılmadı - 0$)"

# ─────────────────────────────────────────────────────────────────────────
# ADIM 2: Güvenlik Grupları (Yine En Üst Düzey Güvenlik!)
# ─────────────────────────────────────────────────────────────────────────
echo ""
echo "🔒 [2/5] Güvenlik Grupları Yapılandırılıyor..."

# sg-app (EC2 için): Sadece HTTP (80) dış dünyaya açık, SSH (22) sadece senin IP'ne açık
SG_APP=$(aws ec2 create-security-group \
  --group-name "${PROJECT}-sg-app" \
  --description "EC2 App Server - Free Tier" \
  --vpc-id "$VPC_ID" \
  --query 'GroupId' --output text)

aws ec2 authorize-security-group-ingress --group-id "$SG_APP" --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$SG_APP" --protocol tcp --port 22 --cidr "$ADMIN_IP"
echo "  ✅ sg-app ($SG_APP): Port 80 public, Port 22 sadece senin IP'n"

# sg-rds: Teknik olarak public subnette olsa bile SADECE sg-app'ten gelen trafiği kabul eder!
# Dış dünyadan gelen hiç kimse (veri tabanı şifresini bilse bile) RDS'e erişemez. %100 Güvenli!
SG_RDS=$(aws ec2 create-security-group \
  --group-name "${PROJECT}-sg-rds" \
  --description "RDS MySQL - Isolated access" \
  --vpc-id "$VPC_ID" \
  --query 'GroupId' --output text)

aws ec2 authorize-security-group-ingress \
  --group-id "$SG_RDS" \
  --protocol tcp --port 3306 \
  --source-group "$SG_APP"

echo "  ✅ sg-rds ($SG_RDS): Sadece uygulama sunucuna açık, internete tamamen izole!"

# ─────────────────────────────────────────────────────────────────────────
# ADIM 3: %100 Ücretsiz RDS MySQL (Single-AZ, db.t3.micro)
# ─────────────────────────────────────────────────────────────────────────
echo ""
echo "🗄️  [3/5] Ücretsiz RDS MySQL Oluşturuluyor..."

aws rds create-db-subnet-group \
  --db-subnet-group-name "${PROJECT}-subnet-grp" \
  --db-subnet-group-description "Subnet group for free RDS" \
  --subnet-ids "$SUBNET_A" "$SUBNET_B"

aws rds create-db-instance \
  --db-instance-identifier "${PROJECT}-db" \
  --db-instance-class db.t3.micro \
  --engine mysql \
  --engine-version "8.0" \
  --master-username admin \
  --master-user-password "$DB_ROOT_PASSWORD" \
  --db-name ecommerce_db \
  --db-subnet-group-name "${PROJECT}-subnet-grp" \
  --vpc-security-group-ids "$SG_RDS" \
  --no-multi-az \
  --allocated-storage 20 \
  --storage-type gp2 \
  --no-publicly-accessible           # Dışarıdan doğrudan bağlantıyı kapat

echo "  ✅ RDS MySQL (Single-AZ db.t3.micro) başlatıldı. (canlı doğrulanmadı)"

# ─────────────────────────────────────────────────────────────────────────
# ADIM 4: Tek EC2 Sunucusu (t3.micro veya t2.micro)
# ─────────────────────────────────────────────────────────────────────────
echo ""
echo "💻 [4/5] EC2 Uygulama Sunucusu Oluşturuluyor..."

# iptables port yönlendirmesi içeren yerel userdata scripti oluştur
# Load Balancer olmadığı için gelen 80 portunu arka plandaki 3000 Node.js portuna yönlendiriyoruz.
cat > aws/userdata-free.sh <<EOF
#!/bin/bash
set -euo pipefail

# Güncellemeleri al ve Node.js 24 kur
curl -fsSL https://rpm.nodesource.com/setup_24.x | bash -
yum install -y nodejs git

# İşletim sistemi düzeyinde Port Yönlendirme (80 -> 3000)
# Bu sayede Load Balancer (ALB) maliyetinden tamamen kurtuluyoruz!
iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-ports 3000

# Uygulama dizini
APP_DIR="/app/ecommerce-secure"
mkdir -p "\$APP_DIR"
useradd -r -s /bin/false appuser
chown appuser:appuser "\$APP_DIR"

# Buraya kendi github repo linkini koyarak canlıya çekebilirsin
# git clone https://github.com/bernakalkann/cloud-journal.git \$APP_DIR

# Geçici çevre değişkenleri (Demoda çalışması için)
cat > "\$APP_DIR/.env" <<EOT
NODE_ENV=production
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=ecommerce_db
DB_USER=admin
DB_PASSWORD=$DB_ROOT_PASSWORD
SESSION_SECRET=\$(openssl rand -hex 32)
EOT

chown appuser:appuser "\$APP_DIR/.env"
chmod 600 "\$APP_DIR/.env"

# Systemd servisi
cat > /etc/systemd/system/ecommerce.service <<EOT
[Unit]
Description=Secure E-Commerce Node.js App
After=network.target

[Service]
Type=simple
User=appuser
WorkingDirectory=\$APP_DIR
ExecStart=/usr/bin/node src/server.js
Restart=always
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOT

systemctl daemon-reload
systemctl enable ecommerce
# systemctl start ecommerce
EOF

# EC2 Instance'ı oluştur
EC2_INSTANCE_ID=$(aws ec2 run-instances \
  --image-id ami-0c02fb55956c7d316 \
  --count 1 \
  --instance-type t3.micro \
  --security-group-ids "$SG_APP" \
  --subnet-id "$SUBNET_A" \
  --user-data "file://aws/userdata-free.sh" \
  --associate-public-ip-address \
  --query 'Instances[0].InstanceId' --output text)

aws ec2 create-tags --resources "$EC2_INSTANCE_ID" --tags Key=Name,Value="${PROJECT}-web-server"

PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids "$EC2_INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

echo "  ✅ EC2 Sunucusu Oluşturuldu: $EC2_INSTANCE_ID"
echo "  ✅ Geçici Canlı IP Adresi: http://$PUBLIC_IP"

# ─────────────────────────────────────────────────────────────────────────
# Canlı servis ve maliyet doğrulaması bu taslakta yoktur.
