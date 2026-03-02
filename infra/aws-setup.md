# AWS Setup Guide — STAAX

## Step 1 — Create EC2 Instance
- Region: ap-south-1 (Mumbai)
- AMI: Ubuntu 24.04 LTS
- Instance type: t3.small (upgrade to t3.medium if needed)
- Storage: 20GB SSD
- Security Group: Allow ports 22 (SSH), 80 (HTTP), 443 (HTTPS), 8000 (API)

## Step 2 — Install Docker on EC2
```bash
sudo apt update && sudo apt install -y docker.io docker-compose
sudo usermod -aG docker ubuntu
```

## Step 3 — Clone repo on EC2
```bash
git clone git@github.com:theboringtrader14/staax.git
cd staax
cp .env.example .env
# Fill in credentials
```

## Step 4 — Start services
```bash
docker-compose up -d
```

## Step 5 — Set up RDS PostgreSQL
- Engine: PostgreSQL 16
- Instance: db.t3.micro
- Region: ap-south-1
- Update DATABASE_URL in .env with RDS endpoint

## Step 6 — Set up ElastiCache Redis
- Engine: Redis 7
- Node type: cache.t3.micro
- Region: ap-south-1
- Update REDIS_URL in .env with ElastiCache endpoint
