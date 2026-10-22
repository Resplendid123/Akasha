import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const EDITOR_AI_ACTIONS = [
  'improve_writing',
  'fix_spelling_grammar',
  'make_shorter',
  'make_longer',
  'simplify',
  'change_tone',
  'summarize',
  'explain',
  'continue_writing',
  'translate',
  'custom',
] as const;

export type EditorAiAction = (typeof EDITOR_AI_ACTIONS)[number];

export class EditorAiGenerateDto {
  @IsOptional()
  @IsIn(EDITOR_AI_ACTIONS)
  action?: EditorAiAction;

  @IsString()
  @MaxLength(700_000)
  content: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  prompt?: string;
}
