ifeq ($(OS),Windows_NT)
SHELL := pwsh.exe
.SHELLFLAGS := -NoProfile -Command
endif

.DEFAULT_GOAL := dev

.PHONY: db install migrate dev \

# 部署
db:
	docker compose up -d db

# 开发
install:
	pnpm install

migrate:
	pnpm --filter ./apps/server run migration:latest

dev:
	pnpm run dev



