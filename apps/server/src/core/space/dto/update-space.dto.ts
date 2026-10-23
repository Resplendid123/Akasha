import { PartialType } from '@nestjs/mapped-types';
import { CreateSpaceDto } from './create-space.dto';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { KnowledgeIndexMode } from '@akasha/db/types/knowledge-index-mode.types';

export class UpdateSpaceDto extends PartialType(CreateSpaceDto) {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsBoolean()
  disablePublicSharing: boolean;

  @IsOptional()
  @IsBoolean()
  allowViewerComments: boolean;

  @IsOptional()
  @IsIn(['compiled', 'original'])
  knowledgeIndexMode: KnowledgeIndexMode;
}
