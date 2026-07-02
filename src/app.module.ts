import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from './prisma/prisma.module';
import { S3Module } from './s3/s3.module';
import { FilesModule } from './files/files.module';
import { MediaModule } from './media/media.module';
import { TasksModule } from './tasks/tasks.module';
import { HealthController } from './health/health.controller';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('REDIS_HOST'),
          port: Number(configService.get<string>('REDIS_PORT')),
          password: configService.get<string>('REDIS_PASSWORD'),
          db: Number(configService.get<string>('REDIS_DB') || 0),
          enableOfflineQueue: true,
          maxRetriesPerRequest: null,
        },
      }),
    }),
    QueueModule,
    PrismaModule,
    S3Module,
    FilesModule,
    MediaModule,
    TasksModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
