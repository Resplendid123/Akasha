import { Module } from '@nestjs/common';
import { SsoModule } from './sso/sso.module';
import { ApiKeyModule } from './api-key/api-key.module';
import { DocumentImportModule } from './document-import/document-import.module';
import { ConfluenceImportModule } from './confluence-import/confluence-import.module';
import { LlmWikiModule } from './llm-wiki/llm-wiki.module';
import { AiChatModule } from './ai-chat/ai-chat.module';
import { CronModule } from './cron/cron.module';
import { EditorAiModule } from './editor-ai/editor-ai.module';

@Module({
  imports: [
    SsoModule,
    ApiKeyModule,
    DocumentImportModule,
    ConfluenceImportModule,
    LlmWikiModule,
    AiChatModule,
    EditorAiModule,
    CronModule,
  ],
})
export class EeModule {}
