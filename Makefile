# readability-mcp - developer targets.
.PHONY: help install build typecheck test test-update-goldens lint format run ci

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make \033[36m<target>\033[0m\n"} /^[a-zA-Z0-9_-]+:.*?##/ {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install JS dependencies
	npm ci

build: ## Build (vite)
	npm run build

typecheck: ## Typecheck (tsc --noEmit)
	npm run typecheck

test: ## Run the vitest suite
	npm test

test-update-goldens: ## Regenerate golden markdown outputs
	npm run test:update-goldens

lint: ## Lint (eslint)
	npm run lint

format: ## Format (prettier --write)
	npx prettier . --write

run: ## Run the MCP server on stdio
	node dist/index.js

ci: typecheck build test ## Local CI checks (typecheck + vite build + vitest)
