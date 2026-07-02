import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { PrismaModule } from '../prisma/prisma.module';
import { S3Module } from '../s3/s3.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [PrismaModule, S3Module, QueueModule],
  providers: [TasksService],
})
export class TasksModule {}
