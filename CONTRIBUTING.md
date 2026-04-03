# Contributing to DEM Explorer

First off, thank you for considering contributing to DEM Explorer! It's people like you that make open source tools great.

## How Can I Contribute?

### Reporting Bugs

If you find a bug, please create an issue containing:
- A clear and descriptive title
- Steps to reproduce the bug
- Expected behavior vs actual behavior
- Any relevant logs or screenshots
- Your browser and OS version

### Suggesting Enhancements

We're always open to suggestions. If you have an idea for a new feature or improvement:
- Check existing issues to see if it has already been suggested
- Create a new issue describing the enhancement
- Explain *why* this enhancement would be useful

### Pull Requests

1. Fork the repo and create your branch from `main`.
2. If you've added new features, try to ensure they are self-contained and don't break existing client-side processing flows.
3. Keep the heavy computing client-side to maintain the serverless architecture.
4. Ensure the code is clean and follows the existing style conventions.
5. Create your pull request and describe your changes clearly.

## Development Setup

See the [README.md](README.md) for instructions on how to set up the local development server. 

## Code Style
- Use standard JS conventions.
- Keep dependencies minimal—we prefer using vanilla JS implementations where possible (like the current marching squares or Sobel hillshade algorithms) to keep the app lightweight.

Thank you for contributing!

— Muhammad Ramadhani Wijayanto
