import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  private isProcessingMissing = false;
  private isProcessingFailed = false;
  private isProcessingRetryFailed = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    @InjectQueue('media') private readonly media: Queue,
  ) {}

  @Cron('*/10 * * * * *')
  async processMissingCompress() {
    if (this.isProcessingMissing) {
      this.logger.warn('Cron processMissingCompress saltado (ejecución previa en curso)');
      return;
    }

    this.isProcessingMissing = true;
    const startedAt = Date.now();

    try {
      const pending = await this.prisma.image.findMany({
        where: {
          status: 'PENDING',
          compressedKey: null,
          originalKey: { not: null },
          type: { not: 'CERTIFICATE' },
        },
        take: 50,
      });

      if (pending.length === 0) return;

      this.logger.log(
        `Cron recovery: ${pending.length} imágenes PENDING encontradas`,
      );

      const activeJobs = await this.media.getActive();
      const waitingJobs = await this.media.getWaiting();
      const delayedJobs = await this.media.getDelayed();
      const allJobs = [...activeJobs, ...waitingJobs, ...delayedJobs];

      this.logger.debug(
        `Estado cola: active=${activeJobs.length} waiting=${waitingJobs.length} delayed=${delayedJobs.length}`,
      );

      let enqueued = 0;
      let skippedDuplicate = 0;
      let markedFailed = 0;

      for (const img of pending) {
        const alreadyProcessing = allJobs.some(
          (job) => job.data?.imageId === img.id,
        );

        if (alreadyProcessing) {
          skippedDuplicate++;
          continue;
        }

        const exists = await this.s3.blobExists(img.originalKey!);

        if (!exists) {
          await this.prisma.image.update({
            where: { id: img.id },
            data: { status: 'FAILED' },
          }).catch(() => {});
          this.logger.warn(
            `Imagen marcada FAILED [imageId=${img.id}] key=${img.originalKey} (S3 object no existe)`,
          );
          markedFailed++;
          continue;
        }

        await this.media.add(
          'compress',
          {
            imageId: img.id,
            key: img.originalKey,
            mimeType: img.mimeType || 'image/jpeg',
          },
          { removeOnComplete: true },
        );

        enqueued++;
      }

      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (enqueued > 0 || markedFailed > 0) {
        this.logger.log(
          `Cron recovery completado: enqueued=${enqueued} skipped=${skippedDuplicate} failed=${markedFailed} tiempo=${elapsed}s`,
        );
      }
    } catch (e: any) {
      this.logger.error(`Error en processMissingCompress: ${e.message}`, e.stack);
    } finally {
      this.isProcessingMissing = false;
    }
  }

  @Cron('*/10 * * * * *')
  async processFailedJobs() {
    if (this.isProcessingFailed) {
      this.logger.warn('Cron processFailedJobs saltado (ejecución previa en curso)');
      return;
    }

    this.isProcessingFailed = true;

    try {
      const failedJobs = await this.media.getFailed();

      if (failedJobs.length === 0) return;

      this.logger.log(
        `Cron failed jobs: ${failedJobs.length} jobs fallados encontrados`,
      );

      let removed = 0;
      let retried = 0;
      let markedFailed = 0;

      for (const job of failedJobs) {
        const reason = job.failedReason;
        const imageId = job.data?.imageId;

        // S3 key no existe → irrecuperable
        if (reason?.includes('key does not exist') || reason?.includes('NoSuchKey')) {
          await job.remove();
          this.logger.warn(
            `Job eliminado (NoSuchKey) [imageId=${imageId}] key=${job.data?.key}`,
          );
          removed++;
          continue;
        }

        // Error de credenciales → reencolar con delay
        if (reason?.includes('credential') || reason?.includes('Resolved credential')) {
          await this.media.add('compress', job.data, {
            delay: 30 * 1000,
            removeOnComplete: true,
          });
          await job.remove();
          this.logger.warn(
            `Job reencolado (credential error) [imageId=${imageId}] delay=30s`,
          );
          retried++;
          continue;
        }

        // Otros errores → backoff exponencial
        const attempts = (job.attemptsMade || 0) + 1;

        if (attempts >= 3) {
          if (imageId) {
            await this.prisma.image.update({
              where: { id: imageId },
              data: { status: 'FAILED' },
            }).catch(() => {});
          }
          await job.remove();
          this.logger.error(
            `Job descartado tras ${attempts} intentos [imageId=${imageId}] reason=${reason?.slice(0, 200)}`,
          );
          markedFailed++;
          continue;
        }

        const delay = Math.min(30_000 * Math.pow(2, attempts), 10 * 60 * 1000);
        await this.media.add('compress', job.data, {
          delay,
          removeOnComplete: true,
          attempts,
        });
        await job.remove();
        this.logger.warn(
          `Job reencolado (intento ${attempts + 1}) [imageId=${imageId}] delay=${(delay / 1000).toFixed(0)}s`,
        );
        retried++;
      }

      this.logger.log(
        `Cron failed jobs completado: removed=${removed} retried=${retried} failed=${markedFailed}`,
      );
    } catch (e: any) {
      this.logger.error(`Error en processFailedJobs: ${e.message}`, e.stack);
    } finally {
      this.isProcessingFailed = false;
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async processRetryFailed() {
    if (this.isProcessingRetryFailed) {
      this.logger.warn('Cron processRetryFailed saltado (ejecución previa en curso)');
      return;
    }

    this.isProcessingRetryFailed = true;

    try {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

      const failedImages = await this.prisma.image.findMany({
        where: {
          status: 'FAILED',
          originalKey: { not: null },
          type: { not: 'CERTIFICATE' },
          updatedAt: { lte: fiveMinAgo },
        },
        take: 10,
      });

      if (failedImages.length === 0) return;

      this.logger.log(
        `Cron retry failed: ${failedImages.length} imágenes FAILED encontradas`,
      );

      let recovered = 0;
      let removed = 0;

      for (const img of failedImages) {
        const exists = await this.s3.blobExists(img.originalKey!);

        if (!exists) {
          this.logger.warn(
            `FAILED descartada (S3 no existe) [imageId=${img.id}] key=${img.originalKey}`,
          );
          removed++;
          continue;
        }

        await this.prisma.image.update({
          where: { id: img.id },
          data: { status: 'PENDING' },
        });

        this.logger.log(
          `FAILED recuperada → PENDING [imageId=${img.id}] key=${img.originalKey}`,
        );
        recovered++;
      }

      if (recovered > 0 || removed > 0) {
        this.logger.log(
          `Cron retry failed completado: recovered=${recovered} removed=${removed}`,
        );
      }
    } catch (e: any) {
      this.logger.error(`Error en processRetryFailed: ${e.message}`, e.stack);
    } finally {
      this.isProcessingRetryFailed = false;
    }
  }
}
