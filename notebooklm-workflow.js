import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

class NotebookLMWorkflow {
  constructor() {
    this.databaseId = null;
    this.outputDir = path.join(__dirname, 'notebooklm_output');
    this.processedDir = path.join(__dirname, 'notebooklm_processed');
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

      case 'divider':
        text = '\n---\n';
        break;

      default:
        break;
    }

    // Add appropriate formatting based on block type
    switch (block.type) {
      case 'heading_1':
        return `\n# ${text}\n`;
      case 'heading_2':
        return `\n## ${text}\n`;
      case 'heading_3':
        return `\n### ${text}\n`;
      case 'bulleted_list_item':
        return `• ${text}\n`;
      case 'numbered_list_item':
        return `1. ${text}\n`;
      case 'quote':
        return `> ${text}\n`;
      case 'code':
        return `\`\`\`\n${text}\n\`\`\`\n`;
      default:
        return text ? `${text}\n` : '';
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

    return contentParts.join('');
  }

  async getPageMetadata(page) {
    const title = page.properties.Name?.title?.[0]?.plain_text ||
                 page.properties.Title?.title?.[0]?.plain_text ||
                 page.properties.name?.title?.[0]?.plain_text ||
                 'Untitled';

    const slug = page.properties['Slug-AI']?.rich_text?.[0]?.plain_text ||
                page.properties['slug-ai']?.rich_text?.[0]?.plain_text ||
                page.properties.Slug?.rich_text?.[0]?.plain_text ||
                title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const url = `https://getcolby.com/blog/${slug}`;

    // Check for existing media links
    const videoLink = page.properties.VideoLink?.url ||
                     page.properties.videolink?.url ||
                     page.properties.NotebookLMVideo?.url ||
                     null;

    const audioLink = page.properties.AudioLink?.url ||
                     page.properties.audiolink?.url ||
                     page.properties.NotebookLMAudio?.url ||
                     null;

    return {
      id: page.id,
      title,
      slug,
      url,
      videoLink,
      audioLink,
      hasMedia: !!(videoLink || audioLink)
    };
  }

  async pullContentForNotebookLM(forceRefresh = false) {
    console.log(chalk.blue('\n📚 Step 1: Pulling content from Notion for NotebookLM\n'));

    if (!this.databaseId) {
      this.databaseId = await this.findBlogsDatabase();
      if (!this.databaseId) {
        throw new Error('Failed to find Blogs database');
      }
    }

    const spinner = ora('Fetching blog pages...').start();
    const pages = [];
    let hasMore = true;
    let cursor = undefined;

    while (hasMore) {
      const response = await notion.databases.query({
        database_id: this.databaseId,
        start_cursor: cursor,
        page_size: 100
      });

      pages.push(...response.results);
      hasMore = response.has_more;
      cursor = response.next_cursor;
    }

    spinner.succeed(chalk.green(`Found ${pages.length} blog posts`));

    // Create output directory
    await fs.mkdir(this.outputDir, { recursive: true });

    const exportedPages = [];
    let skippedCount = 0;
    let errorCount = 0;

    for (const page of pages) {
      const metadata = await this.getPageMetadata(page);

      // Skip if already has media and not forcing refresh
      if (metadata.hasMedia && !forceRefresh) {
        skippedCount++;
        console.log(chalk.gray(`  ⏭️  Skipped (has media): ${metadata.title}`));
        continue;
      }

      try {
        spinner.start(`Extracting: ${metadata.title}`);

        // Extract full content
        const content = await this.extractPageContent(page.id);

        if (!content || content.trim().length < 100) {
          spinner.warn(chalk.yellow(`  ⚠️  Skipped (too short): ${metadata.title}`));
          skippedCount++;
          continue;
        }

        // Create markdown file with metadata
        const markdown = `# ${metadata.title}

**Blog URL:** ${metadata.url}
**Page ID:** ${metadata.id}
**Slug:** ${metadata.slug}
**Date:** ${new Date().toISOString().split('T')[0]}

---

${content}

---

## Metadata for NotebookLM

This content is from the blog post "${metadata.title}" published at ${metadata.url}.

When creating audio/video content, please:
1. Create an engaging introduction
2. Discuss the main points thoroughly
3. Provide practical examples and insights
4. Conclude with key takeaways

---
`;

        const filename = path.join(this.outputDir, `${metadata.slug}.md`);
        await fs.writeFile(filename, markdown);

        // Save metadata for later processing
        const metadataFile = path.join(this.outputDir, `${metadata.slug}.json`);
        await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2));

        exportedPages.push(metadata);
        spinner.succeed(chalk.green(`  ✅ Exported: ${metadata.title}`));

      } catch (error) {
        errorCount++;
        spinner.fail(chalk.red(`  ❌ Error: ${metadata.title} - ${error.message}`));
      }
    }

    // Create batch manifest
    const manifest = {
      timestamp: new Date().toISOString(),
      totalPages: pages.length,
      exported: exportedPages.length,
      skipped: skippedCount,
      errors: errorCount,
      pages: exportedPages
    };

    await fs.writeFile(
      path.join(this.outputDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );

    console.log(chalk.blue('\n📊 Export Summary'));
    console.log(chalk.blue('═'.repeat(40)));
    console.log(chalk.green(`✅ Exported: ${exportedPages.length} posts`));
    console.log(chalk.gray(`⏭️  Skipped: ${skippedCount} posts`));
    if (errorCount > 0) {
      console.log(chalk.red(`❌ Errors: ${errorCount} posts`));
    }
    console.log(chalk.blue('═'.repeat(40)));
    console.log(chalk.cyan(`\n📁 Files saved to: ${this.outputDir}`));

    return exportedPages;
  }

  async createNotebookLMInstructions() {
    console.log(chalk.blue('\n📝 Step 2: Creating NotebookLM processing instructions\n'));

    const instructionsFile = path.join(this.outputDir, 'NOTEBOOKLM_INSTRUCTIONS.md');

    const instructions = `# NotebookLM Processing Instructions

## Overview
This folder contains markdown files ready for NotebookLM processing.

## Manual Processing Steps:

### 1. Create NotebookLM Project
1. Go to https://notebooklm.google.com
2. Create a new notebook called "Blog Content"
3. Upload all .md files from this folder

### 2. Generate Audio Overview
1. Click on "Generate" or "Audio Overview"
2. Let NotebookLM process the content
3. Download the generated audio file
4. Note the audio file URL/location

### 3. Generate Video (if available)
1. If NotebookLM supports video generation, create it
2. Download the generated video file
3. Note the video file URL/location

### 4. Save Media Information
For each processed file, create a corresponding .media.json file with:
\`\`\`json
{
  "slug": "blog-post-slug",
  "audioUrl": "https://...",
  "videoUrl": "https://...",
  "processedAt": "2025-01-16T..."
}
\`\`\`

## Automated Processing (Future Enhancement)
The workflow script will look for .media.json files to sync back to Notion.

## Tips:
- Process in batches of 5-10 files for best results
- Keep audio files under 60 minutes for optimal quality
- Save all generated media to a cloud storage service
- Use consistent naming conventions

---
Generated: ${new Date().toISOString()}
`;

    await fs.writeFile(instructionsFile, instructions);
    console.log(chalk.green(`✅ Instructions created: ${instructionsFile}`));
  }

  async syncMediaLinksToNotion() {
    console.log(chalk.blue('\n🔄 Step 3: Syncing media links back to Notion\n'));

    // Look for .media.json files in the output directory
    const files = await fs.readdir(this.outputDir);
    const mediaFiles = files.filter(f => f.endsWith('.media.json'));

    if (mediaFiles.length === 0) {
      console.log(chalk.yellow('No media files found to sync'));
      console.log(chalk.gray('After processing in NotebookLM, create .media.json files'));
      return;
    }

    let syncedCount = 0;
    let errorCount = 0;

    for (const mediaFile of mediaFiles) {
      try {
        const mediaPath = path.join(this.outputDir, mediaFile);
        const mediaData = JSON.parse(await fs.readFile(mediaPath, 'utf-8'));

        // Find the corresponding metadata file
        const metadataPath = path.join(this.outputDir, `${mediaData.slug}.json`);
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));

        console.log(chalk.cyan(`Syncing: ${metadata.title}`));

        // Update Notion page with media links
        const updateData = {
          page_id: metadata.id,
          properties: {}
        };

        if (mediaData.videoUrl) {
          updateData.properties.VideoLink = { url: mediaData.videoUrl };
        }

        if (mediaData.audioUrl) {
          updateData.properties.AudioLink = { url: mediaData.audioUrl };
        }

        await notion.pages.update(updateData);

        // Move processed files to processed directory
        await fs.mkdir(this.processedDir, { recursive: true });
        await fs.rename(
          mediaPath,
          path.join(this.processedDir, mediaFile)
        );

        syncedCount++;
        console.log(chalk.green(`  ✅ Synced: ${metadata.title}`));

      } catch (error) {
        errorCount++;
        console.error(chalk.red(`  ❌ Error syncing ${mediaFile}: ${error.message}`));
      }
    }

    console.log(chalk.blue('\n📊 Sync Summary'));
    console.log(chalk.blue('═'.repeat(40)));
    console.log(chalk.green(`✅ Synced: ${syncedCount} posts`));
    if (errorCount > 0) {
      console.log(chalk.red(`❌ Errors: ${errorCount} posts`));
    }
    console.log(chalk.blue('═'.repeat(40)));
  }

  async runFullWorkflow() {
    console.log(chalk.blue('\n🚀 NotebookLM Integration Workflow\n'));
    console.log(chalk.cyan('This workflow will:'));
    console.log(chalk.white('1. Pull content from Notion blogs'));
    console.log(chalk.white('2. Prepare it for NotebookLM processing'));
    console.log(chalk.white('3. Sync media links back to Notion\n'));

    try {
      // Step 1: Pull content
      const exportedPages = await this.pullContentForNotebookLM();

      // Step 2: Create instructions
      await this.createNotebookLMInstructions();

      // Step 3: Attempt to sync (will only work if media files exist)
      await this.syncMediaLinksToNotion();

      console.log(chalk.green('\n✨ Workflow complete!\n'));
      console.log(chalk.yellow('Next steps:'));
      console.log(chalk.white(`1. Open ${this.outputDir}`));
      console.log(chalk.white('2. Upload .md files to NotebookLM'));
      console.log(chalk.white('3. Generate audio/video content'));
      console.log(chalk.white('4. Create .media.json files with the URLs'));
      console.log(chalk.white('5. Run this script again to sync the media links\n'));

    } catch (error) {
      console.error(chalk.red(`\n❌ Workflow failed: ${error.message}`));
      process.exit(1);
    }
  }

  // Helper method to create a media file after NotebookLM processing
  async createMediaFile(slug, audioUrl, videoUrl) {
    const mediaData = {
      slug,
      audioUrl: audioUrl || null,
      videoUrl: videoUrl || null,
      processedAt: new Date().toISOString()
    };

    const mediaPath = path.join(this.outputDir, `${slug}.media.json`);
    await fs.writeFile(mediaPath, JSON.stringify(mediaData, null, 2));

    console.log(chalk.green(`✅ Created media file for ${slug}`));
    return mediaData;
  }
}

// Command-line interface
async function main() {
  const workflow = new NotebookLMWorkflow();

  const args = process.argv.slice(2);
  const command = args[0] || 'run';

  switch (command) {
    case 'pull':
      await workflow.pullContentForNotebookLM();
      break;

    case 'sync':
      await workflow.syncMediaLinksToNotion();
      break;

    case 'run':
      await workflow.runFullWorkflow();
      break;

    case 'help':
      console.log(chalk.blue('\n📚 NotebookLM Workflow Commands:\n'));
      console.log(chalk.white('  node notebooklm-workflow.js pull  - Pull content from Notion'));
      console.log(chalk.white('  node notebooklm-workflow.js sync  - Sync media links to Notion'));
      console.log(chalk.white('  node notebooklm-workflow.js run   - Run full workflow'));
      console.log(chalk.white('  node notebooklm-workflow.js help  - Show this help\n'));
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