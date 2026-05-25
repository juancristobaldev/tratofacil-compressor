import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sharp from 'sharp';

@Injectable()
export class FilesService {
  private readonly jpegQuality: number;

  constructor(private readonly configService: ConfigService) {
    this.jpegQuality = Number(this.configService.get<number>('IMAGE_QUALITY', 80));
  }

  async compressImage(buffer: Buffer): Promise<Buffer> {
    try {
      const compressed = await sharp(buffer)
        .rotate()
        .resize({ width: 1080, withoutEnlargement: true })
        .jpeg({ quality: this.jpegQuality })
        .toBuffer();

      return compressed;
    } catch (e) {
      console.error('Error comprimiendo imagen:', e);
      throw e;
    }
  }
}
