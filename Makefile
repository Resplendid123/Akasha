SHELL := /bin/sh

.PHONY: help sync serve web build test

help:
	@printf "  sync       安装依赖\n  serve      启动后端 :8848\n  web        启动前端 :5173\n  build      构建前端产物\n  test       运行离线测试\n"

sync:
	uv sync
	npm --prefix web install

serve:
	uv run uvicorn akasha_platform.main:app --reload --port 8848

web:
	npm --prefix web run dev

build:
	npm --prefix web run build

test:
	uv run pytest -q
