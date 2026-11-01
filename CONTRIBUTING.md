# Contributing to Mirror Mate

Thank you for your interest in contributing to Mirror Mate! This document provides guidelines for contributing.

## Code of Conduct

Please be respectful and constructive in all interactions.

## How to Contribute

### Reporting Bugs

If you find a bug, please create an issue using the **Bug Report** template. Include:

- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment details (OS, browser, Node.js version)

### Feature Requests

Have an idea? Create an issue using the **Feature Request** template. Describe:

- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

### Questions

For questions about usage or development, create an issue using the **Question** template.

## Development Setup

### Prerequisites

- Node.js 22+
- bun
- Docker (optional, for VOICEVOX)

### Local Development

```bash
# Clone the repository
git clone https://github.com/orangekame3/mirrormate.git
cd mirrormate

# Install dependencies
bun install

# Copy environment file
cp .env.example .env

# Start development server
bun run dev
```

### Docker Development

```bash
# Start with Docker Compose
docker compose up -d
```

## Coding Guidelines

### Code Style

- Use TypeScript for all new code
- Follow existing code patterns
- Use meaningful variable and function names

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: fix a bug
docs: update documentation
style: formatting changes
refactor: code refactoring
test: add or update tests
chore: maintenance tasks
```

### Testing

Run tests before submitting changes:

```bash
# Run tests once
bun run test

# Run tests in watch mode during development
bun run test:watch
```

End-to-end tests run the production build in Chromium with mock backends, a fake camera and a fake microphone. They need no other services:

```bash
# Once, before the first run
bunx playwright install chromium

# Build, then run all e2e tests
bun run test:e2e

# Run one file against the existing build
bunx playwright test e2e/control.spec.ts
```

Tests named `known bug: ...`, and Vitest tests marked `it.fails`, cover open bugs and are expected to fail. Playwright prints ✘ for them but counts them as passed. When you fix one, its test fails with "Expected to fail, but passed", so remove the marker in the same change.

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Make your changes
4. Run lint check (`bun run lint`)
5. Run tests (`bun run test`)
6. Run build (`bun run build`)
7. Commit your changes
8. Push to your fork
9. Open a Pull Request against `develop`

## Project Structure

```
mirrormate/
├── config/           # YAML configuration files
├── docs/             # Documentation
├── messages/         # i18n translation files
├── plamo-server/     # PLaMo embedding server
├── plugins/          # Local plugins
└── src/
    ├── app/          # Next.js pages and API routes
    ├── components/   # React components
    ├── hooks/        # Custom React hooks
    ├── i18n/         # Internationalization setup
    └── lib/          # Core libraries
        ├── animation/    # Avatar state machine
        ├── app/          # App configuration and locale
        ├── character/    # Character/AI personality
        ├── db/           # SQLite client and schema
        ├── discord/      # Discord webhook client
        ├── embedding/    # Embedding providers
        ├── features/     # Backend features (weather, calendar, time)
        ├── llm/          # LLM providers
        ├── memory/       # Memory extraction and RAG
        ├── plugins/      # Plugin system
        ├── presets/      # Locale presets
        ├── providers/    # Provider configuration
        ├── repositories/ # Data access
        ├── rules/        # Rule engine
        ├── search/       # Web search client
        ├── stt/          # Speech-to-text providers
        ├── tools/        # LLM tools
        └── vlm/          # Vision model providers
```

## Creating Plugins

See [Plugin Documentation](docs/config/plugins.md) for details on creating custom plugins.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
