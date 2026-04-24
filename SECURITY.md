# Security Policy

This repository is a deployment template and research tool. It should never contain real secrets.

## Reporting A Vulnerability

Please do not open a public issue for vulnerabilities involving:

- leaked private keys or API credentials
- order execution bypasses
- dashboard authentication bypasses
- unsafe defaults that could place live orders unexpectedly
- cloud deployment credential exposure

Use GitHub private vulnerability reporting if enabled for the repository. If it is not enabled, contact the repository maintainer through the safest private channel listed on the project profile.

## Secret Handling

Never commit:

- `.env`
- private keys
- CLOB API credentials
- dashboard passwords
- RPC URLs with embedded credentials
- cloud service account JSON

Run the included secret scan locally when in doubt:

```bash
docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo
```

## Live Trading Safety

Live execution should require:

- dry-run variables intentionally disabled
- `TRADING_ENABLED=TRUE`
- the relevant strategy switch set to `TRUE`
- reviewed order size and loss limits
- monitored logs and dashboard state

Any code path that places orders without those gates should be treated as a security issue.
