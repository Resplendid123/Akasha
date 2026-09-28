import { KnowledgeCompilationRepo } from '@akasha/db/repos/llm-wiki/knowledge-compilation.repo';
import {
  KnowledgeCompilerLlmError,
  KnowledgeCompilerLlmProvider,
} from '../compiler/knowledge-compiler-llm.provider';
import { SemanticAnalysis } from '../compiler/semantic-compiler.schema';
import { CompileSpaceInput } from '../types/compiler-artifact.types';
import { SemanticKnowledgeCompilerRunner } from './semantic-knowledge-compiler.runner';

const analysis: SemanticAnalysis = {
  version: '1',
  synopsis: 'Event sourcing records changes as an append-only log.',
  language: 'en',
  entities: [],
  concepts: [
    {
      canonicalKey: 'event-sourcing',
      name: 'Event sourcing',
      description: 'An append-only state reconstruction pattern.',
      evidenceQuotes: ['records changes as an append-only log'],
    },
  ],
  claims: [],
  relations: [],
  comparisons: [],
  contradictions: [],
};

const generation = {
  version: '1' as const,
  artifacts: [
    {
      kind: 'source_summary' as const,
      canonicalKey: 'model-supplied-summary-key',
      title: 'Architecture notes',
      markdown: 'The source explains event sourcing.',
      claims: [
        {
          text: 'Event sourcing records changes.',
          confidence: 0.95,
          evidenceQuote: 'records changes as an append-only log',
        },
      ],
      links: [
        {
          targetKind: 'concept' as const,
          targetCanonicalKey: 'event-sourcing',
          relation: 'explains',
          evidenceQuote: 'Event sourcing',
        },
      ],
      tags: ['architecture'],
    },
    {
      kind: 'concept' as const,
      canonicalKey: 'event-sourcing',
      title: 'Event sourcing',
      markdown: 'Event sourcing stores state changes in an append-only log.',
      claims: [
        {
          text: 'State changes are append-only.',
          evidenceQuote: 'append-only log',
        },
      ],
      links: [],
      tags: ['architecture'],
    },
  ],
};

const ATTACHMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * Adds a marker-carrying serialized text and one trusted occurrence to the
 * single compile source, mirroring what the exporter mounts for a page with a
 * real non-image File attachment node.
 */
function withAttachmentSource(input: CompileSpaceInput): CompileSpaceInput {
  const marker = `[[AKASHA_ATTACHMENT:v1:${ATTACHMENT_ID}]]`;
  const serialized = `Event sourcing overview.\nconfig.xlsx ${marker}`;
  const fileNameStart = serialized.indexOf('config.xlsx');
  input.sources[0].attachmentSerializedText = serialized;
  input.sources[0].attachmentOccurrences = [
    {
      attachmentId: ATTACHMENT_ID,
      sourcePageId: 'page-1',
      attachmentUpdatedAt: '2026-01-01T00:00:00.000Z',
      startOffset: fileNameStart,
      endOffset: fileNameStart + `config.xlsx ${marker}`.length,
    },
  ];
  return input;
}

describe('SemanticKnowledgeCompilerRunner', () => {
  it('uses the queue task identity when updating fenced compilation stages', async () => {
    const provider = createProvider();
    const compilationRepo = createCompilationRepo();
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      compilationRepo,
    );

    await runner.compileSpace({
      ...compileInput(),
      compileTaskId: 'knowledge-page-job-1',
    });

    expect(compilationRepo.updateStage).toHaveBeenNthCalledWith(1, {
      workspaceId: 'workspace-1',
      sourcePageId: 'page-1',
      compileTaskId: 'knowledge-page-job-1',
      stage: 'analysis',
    });
    expect(compilationRepo.updateStage).toHaveBeenNthCalledWith(2, {
      workspaceId: 'workspace-1',
      sourcePageId: 'page-1',
      compileTaskId: 'knowledge-page-job-1',
      stage: 'generation',
    });
  });

  it('runs analysis then generation and emits stable typed artifacts', async () => {
    const provider = createProvider();
    const compilationRepo = createCompilationRepo();
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      compilationRepo,
    );

    const first = await runner.compileSpace(compileInput());
    const second = await runner.compileSpace(compileInput());

    expect(provider.analyze).toHaveBeenCalledTimes(2);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.analyze.mock.invocationCallOrder[0]).toBeLessThan(
      provider.generate.mock.invocationCallOrder[0],
    );
    expect(first.artifacts.map((artifact) => artifact.artifactId)).toEqual(
      second.artifacts.map((artifact) => artifact.artifactId),
    );
    expect(first.artifacts).toEqual([
      expect.objectContaining({
        artifactKind: 'source_summary',
        canonicalKey: 'page-1',
        compileTaskId: 'akasha-page:page-1',
      }),
      expect.objectContaining({
        artifactKind: 'concept',
        canonicalKey: 'event-sourcing',
      }),
    ]);
    expect(compilationRepo.saveAnalysis).toHaveBeenCalledTimes(2);
  });

  it('adds deterministic table-row evidence to the source summary', async () => {
    const provider = createProvider();
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      createCompilationRepo(),
    );
    const input = compileInput();
    input.sources[0].content = tableContent();
    input.sources[0].text =
      'Headers: Service; Version; Primary IP; Contact\nService=service-alpha; Version=5.7-test; Primary IP=192.0.2.8; Contact=owner-a';

    const result = await runner.compileSpace(input);
    const summary = result.artifacts.find(
      (artifact) => artifact.artifactKind === 'source_summary',
    );
    const rowChunk = summary?.chunks?.find((chunk) =>
      chunk.text.includes('Primary IP=192.0.2.8'),
    );

    expect(rowChunk).toEqual(
      expect.objectContaining({
        chunkRole: 'standalone',
        retrievalChannel: 'evidence',
        embeddingText: expect.stringContaining('Primary IP=192.0.2.8'),
      }),
    );
    expect(rowChunk?.inputSourceRefs?.[0]?.sourceRange).toEqual({
      startOffset: input.sources[0].text.indexOf('Service=service-alpha'),
      endOffset: input.sources[0].text.length,
    });
  });

  it('rejects oversized tables before calling the compiler provider', async () => {
    const provider = createProvider();
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      createCompilationRepo(),
    );
    const input = compileInput();
    const content = tableContent();
    const sourceTable = content.content[0];
    const header = sourceTable.content[0];
    const dataRow = sourceTable.content[1];
    sourceTable.content = [
      header,
      ...Array.from({ length: 10_000 }, () => dataRow),
    ];
    input.sources[0].content = content;

    await expect(runner.compileSpace(input)).rejects.toMatchObject({
      code: 'page_complexity_limit',
      limitKind: 'table_rows',
    });
    expect(provider.analyze).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('emits source-namespaced attachment evidence blocks only on the summary', async () => {
    const runner = new TestSemanticKnowledgeCompilerRunner(
      createProvider(),
      createCompilationRepo(),
    );
    const input = withAttachmentSource(compileInput());

    const result = await runner.compileSpace(input);
    const summary = result.artifacts.find(
      (artifact) => artifact.artifactKind === 'source_summary',
    );
    const concept = result.artifacts.find(
      (artifact) => artifact.artifactKind === 'concept',
    );
    const attachmentChunk = summary?.chunks?.find(
      (chunk) => (chunk.attachmentOccurrences?.length ?? 0) > 0,
    );

    expect(attachmentChunk).toEqual(
      expect.objectContaining({
        chunkRole: 'child',
        retrievalChannel: 'evidence',
        text: expect.stringContaining('config.xlsx'),
      }),
    );
    // The marker never survives into stored text or embedding input.
    expect(attachmentChunk?.text).not.toContain('AKASHA_ATTACHMENT');
    expect(attachmentChunk?.embeddingText).not.toContain('AKASHA_ATTACHMENT');
    expect(attachmentChunk?.attachmentOccurrences).toHaveLength(1);
    const attachmentOccurrence = attachmentChunk?.attachmentOccurrences?.[0];
    expect(attachmentOccurrence).toEqual(
      expect.objectContaining({
        attachmentId: ATTACHMENT_ID,
        sourcePageId: 'page-1',
        sourceVersion: 'v1',
        sourceContentHash: 'hash-1',
        attachmentUpdatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    // The occurrence carries its marker range so the validator can re-prove the
    // marker is fully contained inside this chunk (§6.2).
    expect(typeof attachmentOccurrence?.startOffset).toBe('number');
    expect(typeof attachmentOccurrence?.endOffset).toBe('number');
    expect(attachmentOccurrence!.endOffset).toBeGreaterThan(
      attachmentOccurrence!.startOffset,
    );
    expect(attachmentOccurrence!.startOffset).toBeGreaterThanOrEqual(
      attachmentChunk!.startOffset!,
    );
    expect(attachmentOccurrence!.endOffset).toBeLessThanOrEqual(
      attachmentChunk!.endOffset!,
    );
    // A parent section is preserved for the kept attachment block.
    expect(
      summary?.parentSections?.some(
        (section) => section.stableKey === attachmentChunk?.parentStableKey,
      ),
    ).toBe(true);
    // Model-generated structural blocks never carry an attachment relation.
    expect(
      summary?.chunks?.some(
        (chunk) =>
          chunk.text.includes('event sourcing') &&
          (chunk.attachmentOccurrences?.length ?? 0) > 0,
      ),
    ).toBe(false);
    expect(
      concept?.chunks?.some(
        (chunk) => (chunk.attachmentOccurrences?.length ?? 0) > 0,
      ),
    ).toBe(false);
  });

  it('groups multiple attachments in one block with ordered occurrences', async () => {
    const runner = new TestSemanticKnowledgeCompilerRunner(
      createProvider(),
      createCompilationRepo(),
    );
    const secondId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const markerA = `[[AKASHA_ATTACHMENT:v1:${ATTACHMENT_ID}]]`;
    const markerB = `[[AKASHA_ATTACHMENT:v1:${secondId}]]`;
    const serialized = `report.pdf ${markerA} and sheet.csv ${markerB}`;
    const input = compileInput();
    input.sources[0].attachmentSerializedText = serialized;
    input.sources[0].attachmentOccurrences = [
      {
        attachmentId: ATTACHMENT_ID,
        sourcePageId: 'page-1',
        attachmentUpdatedAt: '2026-01-01T00:00:00.000Z',
        startOffset: serialized.indexOf('report.pdf'),
        endOffset:
          serialized.indexOf('report.pdf') + `report.pdf ${markerA}`.length,
      },
      {
        attachmentId: secondId,
        sourcePageId: 'page-1',
        attachmentUpdatedAt: '2026-02-02T00:00:00.000Z',
        startOffset: serialized.indexOf('sheet.csv'),
        endOffset:
          serialized.indexOf('sheet.csv') + `sheet.csv ${markerB}`.length,
      },
    ];

    const result = await runner.compileSpace(input);
    const summary = result.artifacts.find(
      (artifact) => artifact.artifactKind === 'source_summary',
    );
    const attachmentChunks = (summary?.chunks ?? []).filter(
      (chunk) => (chunk.attachmentOccurrences?.length ?? 0) > 0,
    );

    expect(attachmentChunks).toHaveLength(1);
    expect(
      attachmentChunks[0].attachmentOccurrences?.map(
        (occurrence) => occurrence.attachmentId,
      ),
    ).toEqual([ATTACHMENT_ID, secondId]);
  });

  it('keeps attachment evidence blocks on the raw fallback path', async () => {
    const provider = createProvider();
    provider.generate.mockResolvedValueOnce({
      version: '1',
      artifacts: [
        {
          kind: 'source_summary',
          canonicalKey: 'page-1',
          title: 'Architecture notes',
          markdown: 'Event sourcing records changes as an append-only log.',
          claims: [],
          links: [],
          tags: [],
        },
      ],
      compilerRecovery: 'source_summary_fallback',
    });
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      createCompilationRepo(),
    );

    const result = await runner.compileSpace(
      withAttachmentSource(compileInput()),
    );
    const summary = result.artifacts[0];

    expect(summary.generationMode).toBe('raw_fallback');
    expect(
      summary.chunks?.some(
        (chunk) => (chunk.attachmentOccurrences?.length ?? 0) > 0,
      ),
    ).toBe(true);
  });

  it('reuses an exact cached analysis and skips the Stage 1 call', async () => {
    const provider = createProvider();
    const compilationRepo = createCompilationRepo(analysis);
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      compilationRepo,
    );

    await runner.compileSpace(compileInput());

    expect(provider.analyze).not.toHaveBeenCalled();
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('<stage_1_analysis>'),
      }),
      {
        canonicalKey: 'page-1',
        title: 'Architecture notes',
        markdown: 'Event sourcing records changes as an append-only log.',
      },
    );
    expect(compilationRepo.saveAnalysis).not.toHaveBeenCalled();
  });

  it('does not reuse analysis when the effective knowledge hash changes', async () => {
    const provider = createProvider();
    const compilationRepo = createCompilationRepo();
    let firstCacheKey: string | undefined;
    compilationRepo.findAnalysis.mockImplementation(async (key) => {
      if (!firstCacheKey) {
        firstCacheKey = key.effectiveKnowledgeHash;
        return analysis;
      }
      return key.effectiveKnowledgeHash === firstCacheKey
        ? analysis
        : undefined;
    });
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      compilationRepo,
    );
    const textOnly = compileInput();
    textOnly.sources[0].effectiveKnowledgeHash = 'sha256:effective-text-only';
    const imageReady = compileInput();
    imageReady.sources[0].effectiveKnowledgeHash =
      'sha256:effective-with-image';

    await runner.compileSpace(textOnly);
    await runner.compileSpace(imageReady);

    expect(provider.analyze).toHaveBeenCalledTimes(1);
    expect(compilationRepo.findAnalysis).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        effectiveKnowledgeHash: expect.stringMatching(/^sha256:/),
      }),
    );
    expect(compilationRepo.findAnalysis).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        effectiveKnowledgeHash: expect.stringMatching(/^sha256:/),
      }),
    );
    expect(
      compilationRepo.findAnalysis.mock.calls[0][0].effectiveKnowledgeHash,
    ).not.toBe(
      compilationRepo.findAnalysis.mock.calls[1][0].effectiveKnowledgeHash,
    );
  });

  it('includes the compiler model profile in the analysis cache identity', async () => {
    const provider = createProvider();
    const compilationRepo = createCompilationRepo();
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      compilationRepo,
    );
    provider.getCacheIdentity.mockReturnValue(
      'openai-compatible:qwen-max:thinking=false',
    );

    await runner.compileSpace(compileInput());
    provider.getCacheIdentity.mockReturnValue(
      'openai-compatible:qwen3.8-max:thinking=false',
    );
    await runner.compileSpace(compileInput());

    const cacheKeys = compilationRepo.findAnalysis.mock.calls.map(
      ([key]) => key.effectiveKnowledgeHash,
    );
    expect(cacheKeys[0]).not.toBe(cacheKeys[1]);
  });

  it('explicitly bypasses the analysis cache for a force rebuild', async () => {
    const provider = createProvider();
    const compilationRepo = createCompilationRepo(analysis);
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      compilationRepo,
    );

    await runner.compileSpace({ ...compileInput(), bypassCache: true });

    expect(compilationRepo.findAnalysis).not.toHaveBeenCalled();
    expect(provider.analyze).toHaveBeenCalledTimes(1);
  });

  it('surfaces a provider failure without consuming a durable budget', async () => {
    const provider = createProvider();
    provider.generate.mockRejectedValueOnce(
      new KnowledgeCompilerLlmError(
        'invalid_output',
        'Knowledge compiler returned invalid generation output.',
        true,
      ),
    );
    const compilationRepo = createCompilationRepo();
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      compilationRepo,
    );

    await expect(runner.compileSpace(compileInput())).rejects.toMatchObject({
      code: 'invalid_output',
      retryable: true,
    });
  });

  it('includes final enriched source text in the compatibility cache key', async () => {
    const provider = createProvider();
    const compilationRepo = createCompilationRepo();
    let firstCacheKey: string | undefined;
    compilationRepo.findAnalysis.mockImplementation(async (key) => {
      if (!firstCacheKey) {
        firstCacheKey = key.effectiveKnowledgeHash;
        return analysis;
      }
      return key.effectiveKnowledgeHash === firstCacheKey
        ? analysis
        : undefined;
    });
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      compilationRepo,
    );
    const first = compileInput();
    first.sources[0].text += '\n\n图片内文字: Error rate 8%';
    const changedOcr = compileInput();
    changedOcr.sources[0].text += '\n\n图片内文字: Error rate 12%';

    await runner.compileSpace(first);
    await runner.compileSpace(changedOcr);

    expect(provider.analyze).toHaveBeenCalledTimes(1);
    const cacheKeys = compilationRepo.findAnalysis.mock.calls.map(
      ([key]) => key.effectiveKnowledgeHash,
    );
    expect(cacheKeys[0]).not.toBe(cacheKeys[1]);
    expect(cacheKeys.join(' ')).not.toContain('Error rate');
  });

  it('marks deterministic source-summary recovery as raw fallback', async () => {
    const provider = createProvider();
    provider.generate.mockResolvedValueOnce({
      version: '1',
      artifacts: [
        {
          kind: 'source_summary',
          canonicalKey: 'page-1',
          title: 'Architecture notes',
          markdown: 'Event sourcing records changes as an append-only log.',
          claims: [],
          links: [],
          tags: [],
        },
      ],
      compilerRecovery: 'source_summary_fallback',
    });
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      createCompilationRepo(),
    );

    const result = await runner.compileSpace(compileInput());

    expect(result.artifacts).toEqual([
      expect.objectContaining({
        artifactKind: 'source_summary',
        generationMode: 'raw_fallback',
      }),
    ]);
    expect(result.diagnostics.warnings).toContainEqual(
      expect.objectContaining({
        code: 'compiler_source_summary_fallback',
        sourcePageId: 'page-1',
      }),
    );
  });

  it('builds the degraded fallback only from bounded validated analysis', async () => {
    const provider = createProvider();
    provider.analyze.mockResolvedValueOnce({
      ...analysis,
      synopsis: 'Validated synopsis. '.repeat(1_000),
      claims: [
        {
          text: 'Validated claim.',
          evidenceQuote: 'Validated evidence.',
        },
      ],
    });
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      createCompilationRepo(),
    );
    const input = compileInput();
    input.sources[0].text = `PRIVATE_FULL_SOURCE_BODY\n${'z'.repeat(20_000)}`;

    await runner.compileSpace(input);

    const fallback = provider.generate.mock.calls[0][1];
    expect(fallback?.markdown).toContain('Validated synopsis.');
    expect(fallback?.markdown).toContain('Validated claim.');
    expect(fallback?.markdown).toContain('Validated evidence.');
    expect(fallback?.markdown).not.toContain('PRIVATE_FULL_SOURCE_BODY');
    expect(fallback?.markdown.length).toBeLessThanOrEqual(8_000);
  });

  it('does not offer a degraded fallback when a last-success exists', async () => {
    const provider = createProvider();
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      createCompilationRepo(),
    );

    await runner.compileSpace({ ...compileInput(), hasLastSuccess: true });

    expect(provider.generate).toHaveBeenCalledWith(
      expect.any(Object),
      undefined,
    );
  });

  it('maps generated evidence quotes back to exact source ranges', async () => {
    const runner = new TestSemanticKnowledgeCompilerRunner(
      createProvider(),
      createCompilationRepo(),
    );

    const result = await runner.compileSpace(compileInput());
    const source = result.artifacts[0].claims?.[0].inputSourceRefs?.[0];

    expect(source?.sourceRange).toEqual({ startOffset: 15, endOffset: 52 });
    expect(source?.quoteHash).toMatch(/^sha256:/);
    expect(
      compileInput().sources[0].text.slice(
        source!.sourceRange!.startOffset,
        source!.sourceRange!.endOffset,
      ),
    ).toBe('records changes as an append-only log');
  });

  it('carries Stage 1 claims into the source summary when generation omits them', async () => {
    const provider = createProvider();
    provider.analyze.mockResolvedValueOnce({
      ...analysis,
      claims: [
        {
          text: 'Event sourcing records changes as an append-only log.',
          confidence: 0.92,
          evidenceQuote: 'records changes as an append-only log',
        },
      ],
    });
    provider.generate.mockResolvedValueOnce({
      ...generation,
      artifacts: generation.artifacts.map((artifact) => ({
        ...artifact,
        claims: [],
      })),
    });
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      createCompilationRepo(),
    );

    const result = await runner.compileSpace(compileInput());
    const summary = result.artifacts.find(
      (artifact) => artifact.artifactKind === 'source_summary',
    );

    expect(summary?.claims).toEqual([
      expect.objectContaining({
        text: 'Event sourcing records changes as an append-only log.',
        confidence: 0.92,
        inputSourceRefs: [
          expect.objectContaining({
            sourceRange: { startOffset: 15, endOffset: 52 },
            quoteHash: expect.stringMatching(/^sha256:/),
          }),
        ],
      }),
    ]);
  });

  it('keeps generated direct links separate from semantic graph edges', async () => {
    const runner = new TestSemanticKnowledgeCompilerRunner(
      createProvider(),
      createCompilationRepo(),
    );

    const result = await runner.compileSpace(compileInput());
    const summary = result.artifacts[0];
    const concept = result.artifacts[1];

    expect(summary.links?.[0]).toMatchObject({
      toKnowledgePageId: concept.artifactId,
      linkType: 'explains',
    });
    expect(summary.graphEdges).toEqual([]);
  });

  it('adds deterministic summary links when the model returns no links', async () => {
    const provider = createProvider();
    provider.generate.mockResolvedValueOnce({
      ...generation,
      artifacts: generation.artifacts.map((artifact) => ({
        ...artifact,
        links: [],
      })),
    });
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      createCompilationRepo(),
    );

    const result = await runner.compileSpace(compileInput());
    const summary = result.artifacts[0];
    const concept = result.artifacts[1];

    expect(summary.links).toEqual([
      expect.objectContaining({
        linkType: 'mentions',
        linkText: 'Event sourcing',
        targetArtifactKind: 'concept',
        targetCanonicalKey: 'event-sourcing',
        toKnowledgePageId: concept.artifactId,
        isDangling: false,
      }),
    ]);
  });

  it('adds exact catalog-title mentions without relying on model links', async () => {
    const provider = createProvider();
    provider.generate.mockResolvedValueOnce({
      ...generation,
      artifacts: generation.artifacts.map((artifact, index) => ({
        ...artifact,
        markdown:
          index === 0
            ? 'The architecture also uses an Existing concept.'
            : artifact.markdown,
        links: [],
      })),
    });
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      createCompilationRepo(),
    );
    const input = compileInput();
    input.catalog = [
      {
        artifactId: '22222222-2222-4222-8222-222222222222',
        artifactKind: 'concept',
        canonicalKey: 'existing-concept',
        title: 'Existing concept',
      },
    ];

    const result = await runner.compileSpace(input);

    expect(result.artifacts[0].links).toContainEqual(
      expect.objectContaining({
        linkType: 'catalog_mention',
        linkText: 'Existing concept',
        targetArtifactKind: 'concept',
        targetCanonicalKey: 'existing-concept',
        toKnowledgePageId: '22222222-2222-4222-8222-222222222222',
      }),
    );
  });

  it('materializes resolvable Stage 1 relations as semantic graph edges', async () => {
    const provider = createProvider();
    provider.analyze.mockResolvedValueOnce({
      ...analysis,
      relations: [
        {
          fromCanonicalKey: 'event-sourcing',
          toCanonicalKey: 'existing-concept',
          relation: 'depends on',
          evidenceQuote: 'append-only log',
        },
      ],
    });
    provider.generate.mockResolvedValueOnce({
      ...generation,
      artifacts: generation.artifacts.map((artifact) => ({
        ...artifact,
        links: [],
      })),
    });
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      createCompilationRepo(),
    );
    const input = compileInput();
    input.catalog = [
      {
        artifactId: '22222222-2222-4222-8222-222222222222',
        artifactKind: 'concept',
        canonicalKey: 'existing-concept',
        title: 'Existing concept',
      },
    ];

    const result = await runner.compileSpace(input);
    const concept = result.artifacts.find(
      (artifact) => artifact.canonicalKey === 'event-sourcing',
    );

    expect(concept?.graphEdges).toEqual([
      expect.objectContaining({
        toKnowledgePageId: '22222222-2222-4222-8222-222222222222',
        relation: 'depends on',
      }),
    ]);
  });

  it('materializes generated Markdown headings as parented structural chunks', async () => {
    const provider = createProvider();
    provider.generate.mockResolvedValueOnce({
      ...generation,
      artifacts: generation.artifacts.map((artifact, index) => ({
        ...artifact,
        markdown:
          index === 0
            ? '# Architecture\nEvent sourcing records changes.\n## Replay\nEvents rebuild state.'
            : artifact.markdown,
      })),
    });
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      createCompilationRepo(),
    );

    const result = await runner.compileSpace(compileInput());
    const summary = result.artifacts[0];

    expect(
      summary.parentSections?.map((section) => section.headingPath),
    ).toEqual([['Architecture'], ['Architecture', 'Replay']]);
    expect(summary.chunks?.length).toBeGreaterThan(0);
    expect(
      summary.chunks?.every(
        (chunk) => chunk.chunkRole === 'child' && chunk.parentStableKey,
      ),
    ).toBe(true);
  });

  it('keeps unresolved canonical links dangling without inventing a foreign key', async () => {
    const provider = createProvider();
    provider.generate.mockResolvedValueOnce({
      ...generation,
      artifacts: [
        {
          ...generation.artifacts[0],
          links: [
            {
              ...generation.artifacts[0].links[0],
              targetCanonicalKey: 'missing-concept',
            },
          ],
        },
        generation.artifacts[1],
      ],
    });
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      createCompilationRepo(),
    );

    const result = await runner.compileSpace(compileInput());
    const summary = result.artifacts[0];

    expect(summary.links?.[0]).toMatchObject({
      toKnowledgePageId: undefined,
      linkText: 'missing-concept',
      targetArtifactKind: 'concept',
      targetCanonicalKey: 'missing-concept',
      isDangling: true,
    });
    expect(summary.graphEdges).toEqual([]);
  });

  it('resolves cross-page links against the existing active catalog', async () => {
    const provider = createProvider();
    provider.generate.mockResolvedValueOnce({
      ...generation,
      artifacts: [
        {
          ...generation.artifacts[0],
          links: [
            {
              ...generation.artifacts[0].links[0],
              targetCanonicalKey: 'existing-concept',
            },
          ],
        },
        generation.artifacts[1],
      ],
    });
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      createCompilationRepo(),
    );
    const input = compileInput();
    input.catalog = [
      {
        artifactId: '22222222-2222-4222-8222-222222222222',
        artifactKind: 'concept',
        canonicalKey: 'existing-concept',
        title: 'Existing concept',
      },
    ];

    const result = await runner.compileSpace(input);

    expect(result.artifacts[0].links?.[0]).toMatchObject({
      toKnowledgePageId: '22222222-2222-4222-8222-222222222222',
      isDangling: false,
    });
    expect(result.artifacts[0].graphEdges).toEqual([]);
  });

  it('rejects batches, empty sources, and generation without a source summary', async () => {
    const provider = createProvider();
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      createCompilationRepo(),
    );

    await expect(
      runner.compileSpace({
        ...compileInput(),
        sources: [compileInput().sources[0], compileInput().sources[0]],
      }),
    ).rejects.toThrow('exactly one source page');
    await expect(
      runner.compileSpace({
        ...compileInput(),
        sources: [{ ...compileInput().sources[0], text: '   ' }],
      }),
    ).rejects.toThrow('empty source page');

    provider.generate.mockResolvedValueOnce({
      version: '1',
      artifacts: [generation.artifacts[1]],
    });
    await expect(runner.compileSpace(compileInput())).rejects.toThrow(
      'exactly one source_summary',
    );
  });

  it('rejects more than 20 generated artifacts before materialization', async () => {
    const provider = createProvider();
    provider.generate.mockResolvedValueOnce({
      version: '1',
      artifacts: [
        generation.artifacts[0],
        ...Array.from({ length: 20 }, (_, index) => ({
          ...generation.artifacts[1],
          canonicalKey: `concept-${index}`,
        })),
      ],
    });
    const runner = new TestSemanticKnowledgeCompilerRunner(
      provider,
      createCompilationRepo(),
    );

    await expect(runner.compileSpace(compileInput())).rejects.toMatchObject({
      code: 'page_complexity_limit',
      retryable: false,
    });
  });
});

class TestSemanticKnowledgeCompilerRunner extends SemanticKnowledgeCompilerRunner {
  protected now(): Date {
    return new Date('2026-07-21T01:02:03.000Z');
  }
}

function createProvider() {
  return {
    getCacheIdentity: jest
      .fn()
      .mockReturnValue('openai-compatible:qwen3.8-max:thinking=false'),
    getCompilerModel: jest.fn().mockReturnValue('qwen3.8-max'),
    analyze: jest.fn().mockResolvedValue(analysis),
    generate: jest.fn().mockResolvedValue(generation),
  } as unknown as jest.Mocked<KnowledgeCompilerLlmProvider>;
}

function createCompilationRepo(cachedAnalysis?: SemanticAnalysis) {
  return {
    findAnalysis: jest.fn().mockResolvedValue(cachedAnalysis),
    saveAnalysis: jest.fn().mockResolvedValue(undefined),
    updateStage: jest.fn().mockResolvedValue(undefined),
    recordCompilerCandidates: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<KnowledgeCompilationRepo>;
}

function compileInput(): CompileSpaceInput {
  return {
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    compilerVersion: 'semantic-v1',
    promptVersion: 'semantic-prompt-v1',
    compileMode: 'pages' as const,
    purpose: 'Build an architecture wiki.',
    schema: 'Use typed knowledge pages.',
    catalog: [],
    sources: [
      {
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        sourcePageId: 'page-1',
        sourceVersion: 'v1',
        contentHash: 'hash-1',
        title: 'Architecture notes',
        text: 'Event sourcing records changes as an append-only log.',
        references: [],
      },
    ],
  };
}

function tableContent() {
  const cell = (type: string, text: string) => ({
    type,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  });
  return {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              cell('tableHeader', 'Service'),
              cell('tableHeader', 'Version'),
              cell('tableHeader', 'Primary IP'),
              cell('tableHeader', 'Contact'),
            ],
          },
          {
            type: 'tableRow',
            content: [
              cell('tableCell', 'service-alpha'),
              cell('tableCell', '5.7-test'),
              cell('tableCell', '192.0.2.8'),
              cell('tableCell', 'owner-a'),
            ],
          },
        ],
      },
    ],
  };
}
