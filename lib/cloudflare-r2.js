import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import chalk from 'chalk';

export class CloudflareR2Client {
  constructor(config) {
    if (!config.accountId || !config.accessKeyId || !config.secretAccessKey || !config.bucketName) {
      throw new Error('Missing required Cloudflare R2 configuration');
    }

    this.bucketName = config.bucketName;
    this.publicUrl = config.publicUrl || `https://${config.bucketName}.r2.dev`;

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async uploadAudio(audioBuffer, key, metadata = {}) {
    try {
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.bucketName,
          Key: key,
          Body: audioBuffer,
          ContentType: 'audio/opus',
          Metadata: {
            ...metadata,
            uploadedAt: new Date().toISOString(),
          },
        },
      });

      upload.on('httpUploadProgress', (progress) => {
        if (progress.loaded && progress.total) {
          const percentage = Math.round((progress.loaded / progress.total) * 100);
          process.stdout.write(`\r  📤 Uploading: ${percentage}%`);
        }
      });

      await upload.done();
      process.stdout.write('\r');

      const publicUrl = `${this.publicUrl}/${key}`;
      return publicUrl;
    } catch (error) {
      console.error(chalk.red(`Failed to upload to R2: ${error.message}`));
      throw error;
    }
  }

  async checkIfExists(key) {
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }));
      return true;
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  generateAudioKey(slug, timestamp = null) {
    const date = timestamp ? new Date(timestamp) : new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');

    return `blog-audio/${year}/${month}/${slug}.opus`;
  }

  getPublicUrl(key) {
    return `${this.publicUrl}/${key}`;
  }
}