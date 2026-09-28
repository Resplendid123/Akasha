# Semantic Edge 质量增强实验总结

- 状态：已结束，不进入生产实现
- 决策日期：2026-09-28
- 适用分支：`beta`
- 基线提交：`4cef17e72`

## 决策摘要

当前不继续补齐或强化 semantic edge，包括关系类型、证据验证、边权重、配额截断、`quality_v2` 图遍历和 delayed edge。

现阶段采用以下检索组合即可：

1. dense 向量召回；
2. lexical/title 召回；
3. 显式 links/backlinks，并在检索时双向展开。

显式 links 来源清楚、可解释、稳定，已经覆盖当前知识库的主要跨页关系。实验中的 semantic edge 大多是同源关系，跨源覆盖不足，未证明其复杂度能换来稳定的 Recall 收益。

本决策是停止新增 semantic edge 质量体系，不要求删除 `beta` 当前已有的数据表或兼容逻辑。若未来要删除既有能力，应另立任务评估迁移和兼容风险。

## 实验假设

实验原本希望验证：

- 为 semantic edge 增加标准化 `relationType`；
- 只有带有效 `sourceRange + quoteHash` 的关系才算 verified；
- verified 强关系获得更高遍历权重；
- links、semantic edge、shared-source 在 ACL 后按页面对融合；
- 在遍历配额截断时，优质 semantic edge 能避免被低质量邻居挤出；
- 图邻居页面使用 query-aware chunk 选择，而不是固定选择 evidence channel。

实验实现还包含权重 profile、按信号类型配额、全局每跳上限、两跳路径分数和诊断统计。

## 数据集与结果

### 25 页 Confluence 数据集

使用三个相同内容的隔离空间，对比 baseline、`quality_v2` 和 `quality_v2_with_delayed_edges`。

| 指标         | baseline | quality_v2 |   变化 |
| ------------ | -------: | ---------: | -----: |
| Recall@20    |    0.958 |      0.958 |      0 |
| Precision@20 |    0.258 |      0.270 | +0.012 |
| F1@20        |    0.394 |      0.410 | +0.016 |
| 跨页覆盖率   |    0.833 |      0.833 |      0 |

结果表现为轻微降噪，但没有 Recall 或跨页覆盖提升。

### 121 页 Confluence 数据集

三个空间各导入 121 页；每个空间约产生 461～467 个知识页、34～40 条 semantic edge 和约 967～990 条 links。

规模扩大约五倍后，shared-source 结构没有相应变密：

- 每个源页平均产生约 3.8 个知识页；
- shared-source 邻居平均约 3；
- 最大约 6；
- P95 约 5；
- 没有页面超过 20 个 shared-source 邻居。

默认 `globalPerHop=200` 从未接近触发。单纯增加页面数量只复制了稀疏结构，没有形成能够检验配额排序的高 fan-out 图，因此结果仍然没有明显拉开。

### 2WikiMultiHopQA 30Q 数据集

该数据集用于真实多跳 gold 评测：

- 30 条问题；
- 143 个源页面，143 页编译成功；
- 448 个知识页；
- 141 条 semantic edge；
- 其中 120 条是同源关系，只有 21 条跨源关系；
- 每个源页平均产生 3.14 个知识页，最大 7，P95 为 5。

| 指标             | baseline | quality_v2 |    变化 |
| ---------------- | -------: | ---------: | ------: |
| Recall@20        |   0.8167 |     0.8333 | +0.0166 |
| Precision@20     |   0.1820 |     0.1955 | +0.0135 |
| F1@20            |   0.2967 |     0.3155 | +0.0188 |
| 完整证据链       |   0.6333 |     0.6667 | +0.0334 |
| 平均召回源页面数 |     9.03 |       8.70 |   -0.33 |

逐题对比：

- Recall：`quality_v2` 2 胜、27 平、1 负；双侧符号检验 `p=1`；
- Precision/F1：13 胜、14 平、3 负；双侧符号检验 `p=0.0213`；
- 完整证据链实际只从 19/30 增加到 20/30。

正向样本包括：

- `Tumbleweed (film) → Nathan Juran`；
- `Hellcats of the Navy → Nathan Juran`。

回退样本：

- `20 Centimeters → Ramón Salazar (director)`：baseline 能召回完整链，`quality_v2` 丢失人物页。

30Q 数据集中存在中心实体重复，问题之间并非完全独立。因此 Precision/F1 的方向值得记录，但不能据此认定 semantic edge 已产生普适收益；Recall 的证据更不足。

## 为什么停止

### 1. 核心 Recall 收益过小且不稳定

两轮 Confluence 数据没有 Recall 提升。2Wiki 只有 2 胜 1 负，净增加一道题，并存在真实回退。

### 2. semantic edge 主要没有跨页

2Wiki 的 141 条边中只有 21 条跨源。大多数边连接同一源页生成的知识页，无法承担跨文档多跳召回的核心作用。

### 3. 实际数据没有触发配额压力

实验设计的主要优势依赖“候选很多、必须截断”的场景，但观测到的最大 shared-source fan-out 只有 7 左右，远低于每跳全局配额 200。权重排序在真实测试中没有充分施展空间。

### 4. 显式双向 links 已覆盖主要关系

links/backlinks 有明确来源，跨页含义稳定；配合 dense、lexical 和 title 召回，已经覆盖大部分 gold。semantic edge 提供的增量候选很少。

### 5. 实验同时改变了多个变量

`quality_v2` 不只改变 edge 权重，还包含页面对融合、ACL 后去重、query-aware chunk 选择等逻辑。因此观测到的 Precision 提升不能单独归因于“补齐 semantic edge”。

### 6. 工程成本明显高于收益

被放弃的实现包含约 1200 行以上的已跟踪改动，另有数据库迁移、关系标准化模块和大量实验代码。它还会修改编译 Prompt 与输出 schema，影响所有新编译任务，而生产入口默认仍走 baseline，实际用户无法直接获得对应收益。

定向单元测试曾达到 5 个套件、68 个测试全部通过。这说明实现内部一致，但测试通过不能代替产品收益验证。

## 后续开发约束

除非满足下面的重启条件，否则不要再次启动 semantic edge 补齐、权重调优或 delayed edge 项目：

- 不因“页面更多”就重新实验；必须先证明图 fan-out 或跨源边密度发生了质变；
- 不使用单一中心实体簇得出总体结论；
- 不把 query-aware chunk、去重、ACL 调整与 edge 权重混在同一个实验变量中；
- 不先写大规模生产实现再寻找适合的数据集；
- 不以 Precision 小幅提升替代 Recall、完整证据链和回退率验收。

当前新增图能力应优先围绕显式 links/backlinks：

- 保证正向链接和反向链接均可遍历；
- 做好 dangling link 解析；
- 保留 ACL 过滤；
- 控制每跳深度、候选量和稳定排序；
- 与 dense/lexical 结果融合并保持可解释引用。

## 允许重启的条件

只有同时满足以下条件，才值得重新评估 semantic edge：

1. 生产问题日志证明 dense/lexical + 双向 links 持续漏掉大量隐式关系；
2. 至少 100 条相互独立、覆盖多个实体簇的多跳 gold 问题；
3. 单独进行 links-only 与 links+semantic-edge 消融，其他检索逻辑保持一致；
4. 跨源 semantic edge 能覆盖足够比例的 gold 路径；
5. Recall 或完整证据链获得明确、可重复的提升，并且回退率可接受；
6. 编译成本、检索延迟和迁移复杂度符合生产预算；
7. 新路径必须通过显式 feature flag 灰度，不能直接改变默认行为。

## 清理记录

- 实验代码未合入 `beta`；
- 临时 `dev` 分支已删除；
- `2wiki120` 扩容实验被取消，对应空间已删除；
- `beta` 保持在实验前基线代码；
- 本地可能仍保留旧的 25/121 页和 2Wiki30 实验数据，它们不是生产验收依据，也不应推动重做该方向。
