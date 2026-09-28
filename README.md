# Akasha-Benchmark

Akasha 的本地评测平台，用于观察从语料编译、检索到答案生成的完整链路，并评估检索、引用和答案质量。项目提供 React 界面、FastAPI 后端、可暂停续跑的后台任务，以及逐样本根因归因。

## 快速开始

需要 Python 3.12+、[uv](https://docs.astral.sh/uv/)、Node.js 和 npm。执行编译和查询前，还需启动 Akasha 服务及其后台 worker。

```bash
make sync          # 安装 Python 和前端依赖
make serve         # FastAPI：http://127.0.0.1:8848
make web           # Vite：http://127.0.0.1:5173
```

首次使用先在「配置」页填写并测试 Akasha 连接。推荐按以下顺序运行：

```text
数据集 → 归一化 → 编译 → 查询 → 评测 → 归因
```

| 页面   | 作用                                             |
| ------ | ------------------------------------------------ |
| 数据集 | 下载、校验和浏览原始数据                         |
| 归一化 | 将问答样本和语料写入 SQLite                      |
| 编译   | 抽取实验子集，创建 Akasha 空间并编译语料         |
| 查询   | 在编译空间中查询并保存完整响应                   |
| 评测   | 计算检索、答案、引用、多跳和可选 Judge 指标      |
| 归因   | 查看逐样本证据链和规则根因，可选生成整轮分析报告 |
| 任务   | 以分叉运行树查看进度、日志，暂停、继续或清理任务 |
| 配置   | 管理 Akasha 连接、远端模型配置和 Judge/归因端点  |
| 测试   | 用单个样本运行并校验编译到归因的完整链路         |

## 数据与结果

支持 `hotpotqa`、`2wikimultihopqa`、`musique`、`narrativeqa` 。

原始文件写入 `dataset/`；归一化数据、配置、任务和评测结果写入项目根目录的 `akasha_bench.db`。

## 任务与配置

删除编译、查询、评测或归因记录会级联删除下游本地记录；删除任务记录不会删除运行产物，远端 Akasha 空间也始终保留。审计日志只追加。

连接凭据和模型密钥以明文保存在 SQLite 中，请勿分发数据库。平台支持以下环境变量：

| 变量                   | 默认值              |
| ---------------------- | ------------------- |
| `AKASHA_PLATFORM_HOST` | `127.0.0.1`         |
| `AKASHA_PLATFORM_PORT` | `8848`              |
| `AKASHA_PLATFORM_DB`   | `./akasha_bench.db` |

## 开发

```bash
make test
npm --prefix web run typecheck
npm --prefix web run build
```

实现边界、数据模型和任务语义见 [架构说明](docs/architecture.md)。
