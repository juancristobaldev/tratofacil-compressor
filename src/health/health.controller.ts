import { Controller, Get } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(
    @InjectQueue('media') private readonly mediaQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  @Get('health')
  async check() {
    const redis = await this.mediaQueue.client.ping();
    const waiting = await this.mediaQueue.getWaitingCount();
    const active = await this.mediaQueue.getActiveCount();
    const failed = await this.mediaQueue.getFailedCount();
    const delayed = await this.mediaQueue.getDelayedCount();

    return {
      status: 'ok',
      redis: redis === 'PONG' ? 'connected' : 'error',
      bull: {
        queue: 'media',
        waiting,
        active,
        delayed,
        failed,
      },
    };
  }

  @Get('tasks')
  async tasks() {
    const all = await this.prisma.image.groupBy({
      by: ['status', 'type'],
      _count: { id: true },
      orderBy: [{ status: 'asc' }, { type: 'asc' }],
    });

    const byStatus: Record<string, { total: number; types: Record<string, number> }> = {};

    for (const row of all) {
      if (!byStatus[row.status]) {
        byStatus[row.status] = { total: 0, types: {} };
      }
      byStatus[row.status].types[row.type] = row._count.id;
      byStatus[row.status].total += row._count.id;
    }

    const total = Object.values(byStatus).reduce((acc, s) => acc + s.total, 0);

    const pending = await this.prisma.image.findMany({
      where: { status: 'PENDING', type: { not: 'CERTIFICATE' } },
      select: { id: true, key: true, type: true, createdAt: true, originalKey: true },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    const failed = await this.prisma.image.findMany({
      where: { status: 'FAILED' },
      select: { id: true, key: true, type: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });

    const compressedToday = await this.prisma.image.count({
      where: {
        status: 'COMPRESSED',
        updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });

    const waiting = await this.mediaQueue.getWaitingCount();
    const active = await this.mediaQueue.getActiveCount();
    const delayed = await this.mediaQueue.getDelayedCount();
    const failedJobs = await this.mediaQueue.getFailedCount();

    return {
      total,
      compressedToday,
      queue: { waiting, active, delayed, failedJobs },
      byStatus,
      pending: pending.map((p) => ({
        id: p.id,
        key: p.key,
        type: p.type,
        createdAt: p.createdAt,
        hasOriginal: p.originalKey !== null,
      })),
      failed: failed.map((f) => ({
        id: f.id,
        key: f.key,
        type: f.type,
        createdAt: f.createdAt,
        failedAt: f.updatedAt,
      })),
    };
  }
}
