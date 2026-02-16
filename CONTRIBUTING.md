# Contributing to GZDKH

Thank you for your interest in contributing to the GZDKH ecosystem! This guide covers the workflow, conventions, and quality standards for all repositories.

> **Russian version:** [CONTRIBUTING.ru.md](CONTRIBUTING.ru.md)

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Commit Convention](#commit-convention)
- [Branch Naming](#branch-naming)
- [Pull Request Process](#pull-request-process)
- [Quality Gates](#quality-gates)
- [Code Style](#code-style)
- [Project Board](#project-board)

## Getting Started

1. Fork the repository (or clone if you have write access)
2. Create a feature branch from `main`
3. Make your changes following the conventions below
4. Submit a pull request

## Development Workflow

1. **Create an issue** describing the work (see [Project Board](#project-board))
2. **Create a branch** from `main` following [Branch Naming](#branch-naming)
3. **Implement** your changes
4. **Run quality gates** before committing (see [Quality Gates](#quality-gates))
5. **Commit** following [Commit Convention](#commit-convention)
6. **Open a PR** following [Pull Request Process](#pull-request-process)
7. **Address review feedback**
8. **Merge** after approval

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/) v1.0.0:

```
<type>(<scope>): <summary>
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `chore` | Maintenance, dependencies, configuration |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `build` | Build system or external dependencies |
| `ci` | CI/CD pipeline changes |
| `perf` | Performance improvement |
| `revert` | Reverting a previous commit |

### Rules

- Use imperative mood: "add feature" not "added feature"
- Maximum 72 characters for the summary line
- Scope should match the affected area (e.g., `products`, `auth`, `docker`)
- One logical change per commit

### Examples

```
feat(products): add bulk import endpoint
fix(auth): handle expired token refresh
refactor(grpc): migrate to typed clients
docs(api): update OpenAPI descriptions
chore(deps): upgrade DKH.Platform to 2.1.0
```

## Branch Naming

```
<type>/<issue-number>-<short-description>
```

### Examples

```
feat/123-product-import
fix/456-token-refresh
refactor/789-typed-grpc-clients
```

## Pull Request Process

1. **Title** follows Conventional Commits format
2. **Description** includes:
   - Summary of changes
   - Related issues (`Fixes #123` or `Refs #123`)
   - Testing notes
3. **Quality gates** must pass
4. **At least one approval** required
5. **Squash merge** to `main`

## Quality Gates

### .NET Services and Gateways

```bash
# Blocking — must pass before commit
dotnet build -c Release
dotnet test

# Non-blocking — fix before push
dotnet format --verify-no-changes
```

### Next.js / React UI

```bash
# Blocking — must pass before commit
pnpm build

# Non-blocking — fix before push
pnpm lint
```

### Rules

- Never commit if any blocking gate fails
- Fix non-blocking warnings before pushing to remote
- Run gates per-project, not monorepo-wide

## Code Style

### .NET

- Follow `.editorconfig` rules (4 spaces, file-scoped namespaces)
- PascalCase for public members, `_camelCase` for private fields
- One type per file
- See [agents-dotnet.md](https://github.com/GZDKH/DKH.Architecture/blob/main/docs/agents-dotnet.md) for full rules

### Next.js / React

- TypeScript strict mode
- 2-space indentation, single quotes
- PascalCase for components, camelCase for utilities
- Feature-Sliced Design architecture
- See [agents-nextjs.md](https://github.com/GZDKH/DKH.Architecture/blob/main/docs/agents-nextjs.md) for full rules

## Project Board

All tasks are tracked on the [GZDKH Project Board](https://github.com/orgs/GZDKH/projects/19).

### Issue Creation

```
<type>(<scope>): <description>
```

### Labels

| Label | Description |
|-------|-------------|
| `type:feature` | New functionality |
| `type:bug` | Something isn't working |
| `type:refactor` | Code improvement |
| `type:chore` | Maintenance |
| `type:docs` | Documentation |

## Architecture Documentation

For detailed architecture decisions, service profiles, and design guidelines, see the [DKH.Architecture](https://github.com/GZDKH/DKH.Architecture) repository.

## Questions?

If you have questions about contributing, please open a discussion in the relevant repository or contact the maintainers.
