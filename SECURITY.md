# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Previous releases | No |

Only the latest released version receives security updates.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Email:** itprodavets@gmail.com

**Please include:**

- Description of the vulnerability
- Steps to reproduce
- Affected component/service
- Potential impact assessment

**Do NOT:**

- Open a public GitHub issue for security vulnerabilities
- Disclose the vulnerability publicly before it has been addressed

## Response Timeline

| Action | SLA |
|--------|-----|
| Acknowledgement | 48 hours |
| Initial assessment | 7 days |
| Fix release | Depends on severity |

## Severity Classification

| Severity | Description | Response |
|----------|-------------|----------|
| Critical | Active exploitation possible, data breach risk | Immediate fix, emergency release |
| High | Exploitable with moderate effort | Fix in next release cycle |
| Medium | Requires specific conditions to exploit | Scheduled fix |
| Low | Minimal risk, defense-in-depth improvement | Best effort |

## Responsible Disclosure

We follow responsible disclosure practices:

1. Reporter contacts us privately
2. We acknowledge and assess the report
3. We develop and test a fix
4. We release the fix
5. We publicly disclose the vulnerability (with reporter credit, if desired)

## Scope

This security policy applies to all repositories in the GZDKH organization:

- DKH.Platform (shared libraries)
- All backend services (DKH.*Service)
- All gateways (DKH.*Gateway)
- All frontend applications (DKH.*.Web.UI)
- DKH.Infrastructure (Docker, scripts, configuration)
