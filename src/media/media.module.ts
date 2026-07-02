import { Module } from '@nestjs/common';
import { MediaProcessor } from './media.processor';
import { FilesModule } from '../files/files.module';
import { PrismaModule } from '../prisma/prisma.module';
import { S3Module } from '../s3/s3.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [QueueModule, FilesModule, PrismaModule, S3Module],
  providers: [MediaProcessor],
  exports: [MediaProcessor],
})
export class MediaModule {}
