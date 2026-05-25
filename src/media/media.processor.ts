import { Injectable, Logger } from '@nestjs/common';
import { Processor, Process, InjectQueue } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { FilesService } from '../files/files.service';
import { S3Service } from '../s3/s3.service';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';

@Processor('media')
export class MediaProcessor {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    private readonly filesService: FilesService,
    private readonly s3: S3Service,
    private readonly prisma: PrismaService,
    @InjectQueue('media') private readonly media: Queue,
  ) {}

  @Process({ name: 'compress', concurrency: 1 })
  async handleCompress(job: Job) {
    const { imageId, key, mimeType } = job.data;
    const startedAt = Date.now();

    this.logger.log(
      `Inicio compresión [imageId=${imageId}] key=${key} mime=${mimeType || 'N/A'} jobId=${job.id}`,
    );

    try {
      const originalBuffer = await this.s3.getFileBuffer(key);
      const originalSize = originalBuffer.length;
      job.progress(20);
      this.logger.debug(
        `Descargado original [imageId=${imageId}] size=${(originalSize / 1024).toFixed(1)}KB`,
      );

      const compressed = await this.filesService.compressImage(originalBuffer);
      const compressedSize = compressed.length;
      job.progress(60);
      this.logger.debug(
        `Comprimido [imageId=${imageId}] ${(originalSize / 1024).toFixed(1)}KB → ${(compressedSize / 1024).toFixed(1)}KB (${((1 - compressedSize / originalSize) * 100).toFixed(0)}% reducción)`,
      );

      const compressedKey = `compressed/${randomUUID()}`;
      await this.s3.uploadFile(compressedKey, compressed, 'image/jpeg');
      job.progress(80);
      this.logger.debug(
        `Subido a S3 [imageId=${imageId}] compressedKey=${compressedKey}`,
      );

      try {
        await this.media.add(
          'delete',
          { imageId, originalKey: key },
          { delay: 6 * 60 * 60 * 1000, removeOnComplete: true },
        );
      } catch (queueError: any) {
        this.logger.warn(
          `No se pudo encolar delete job [imageId=${imageId}], se reintentará via cron: ${queueError.message}`,
        );
      }

      await this.prisma.image.update({
        where: { id: imageId },
        data: {
          compressedKey,
          compressedSize,
          extension: 'jpg',
          status: 'COMPRESSED',
        },
      });
      this.logger.debug(`DB actualizada [imageId=${imageId}] status=COMPRESSED`);

      job.progress(100);

      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      this.logger.log(
        `Compresión completada [imageId=${imageId}] compressedKey=${compressedKey} tiempo=${elapsed}s`,
      );
    } catch (e: any) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      this.logger.error(
        `Compresión fallida [imageId=${imageId}] key=${key} error=${e.message} tiempo=${elapsed}s`,
        e.stack,
      );
      await this.prisma.image.update({
        where: { id: imageId },
        data: { status: 'FAILED' },
      }).catch(() => {
        this.logger.warn(`No se pudo marcar FAILED [imageId=${imageId}] (registro eliminado?)`);
      });
      throw e;
    }
  }

  @Process({ name: 'delete', concurrency: 1 })
  async handleDelete(job: Job) {
    const { imageId, originalKey } = job.data;

    this.logger.log(
      `Eliminando original [imageId=${imageId}] key=${originalKey}`,
    );

    try {
      if (originalKey) {
        await this.s3.deleteFile(originalKey);
        this.logger.debug(`Original borrado de S3 [imageId=${imageId}] key=${originalKey}`);
      } else {
        this.logger.debug(`Sin originalKey [imageId=${imageId}], nada que borrar`);
      }

      await this.prisma.image.update({
        where: { id: imageId },
        data: { originalKey: null },
      });

      this.logger.log(`Original eliminado [imageId=${imageId}]`);
    } catch (e: any) {
      this.logger.error(
        `Error eliminando original [imageId=${imageId}] key=${originalKey} error=${e.message}`,
      );
    }
  }
}
