# ADR-0001: Monorepo Structure

**Status:** Accepted  
**Date:** 2025-06-25  
**Author:** Raphael Andrei G. Latoy

## Context

The E-Boses system consists of a React frontend, Django backend, shared packages, infrastructure scripts, and documentation. We need a repository structure that:

- Keeps frontend and backend code in one place for easier development
- Allows sharing types, constants, and configurations
- Supports Docker-based local development
- Is beginner-friendly for a capstone project team

## Decision

We chose a **monorepo** structure with the following layout:

```
E-Boses/
├── apps/           # Application code (web + api)
├── packages/       # Shared packages
├── infra/          # Infrastructure scripts
├── docs/           # Documentation
└── .github/        # CI/CD workflows
```

### Why Monorepo?

1. **Simplified setup**: One repository to clone
2. **Shared code**: Types, constants, and configs live in `packages/`
3. **Coordinated changes**: Frontend and backend changes in one PR
4. **Docker Compose**: Single command to run all services
5. **Team-friendly**: Easier for a capstone team to collaborate

### Why Not Multi-Repo?

1. **More overhead**: Multiple repos to manage, clone, and configure
2. **Version drift**: Frontend and backend can get out of sync
3. **Harder onboarding**: New team members need to set up multiple repos

## Consequences

### Positive

- Single `git clone` to get started
- Shared packages for types and configs
- Docker Compose runs everything
- Clear separation between apps and shared code

### Negative

- Larger repository size over time
- CI/CD needs to be selective about what to build/test
- Requires discipline to keep packages truly shared

## Alternatives Considered

1. **Separate repos**: Rejected due to complexity for a capstone team
2. **Single app (no monorepo)**: Rejected because frontend and backend have distinct lifecycles
3. **NPM workspaces only**: Rejected because Django doesn't use npm

## References

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Monorepo Patterns](https://monorepo.tools/)
