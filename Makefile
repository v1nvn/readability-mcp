# readability-mcp - developer targets.
.PHONY: help install build typecheck test test-update-goldens lint format run ci

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make \033[36m<target>\033[0m\n"} /^[a-zA-Z0-9_-]+:.*?##/ {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install JS dependencies
	yarn install --immutable

build: ## Build (vite)
	yarn build

typecheck: ## Typecheck (tsc --noEmit)
	yarn typecheck

test: ## Run the vitest suite
	yarn test

test-update-goldens: ## Regenerate golden markdown outputs
	yarn test:update-goldens

lint: ## Lint (eslint)
	yarn lint

format: ## Format (prettier --write)
	yarn prettier . --write

run: ## Run the MCP server on stdio
	node dist/index.js

ci: typecheck build test ## Local CI checks (typecheck + vite build + vitest)
