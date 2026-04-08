# GCP Compute Engine Deployment - Terraform Configuration

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # Pass bucket via: terraform init -backend-config="bucket=YOUR_BUCKET"
  backend "gcs" {
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

# Variables
variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP region (use a non-US region for Polymarket geo-compliance)"
  type        = string
}

variable "zone" {
  description = "GCP zone within the region"
  type        = string
}

variable "machine_type" {
  description = "GCE machine type"
  default     = "e2-medium"
}

variable "environment" {
  description = "Environment name"
  default     = "production"
}

variable "ssh_source_ranges" {
  description = "CIDR ranges allowed to SSH into the instance (e.g. [\"1.2.3.4/32\"])"
  type        = list(string)
}

# VPC Network
resource "google_compute_network" "tradingbot" {
  name                    = "tradingbot-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "tradingbot" {
  name          = "tradingbot-subnet"
  ip_cidr_range = "10.0.1.0/24"
  region        = var.region
  network       = google_compute_network.tradingbot.id
}

# Firewall Rules
resource "google_compute_firewall" "allow_ssh" {
  name    = "tradingbot-allow-ssh"
  network = google_compute_network.tradingbot.name

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = var.ssh_source_ranges
  target_tags   = ["tradingbot"]
}

resource "google_compute_firewall" "allow_internal" {
  name    = "tradingbot-allow-internal"
  network = google_compute_network.tradingbot.name

  allow {
    protocol = "tcp"
    ports    = ["0-65535"]
  }

  allow {
    protocol = "udp"
    ports    = ["0-65535"]
  }

  allow {
    protocol = "icmp"
  }

  source_ranges = ["10.0.0.0/16"]
}

resource "google_compute_firewall" "allow_egress" {
  name      = "tradingbot-allow-egress"
  network   = google_compute_network.tradingbot.name
  direction = "EGRESS"

  allow {
    protocol = "all"
  }

  destination_ranges = ["0.0.0.0/0"]
}

# Service Account
resource "google_service_account" "tradingbot" {
  account_id   = "tradingbot-sa"
  display_name = "Trading Bot Service Account"
}

# Secret Manager Access
resource "google_project_iam_member" "secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.tradingbot.email}"
}

# Logging Access
resource "google_project_iam_member" "log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.tradingbot.email}"
}

# Monitoring Access
resource "google_project_iam_member" "metric_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.tradingbot.email}"
}

# GitHub Actions Service Account (CI/CD)
resource "google_service_account" "github_actions" {
  account_id   = "github-actions-sa"
  display_name = "GitHub Actions CI/CD"
}

# GitHub Actions: push images to Artifact Registry
resource "google_project_iam_member" "github_actions_ar_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

# VM Service Account: pull images from Artifact Registry
resource "google_project_iam_member" "tradingbot_ar_reader" {
  project = var.project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.tradingbot.email}"
}

# Artifact Registry for Docker images
resource "google_artifact_registry_repository" "tradingbot" {
  location      = var.region
  repository_id = "tradingbot"
  format        = "DOCKER"
  description   = "Docker images for Polymarket trading bot"
}

# Secrets in Secret Manager
resource "google_secret_manager_secret" "tradingbot_credentials" {
  secret_id = "tradingbot-credentials"

  replication {
    auto {}
  }
}

# Compute Instance
resource "google_compute_instance" "tradingbot" {
  name         = "tradingbot-${var.environment}"
  machine_type = var.machine_type
  zone         = var.zone

  tags = ["tradingbot"]

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2204-lts"
      size  = 50
      type  = "pd-ssd"
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.tradingbot.id

    access_config {
      nat_ip = google_compute_address.tradingbot.address
    }
  }

  service_account {
    email  = google_service_account.tradingbot.email
    scopes = ["cloud-platform"]
  }

  metadata_startup_script = <<-EOF
    #!/bin/bash
    set -e

    # Update system
    apt-get update && apt-get upgrade -y

    # Install Docker
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    usermod -aG docker ubuntu

    # Install Docker Compose
    apt-get install -y docker-compose-plugin

    # Install Node.js 20 LTS (for CLOB key derivation)
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs

    # Install jq
    apt-get install -y jq

    # Install Google Cloud SDK (for Secret Manager)
    apt-get install -y apt-transport-https ca-certificates gnupg
    echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list
    curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | apt-key --keyring /usr/share/keyrings/cloud.google.gpg add -
    apt-get update && apt-get install -y google-cloud-cli

    # Configure Docker for Artifact Registry
    gcloud auth configure-docker ${var.region}-docker.pkg.dev --quiet

    # Create directories
    mkdir -p /opt/tradingbot
    mkdir -p /var/log/tradingbot

    # Configure kernel for low latency
    echo 'net.core.rmem_max=16777216' >> /etc/sysctl.conf
    echo 'net.core.wmem_max=16777216' >> /etc/sysctl.conf
    echo 'net.ipv4.tcp_rmem=4096 87380 16777216' >> /etc/sysctl.conf
    echo 'net.ipv4.tcp_wmem=4096 65536 16777216' >> /etc/sysctl.conf
    echo 'net.ipv4.tcp_low_latency=1' >> /etc/sysctl.conf
    sysctl -p

    # Disable CPU frequency scaling for consistent performance
    apt-get install -y linux-tools-common linux-tools-generic
    for cpu in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
      echo performance > $cpu 2>/dev/null || true
    done

    # first-run-setup.sh is deployed from the repo via CI/CD
    # It will be available at /opt/tradingbot/first-run-setup.sh after first deploy
    chmod +x /opt/tradingbot/first-run-setup.sh 2>/dev/null || true
    chown -R ubuntu:ubuntu /opt/tradingbot

    echo "Startup script complete. Run /opt/tradingbot/first-run-setup.sh after copying .env"
  EOF

  labels = {
    environment = var.environment
    app         = "tradingbot"
  }

  scheduling {
    preemptible       = false
    automatic_restart = true
  }

  shielded_instance_config {
    enable_secure_boot = true
  }
}

# Static IP (optional)
resource "google_compute_address" "tradingbot" {
  name   = "tradingbot-ip"
  region = var.region
}

# Outputs
output "instance_public_ip" {
  value = google_compute_instance.tradingbot.network_interface[0].access_config[0].nat_ip
}

output "instance_name" {
  value = google_compute_instance.tradingbot.name
}

output "service_account_email" {
  value = google_service_account.tradingbot.email
}

output "secret_name" {
  value = google_secret_manager_secret.tradingbot_credentials.name
}

output "artifact_registry_url" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.tradingbot.repository_id}"
}

output "github_actions_sa_email" {
  value = google_service_account.github_actions.email
}
