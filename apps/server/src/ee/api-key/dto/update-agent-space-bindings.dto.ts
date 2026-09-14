import { ArrayUnique, IsArray, IsOptional, IsUUID } from 'class-validator';

export class UpdateAgentSpaceBindingsDto {
  @IsUUID()
  @IsOptional()
  apiKeyId: string;
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  spaceIds: string[];
}
