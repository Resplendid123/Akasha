import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export const ANALYTICS_ROUTES = [
  'home',
  'ai',
  'spaces',
  'favorites',
  'space.home',
  'space.page',
  'space.trash',
  'graph',
  'knowledge.admin',
  'labels',
  'templates',
  'settings',
  'analytics',
  'other',
] as const;

export type AnalyticsRoute = (typeof ANALYTICS_ROUTES)[number];

export const ANALYTICS_RANGES = ['7d', '30d', '90d'] as const;

export type AnalyticsRangeKey = (typeof ANALYTICS_RANGES)[number];

export class TrackPageViewDto {
  // Unknown routes are coerced to 'other' instead of rejected, so an older
  // client never fails tracking after a route is added.
  @IsString()
  @MaxLength(64)
  route: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  spaceSlug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  pageSlugId?: string;
}

export class AnalyticsOverviewQueryDto {
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range: AnalyticsRangeKey = '30d';

  @IsOptional()
  @IsUUID()
  spaceId?: string;
}
