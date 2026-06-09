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

@Module({
  imports: [
    BullModule.registerQueue({ name: 'media' }),
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
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          password: configService.get<string>('REDIS_PASSWORD'),
          db: configService.get<number>('REDIS_DB', 0),
          enableOfflineQueue: false,
          connectTimeout: 10000,
          maxRetriesPerRequest: null,
        },
        prefix: configService.get<string>('BULL_PREFIX', 'tratofacil'),
        settings: {
          stalledInterval: 120000,
          maxStalledCount: 3,
        },
      }),
    }),
    PrismaModule,
    S3Module,
    FilesModule,
    MediaModule,
    TasksModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
