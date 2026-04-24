# Roadmap

This roadmap keeps the project approachable for contributors while preserving operator safety.

## Near Term

- Add a first-class paper-trading replay mode from recorded market snapshots.
- Add service-level health checks to every Docker image.
- Add dashboard onboarding cards for missing configuration and disabled services.
- Publish a small sample dataset for deterministic local strategy tests.
- Add typed Redis message contracts and schema validation.

## Strategy Developer Experience

- Provide a `create-strategy` scaffold script.
- Add a minimal example strategy that never touches execution.
- Document signal payloads with examples.
- Add backtest adapters for strategy services that currently expect live feeds.

## Dashboard

- Add responsive mobile/tablet layouts for monitoring.
- Add a read-only public demo screenshot set.
- Add import/export for dashboard watchlists.
- Add richer explanations for disabled controls and stale data.

## Operations

- Add one-command restore from Redis/SQLite backups.
- Add production readiness checks before deployment.
- Add OpenTelemetry traces across ingestion, signal generation, execution, and settlement.
- Add rollback workflow for image tags.

## Good First Issues

- Improve empty states in dashboard panels.
- Add tests for Redis key parsing edge cases.
- Add screenshots to docs.
- Convert remaining duplicated strategy config parsing into shared helpers.
- Add example Grafana alert annotations.
