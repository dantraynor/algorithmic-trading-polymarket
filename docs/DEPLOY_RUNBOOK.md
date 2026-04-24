# Deployment Runbook

## Pre-flight Checklist

- [ ] GCP project exists with billing enabled
- [ ] Terraform state bucket exists in GCP (you choose the name)
- [ ] Gnosis Safe deployed on Polygon with USDCe funded (see [WALLET_SETUP.md](WALLET_SETUP.md))
- [ ] Private key available for the Safe signer
- [ ] SSH keypair generated for CI/CD deployment
- [ ] GitHub repo has required secrets configured

## Step 1: Create Terraform State Bucket

```bash
# Check if bucket exists
gcloud storage buckets describe gs://YOUR_STATE_BUCKET 2>/dev/null && echo "EXISTS" || echo "NEEDS CREATION"

# Create if needed. Choose a region that matches your legal and platform obligations.
gcloud storage buckets create gs://YOUR_STATE_BUCKET \
  --location=YOUR_REGION \
  --uniform-bucket-level-access
```

## Step 2: Terraform Apply

```bash
cd infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your GCP project ID and your IP for SSH access

terraform init -backend-config="bucket=YOUR_STATE_BUCKET"
terraform plan    # Review changes carefully
terraform apply   # Confirm to create infrastructure
```

Record the outputs:
```
instance_public_ip      = "<IP>"
artifact_registry_url   = "YOUR_REGION-docker.pkg.dev/<project>/tradingbot"
github_actions_sa_email = "github-actions-sa@<project>.iam.gserviceaccount.com"
```

## Step 3: Generate SSH Key for CI/CD

```bash
ssh-keygen -t ed25519 -f ~/.ssh/tradingbot-deploy -N ""

# Add public key to the GCE instance
gcloud compute instances add-metadata YOUR_VM_NAME \
  --zone=YOUR_ZONE \
  --metadata-from-file=ssh-keys=<(echo "ubuntu:$(cat ~/.ssh/tradingbot-deploy.pub)")
```

## Step 4: Configure GitHub Secrets

In your GitHub repo → Settings → Secrets and variables → Actions:

| Secret | Value |
|--------|-------|
| `GCP_PROJECT_ID` | Your GCP project ID |
| `GCP_SA_KEY` | JSON key for github-actions-sa (see below) |
| `GCE_INSTANCE_IP` | Static IP from terraform output |
| `GCE_SSH_PRIVATE_KEY` | Contents of `~/.ssh/tradingbot-deploy` |

### Create the GCP SA key:
```bash
gcloud iam service-accounts keys create github-actions-key.json \
  --iam-account=github-actions-sa@<PROJECT_ID>.iam.gserviceaccount.com

# Copy the contents to GitHub Secrets as GCP_SA_KEY
cat github-actions-key.json

# Delete the local key file after adding to GitHub
rm github-actions-key.json
```

## Step 5: First Deploy

### Option A: Automated (via GitHub Actions)
Push to main → the deploy workflow builds images, pushes to Artifact Registry, and deploys.

### Option B: Manual first-time setup
```bash
# SSH into the instance
ssh -i ~/.ssh/tradingbot-deploy ubuntu@<INSTANCE_IP>

# Copy your .env file
scp -i ~/.ssh/tradingbot-deploy .env ubuntu@<INSTANCE_IP>:/opt/tradingbot/.env

# On the instance: run first-time setup
ssh -i ~/.ssh/tradingbot-deploy ubuntu@<INSTANCE_IP>
chmod 600 /opt/tradingbot/.env
/opt/tradingbot/first-run-setup.sh
```

## Step 6: Verify Services

```bash
ssh -i ~/.ssh/tradingbot-deploy ubuntu@<INSTANCE_IP>

# All containers running
docker compose ps

# No error spam
docker compose logs --tail=50

# Redis healthy
docker exec tradingbot-redis redis-cli -s /var/run/redis/redis.sock PING

# Active markets loading
docker exec tradingbot-redis redis-cli -s /var/run/redis/redis.sock SMEMBERS markets:active

# Execution stats
docker exec tradingbot-redis redis-cli -s /var/run/redis/redis.sock HGETALL execution:stats
```

## Step 7: Start Monitoring

`docker-compose.monitoring.yml` requires `GRAFANA_ADMIN_PASSWORD` (no default). Set it in the shell or in `/opt/tradingbot/.env` before starting the stack.

```bash
# On the instance
export GRAFANA_ADMIN_PASSWORD='your-strong-password'
cd /opt/tradingbot/infrastructure/monitoring
docker compose -f docker-compose.monitoring.yml up -d

# Access Grafana via SSH tunnel (ports are localhost-only)
ssh -L 3000:localhost:3000 -i ~/.ssh/tradingbot-deploy ubuntu@<INSTANCE_IP>
# Open http://localhost:3000 (admin / your GRAFANA_ADMIN_PASSWORD)
```

## Step 8: Enable Trading

Trading is **DISABLED** by default (fail-closed design).

```bash
# Enable when ready
docker exec tradingbot-redis redis-cli -s /var/run/redis/redis.sock SET TRADING_ENABLED TRUE

# Disable immediately
docker exec tradingbot-redis redis-cli -s /var/run/redis/redis.sock SET TRADING_ENABLED FALSE

# Check status
docker exec tradingbot-redis redis-cli -s /var/run/redis/redis.sock GET TRADING_ENABLED
```

## Ongoing Deployments

Push to `main` triggers automatic build and deploy via GitHub Actions:
1. CI builds and tests all services
2. Docker images are pushed to Artifact Registry
3. SSH deploy pulls new images and restarts services

Monitor deployments in GitHub → Actions tab.

## Troubleshooting

| Problem | Check |
|---------|-------|
| Services not starting | `docker compose logs <service>` |
| Redis connection errors | `docker exec tradingbot-redis redis-cli -s /var/run/redis/redis.sock PING` |
| Trading not executing | `GET TRADING_ENABLED` must be `TRUE` |
| Orders failing | Check CLOB credentials match server IP; check rate limits |
| Deploy workflow failing | Check GitHub Actions logs; verify GCP_SA_KEY and SSH key |
| Can't pull images | Verify VM SA has `artifactregistry.reader` role |

## Rollback

```bash
ssh -i ~/.ssh/tradingbot-deploy ubuntu@<INSTANCE_IP>
cd /opt/tradingbot

# Roll back to a specific version (REGISTRY_PREFIX is already in .env from last deploy)
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=<previous-git-sha>/' .env
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```
