import { IsNotEmpty, IsUUID } from 'class-validator';

export class GetWorkspaceMemberDto {
  @IsNotEmpty()
  @IsUUID()
  userId: string;
}
