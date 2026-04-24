.DEFAULT_GOAL := help

COMPOSE_DEV := docker compose -f docker-compose.yml -f docker-compose.dev.yml
COMPOSE_DEMO := docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.demo.yml

.PHONY: help doctor setup demo demo-logs demo-down up down ps logs build test

help: ## Show common commands
	@awk 'BEGIN {FS = ":.*##"; printf "\nPolymarket Research Terminal\n\n"} /^[a-zA-Z0-9_-]+:.*##/ {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@printf "\nStart here: make demo\n"

doctor: ## Check local tooling and configuration
	@bash scripts/doctor.sh

setup: ## Create .env from .env.example when missing
	@if [ -f .env ]; then \
		echo ".env already exists"; \
	else \
		cp .env.example .env; \
		echo "Created .env from .env.example"; \
	fi

demo: ## Start a wallet-free local dashboard demo on http://127.0.0.1:3001
	@$(COMPOSE_DEMO) up -d --build redis dashboard demo-seed
	@printf "\nDemo dashboard: http://127.0.0.1:3001\n"
	@printf "Password: demo_dashboard_secret\n\n"

demo-logs: ## Follow demo dashboard and synthetic data logs
	@$(COMPOSE_DEMO) logs -f dashboard demo-seed

demo-down: ## Stop the local demo stack
	@$(COMPOSE_DEMO) down

up: setup ## Start the full local source-built stack
	@$(COMPOSE_DEV) up -d --build

down: ## Stop the full local stack
	@$(COMPOSE_DEV) down

ps: ## Show service status
	@$(COMPOSE_DEV) ps

logs: ## Follow all service logs
	@$(COMPOSE_DEV) logs -f

build: ## Build all Docker images from source
	@$(COMPOSE_DEV) build

test: ## Run the local multi-service test script
	@bash scripts/test-all.sh
