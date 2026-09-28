import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import { dbOrTx } from '../../utils';
import {
  InsertablePageHistory,
  Page,
  PageHistory,
} from '@akasha/db/types/entity.types';
import { PaginationOptions } from '@akasha/db/pagination/pagination-options';
import { executeWithCursorPagination } from '@akasha/db/pagination/cursor-pagination';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import { ExpressionBuilder, sql } from 'kysely';
import { DB, JsonValue } from '@akasha/db/types/db';

export type PageHistoryDiffStatus =
  | 'pending'
  | 'running'
  | 'ready'
  | 'failed'
  | 'too_large';

interface CreatePageHistoryDiffInput {
  fromHistoryId: string;
  toHistoryId: string;
  algorithmVersion: string;
  schemaVersion: string;
}

interface CompletePageHistoryDiffInput {
  changes: JsonValue;
  addedCount: number;
  deletedCount: number;
  fromContentHash: string;
  toContentHash: string;
}

@Injectable()
export class PageHistoryRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  private baseFields: Array<keyof PageHistory> = [
    'id',
    'pageId',
    'slugId',
    'title',
    'icon',
    'coverPhoto',
    'lastUpdatedById',
    'contributorIds',
    'spaceId',
    'workspaceId',
    'createdAt',
  ];

  async findById(
    pageHistoryId: string,
    opts?: {
      includeContent?: boolean;
      trx?: KyselyTransaction;
    },
  ): Promise<PageHistory> {
    const db = dbOrTx(this.db, opts?.trx);

    return await db
      .selectFrom('pageHistory')
      .select(this.baseFields)
      .$if(opts?.includeContent, (qb) => qb.select('content'))
      .select((eb) => this.withLastUpdatedBy(eb))
      .select((eb) => this.withContributors(eb))
      .where('id', '=', pageHistoryId)
      .executeTakeFirst();
  }

  async insertPageHistory(
    insertablePageHistory: InsertablePageHistory,
    trx?: KyselyTransaction,
  ): Promise<PageHistory> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('pageHistory')
      .values(insertablePageHistory)
      .returningAll()
      .executeTakeFirst();
  }

  async saveHistory(
    page: Page,
    opts?: { contributorIds?: string[]; trx?: KyselyTransaction },
  ): Promise<PageHistory> {
    return this.insertPageHistory(
      {
        pageId: page.id,
        slugId: page.slugId,
        title: page.title,
        content: page.content,
        icon: page.icon,
        coverPhoto: page.coverPhoto,
        lastUpdatedById: page.lastUpdatedById ?? page.creatorId,
        contributorIds: opts?.contributorIds,
        spaceId: page.spaceId,
        workspaceId: page.workspaceId,
      },
      opts?.trx,
    );
  }

  async findPreviousHistory(history: PageHistory): Promise<PageHistory> {
    return this.db
      .selectFrom('pageHistory')
      .select(this.baseFields)
      .where('pageId', '=', history.pageId)
      .where((eb) =>
        eb.or([
          eb('createdAt', '<', history.createdAt),
          eb.and([
            eb('createdAt', '=', history.createdAt),
            eb('id', '<', history.id),
          ]),
        ]),
      )
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  async findDiffByTargetHistoryId(
    toHistoryId: string,
    algorithmVersion: string,
    schemaVersion: string,
  ) {
    return this.db
      .selectFrom('pageHistory')
      .select([
        'previousHistoryId as fromHistoryId',
        'id as toHistoryId',
        'diffAlgorithmVersion as algorithmVersion',
        'diffSchemaVersion as schemaVersion',
        'diffFromContentHash as fromContentHash',
        'diffToContentHash as toContentHash',
        'diffStatus as status',
        'diffChanges as changes',
        'diffAddedCount as addedCount',
        'diffDeletedCount as deletedCount',
        'diffErrorCode as errorCode',
      ])
      .where('id', '=', toHistoryId)
      .where('diffAlgorithmVersion', '=', algorithmVersion)
      .where('diffSchemaVersion', '=', schemaVersion)
      .where('diffStatus', 'is not', null)
      .executeTakeFirst();
  }

  async createPendingDiff(input: CreatePageHistoryDiffInput) {
    return this.db
      .updateTable('pageHistory')
      .set({
        previousHistoryId: input.fromHistoryId,
        diffAlgorithmVersion: input.algorithmVersion,
        diffSchemaVersion: input.schemaVersion,
        diffFromContentHash: null,
        diffToContentHash: null,
        diffStatus: 'pending',
        diffChanges: null,
        diffAddedCount: 0,
        diffDeletedCount: 0,
        diffErrorCode: null,
      })
      .where('id', '=', input.toHistoryId)
      .returningAll()
      .executeTakeFirst();
  }

  async updateDiffStatus(
    toHistoryId: string,
    algorithmVersion: string,
    status: PageHistoryDiffStatus,
    errorCode: string | null = null,
  ) {
    await this.db
      .updateTable('pageHistory')
      .set({
        diffStatus: status,
        diffErrorCode: errorCode,
      })
      .where('id', '=', toHistoryId)
      .where('diffAlgorithmVersion', '=', algorithmVersion)
      .execute();
  }

  async completeDiff(
    toHistoryId: string,
    algorithmVersion: string,
    input: CompletePageHistoryDiffInput,
  ) {
    await this.db
      .updateTable('pageHistory')
      .set({
        diffChanges: input.changes,
        diffAddedCount: input.addedCount,
        diffDeletedCount: input.deletedCount,
        diffFromContentHash: input.fromContentHash,
        diffToContentHash: input.toContentHash,
        diffStatus: 'ready',
        diffErrorCode: null,
      })
      .where('id', '=', toHistoryId)
      .where('diffAlgorithmVersion', '=', algorithmVersion)
      .execute();
  }

  async findPageHistoryByPageId(pageId: string, pagination: PaginationOptions) {
    const query = this.db
      .selectFrom('pageHistory')
      .select(this.baseFields)
      .select((eb) => this.withLastUpdatedBy(eb))
      .select((eb) => this.withContributors(eb))
      .where('pageId', '=', pageId);

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [{ expression: 'id', direction: 'desc' }],
      parseCursor: (cursor) => ({ id: cursor.id }),
    });
  }

  async findPageLastHistory(
    pageId: string,
    opts?: {
      includeContent?: boolean;
      trx?: KyselyTransaction;
    },
  ) {
    const db = dbOrTx(this.db, opts?.trx);

    return await db
      .selectFrom('pageHistory')
      .select(this.baseFields)
      .$if(opts?.includeContent, (qb) => qb.select('content'))
      .where('pageId', '=', pageId)
      .limit(1)
      .orderBy('createdAt', 'desc')
      .executeTakeFirst();
  }

  withLastUpdatedBy(eb: ExpressionBuilder<DB, 'pageHistory'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.avatarUrl'])
        .whereRef('users.id', '=', 'pageHistory.lastUpdatedById'),
    ).as('lastUpdatedBy');
  }

  withContributors(eb: ExpressionBuilder<DB, 'pageHistory'>) {
    return jsonArrayFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.avatarUrl'])
        .whereRef(
          'users.id',
          '=',
          sql`ANY(${eb.ref('pageHistory.contributorIds')})`,
        ),
    ).as('contributors');
  }
}
