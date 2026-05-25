import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { PrismaModule } from '../prisma/prisma.module';
import { S3Module } from '../s3/s3.module';
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    PrismaModule,
    S3Module,
    BullModule.registerQueue({ name: 'media' }),
  ],
  providers: [TasksService],
})
export class TasksModule {}
