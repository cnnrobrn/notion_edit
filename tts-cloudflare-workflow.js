import { Client } from '@notionhq/client';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import chalk from 'chalk';
import ora from 'ora';
import { CloudflareR2Client } from './lib/cloudflare-r2.js';

dotenv.config();

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const r2Client = new CloudflareR2Client({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  bucketName: process.env.CLOUDFLARE_R2_BUCKET_NAME,
  publicUrl: process.env.CLOUDFLARE_R2_PUBLIC_URL,
});

class TTSCloudflareWorkflow {
  constructor() {
    this.databaseId = null;
    this.stats = {
      processed: 0,
      skipped: 0,
      failed: 0,
      totalAudioSize: 0,
    };
  }

  async findBlogsDatabase() {
    const spinner = ora('Searching for Blogs database...').start();

    try {
      const response = await notion.search({
        filter: {
          property: 'object',
          value: 'database'
        },
        query: 'Blogs'
      });

      for (const db of response.results) {
        if (db.title?.[0]?.plain_text?.toLowerCase().includes('blog')) {
          spinner.succeed(chalk.green(`Found database: ${db.title?.[0]?.plain_text}`));
          return db.id;
        }
      }

      if (response.results.length > 0) {
        spinner.succeed(chalk.yellow('Found database, using first result'));
        return response.results[0].id;
      }

      spinner.fail(chalk.red('No Blogs database found'));
      return null;
    } catch (error) {
      spinner.fail(chalk.red(`Error searching for database: ${error.message}`));
      return null;
    }
  }

  async extractTextFromBlock(block) {
    let text = '';

    switch (block.type) {
      case 'paragraph':
      case 'heading_1':
      case 'heading_2':
      case 'heading_3':
      case 'bulleted_list_item':
      case 'numbered_list_item':
      case 'to_do':
      case 'quote':
      case 'callout':
        const richTextArray = block[block.type]?.rich_text || [];
        text = richTextArray.map(rt => rt.plain_text || '').join('');
        break;

      case 'code':
        text = block.code?.rich_text?.map(rt => rt.plain_text).join('') || '';
        break;

      default:
        break;
    }

    switch (block.type) {
      case 'heading_1':
        return `\n${text}\n\n`;
      case 'heading_2':
        return `\n${text}\n\n`;
      case 'heading_3':
        return `${text}\n`;
      case 'bulleted_list_item':
        return `${text}\n`;
      case 'numbered_list_item':
        return `${text}\n`;
      case 'quote':
        return `${text}\n`;
      default:
        return text ? `${text} ` : '';
    }
  }

  async getAllBlocksFromPage(pageId) {
    const blocks = [];
    let hasMore = true;
    let cursor = undefined;

    while (hasMore) {
      try {
        const response = await notion.blocks.children.list({
          block_id: pageId,
          start_cursor: cursor,
          page_size: 100
        });

        for (const block of response.results) {
          blocks.push(block);

          if (block.has_children &&
              block.type !== 'child_page' &&
              block.type !== 'child_database') {
            const childBlocks = await this.getAllBlocksFromPage(block.id);
            blocks.push(...childBlocks);
          }
        }

        hasMore = response.has_more;
        cursor = response.next_cursor;
      } catch (error) {
        console.error(chalk.red(`Error fetching blocks: ${error.message}`));
        break;
      }
    }

    return blocks;
  }

  async extractPageContent(pageId) {
    const blocks = await this.getAllBlocksFromPage(pageId);
    const contentParts = [];

    for (const block of blocks) {
      const text = await this.extractTextFromBlock(block);
      if (text && text.trim()) {
        contentParts.push(text);
      }
    }

    const content = contentParts.join('').trim();

    // Clean up excessive whitespace
    return content.replace(/\n{3,}/g, '\n\n').replace(/  +/g, ' ');
  }

  splitTextIntoChunks(text, maxLength = 4000) {
    if (text.length <= maxLength) {
      return [text];
    }

    const chunks = [];
    let currentPosition = 0;

    while (currentPosition < text.length) {
      let chunkEnd = Math.min(currentPosition + maxLength, text.length);

      if (chunkEnd < text.length) {
        let searchStart = Math.max(currentPosition, chunkEnd - 1000);
        let bestBreak = -1;

        // Look for sentence endings
        for (let i = chunkEnd - 1; i > searchStart; i--) {
          const char = text[i];
          if (char === '.' || char === '!' || char === '?') {
            if (i === text.length - 1 || text[i + 1] === ' ' || text[i + 1] === '\n') {
              bestBreak = i + 1;
              break;
            }
          }
        }

        if (bestBreak > currentPosition) {
          chunkEnd = bestBreak;
        } else {
          // Look for paragraph break
          const paragraphBreak = text.lastIndexOf('\n\n', chunkEnd);
          if (paragraphBreak > currentPosition) {
            chunkEnd = paragraphBreak;
          } else {
            // Last resort: find space
            const lastSpace = text.lastIndexOf(' ', chunkEnd);
            if (lastSpace > currentPosition) {
              chunkEnd = lastSpace;
            }
          }
        }
      }

      const chunk = text.substring(currentPosition, chunkEnd).trim();
      if (chunk) {
        chunks.push(chunk);
      }

      currentPosition = chunkEnd;
      while (currentPosition < text.length &&
             (text[currentPosition] === ' ' || text[currentPosition] === '\n')) {
        currentPosition++;
      }
    }

    return chunks;
  }

  async convertToSpeech(text, title) {
    if (!text || text.trim().length === 0) {
      console.log(chalk.yellow('  ⚠ Empty text, skipping TTS conversion'));
      return null;
    }

    const chunks = this.splitTextIntoChunks(text, 4000);

    if (chunks.length > 1) {
      console.log(chalk.gray(`  📄 Split into ${chunks.length} chunks for processing`));
    }

    const audioBuffers = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(chalk.gray(`  🎤 Processing chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`));

      try {
        const mp3Response = await openai.audio.speech.create({
          model: "tts-1",
          voice: "onyx",
          input: chunk,
          speed: 1.0,
          response_format: "opus"
        });

        const buffer = Buffer.from(await mp3Response.arrayBuffer());
        audioBuffers.push(buffer);

        // Rate limit protection
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.log(chalk.red(`  ✗ Failed chunk ${i + 1}: ${error.message}`));
        throw error;
      }
    }

    // Combine all audio buffers
    const combinedBuffer = Buffer.concat(audioBuffers);
    this.stats.totalAudioSize += combinedBuffer.length;

    return combinedBuffer;
  }

  async uploadToCloudflare(audioBuffer, slug, metadata) {
    const key = r2Client.generateAudioKey(slug);

    // Check if already exists
    const exists = await r2Client.checkIfExists(key);
    if (exists) {
      console.log(chalk.yellow(`  ⚠ Audio already exists in R2, using existing`));
      return r2Client.getPublicUrl(key);
    }

    console.log(chalk.cyan(`  📤 Uploading to Cloudflare R2...`));
    const url = await r2Client.uploadAudio(audioBuffer, key, metadata);
    console.log(chalk.green(`  ✅ Uploaded to: ${url}`));

    return url;
  }

  async updateNotionWithAudioLink(pageId, audioUrl, title) {
    try {
      await notion.pages.update({
        page_id: pageId,
        properties: {
          'AudioLink': {
            url: audioUrl
          }
        }
      });
      console.log(chalk.green(`  ✅ Updated Notion with audio link`));
      return true;
    } catch (error) {
      // Try alternative field name
      try {
        await notion.pages.update({
          page_id: pageId,
          properties: {
            'audiolink': {
              url: audioUrl
            }
          }
        });
        console.log(chalk.green(`  ✅ Updated Notion with audio link`));
        return true;
      } catch (error2) {
        console.error(chalk.red(`  ✗ Failed to update Notion: ${error2.message}`));
        console.log(chalk.yellow(`  💡 Make sure you have an "AudioLink" URL field in your database`));
        return false;
      }
    }
  }

  async getPageMetadata(page) {
    const title = page.properties.Name?.title?.[0]?.plain_text ||
                 page.properties.Title?.title?.[0]?.plain_text ||
                 page.properties.name?.title?.[0]?.plain_text ||
                 'Untitled';

    const slug = page.properties['Slug-AI']?.rich_text?.[0]?.plain_text ||
                page.properties['slug-ai']?.rich_text?.[0]?.plain_text ||
                page.properties.Slug?.rich_text?.[0]?.plain_text ||
                title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    const audioLink = page.properties.AudioLink?.url ||
                     page.properties.audiolink?.url ||
                     null;

    const hasExistingContent = page.properties.Content?.rich_text?.length > 0 ||
                              page.properties.content?.rich_text?.length > 0;

    return {
      id: page.id,
      title,
      slug,
      audioLink,
      hasContent: hasExistingContent
    };
  }

  async processPage(page) {
    const metadata = await this.getPageMetadata(page);

    console.log(chalk.cyan(`\n📝 Processing: ${metadata.title}`));

    // Skip if already has audio
    if (metadata.audioLink) {
      this.stats.skipped++;
      console.log(chalk.gray(`  ⏭️  Skipped (already has audio): ${metadata.audioLink}`));
      return;
    }

    try {
      // Extract content from page blocks
      console.log(chalk.gray(`  📖 Extracting content from page blocks...`));
      const content = await this.extractPageContent(page.id);

      if (!content || content.trim().length < 100) {
        console.log(chalk.yellow(`  ⚠ Content too short (${content?.length || 0} chars), skipping`));
        this.stats.skipped++;
        return;
      }

      console.log(chalk.gray(`  📝 Content length: ${content.length} characters`));

      // Generate TTS audio
      console.log(chalk.gray(`  🎤 Converting to speech with Onyx voice...`));
      const audioBuffer = await this.convertToSpeech(content, metadata.title);

      if (!audioBuffer) {
        throw new Error('Failed to generate audio');
      }

      const audioSizeMB = (audioBuffer.length / 1024 / 1024).toFixed(2);
      console.log(chalk.gray(`  📦 Audio size: ${audioSizeMB} MB`));

      // Upload to Cloudflare R2
      const audioUrl = await this.uploadToCloudflare(audioBuffer, metadata.slug, {
        title: metadata.title,
        pageId: metadata.id,
        contentLength: String(content.length),
      });

      // Update Notion with audio link
      const updated = await this.updateNotionWithAudioLink(page.id, audioUrl, metadata.title);

      if (updated) {
        this.stats.processed++;
        console.log(chalk.green(`  ✨ Successfully processed: ${metadata.title}`));
      } else {
        this.stats.failed++;
      }

    } catch (error) {
      this.stats.failed++;
      console.error(chalk.red(`  ❌ Error processing ${metadata.title}: ${error.message}`));
    }
  }

  async run(options = {}) {
    console.log(chalk.blue('\n🎙️  Automated TTS to Cloudflare Workflow\n'));

    // Validate configuration
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
      console.error(chalk.red('❌ OPENAI_API_KEY is not set in .env file'));
      process.exit(1);
    }

    if (!process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || !process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
      console.error(chalk.red('❌ Cloudflare R2 credentials not configured'));
      console.log(chalk.yellow('Add to .env:'));
      console.log(chalk.gray('  CLOUDFLARE_ACCOUNT_ID=your_account_id'));
      console.log(chalk.gray('  CLOUDFLARE_R2_ACCESS_KEY_ID=your_access_key'));
      console.log(chalk.gray('  CLOUDFLARE_R2_SECRET_ACCESS_KEY=your_secret_key'));
      console.log(chalk.gray('  CLOUDFLARE_R2_BUCKET_NAME=your_bucket_name'));
      console.log(chalk.gray('  CLOUDFLARE_R2_PUBLIC_URL=https://your-bucket.r2.dev'));
      process.exit(1);
    }

    // Find database
    this.databaseId = await this.findBlogsDatabase();
    if (!this.databaseId) {
      console.error(chalk.red('Failed to find Blogs database'));
      process.exit(1);
    }

    // Fetch and process pages
    const spinner = ora('Fetching blog pages...').start();

    try {
      let hasMore = true;
      let cursor = undefined;
      const limit = options.limit || null;
      let processedCount = 0;

      while (hasMore) {
        const response = await notion.databases.query({
          database_id: this.databaseId,
          start_cursor: cursor,
          page_size: Math.min(limit || 100, 100)
        });

        spinner.stop();

        for (const page of response.results) {
          if (limit && processedCount >= limit) {
            hasMore = false;
            break;
          }

          await this.processPage(page);
          processedCount++;

          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        hasMore = response.has_more && (!limit || processedCount < limit);
        cursor = response.next_cursor;
      }

      // Final summary
      console.log(chalk.blue('\n📊 Summary'));
      console.log(chalk.blue('═'.repeat(40)));
      console.log(chalk.green(`✅ Processed: ${this.stats.processed} pages`));
      console.log(chalk.gray(`⏭️  Skipped: ${this.stats.skipped} pages`));
      if (this.stats.failed > 0) {
        console.log(chalk.red(`❌ Failed: ${this.stats.failed} pages`));
      }
      const totalAudioMB = (this.stats.totalAudioSize / 1024 / 1024).toFixed(2);
      console.log(chalk.cyan(`📦 Total audio generated: ${totalAudioMB} MB`));
      console.log(chalk.blue('═'.repeat(40)));
      console.log(chalk.green('\n✨ TTS workflow complete!\n'));

    } catch (error) {
      spinner.fail(chalk.red(`Error: ${error.message}`));
      console.error(chalk.red('\nStack trace:'), error);
      process.exit(1);
    }
  }
}

// CLI
async function main() {
  const workflow = new TTSCloudflareWorkflow();

  const args = process.argv.slice(2);
  const command = args[0] || 'run';

  switch (command) {
    case 'run':
      await workflow.run();
      break;

    case 'test':
      // Test with just 1 page
      await workflow.run({ limit: 1 });
      break;

    case 'batch':
      // Process a specific number
      const limit = parseInt(args[1]) || 5;
      await workflow.run({ limit });
      break;

    case 'help':
      console.log(chalk.blue('\n🎙️  TTS Cloudflare Workflow Commands:\n'));
      console.log(chalk.white('  node tts-cloudflare-workflow.js run    - Process all blog posts'));
      console.log(chalk.white('  node tts-cloudflare-workflow.js test   - Test with 1 post'));
      console.log(chalk.white('  node tts-cloudflare-workflow.js batch N - Process N posts'));
      console.log(chalk.white('  node tts-cloudflare-workflow.js help   - Show this help\n'));
      break;

    default:
      console.error(chalk.red(`Unknown command: ${command}`));
      console.log(chalk.yellow('Use "help" to see available commands'));
  }
}

main().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});