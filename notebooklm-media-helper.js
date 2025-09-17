import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

class NotebookLMMediaHelper {
  constructor() {
    this.outputDir = path.join(__dirname, 'notebooklm_output');
    this.mediaStorageDir = path.join(__dirname, 'media_storage');
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async question(prompt) {
    return new Promise(resolve => {
      this.rl.question(prompt, resolve);
    });
  }

  async listUnprocessedFiles() {
    console.log(chalk.blue('\n📋 Checking for unprocessed files...\n'));

    const files = await fs.readdir(this.outputDir);
    const markdownFiles = files.filter(f => f.endsWith('.md'));
    const mediaFiles = files.filter(f => f.endsWith('.media.json'));

    const unprocessed = [];

    for (const mdFile of markdownFiles) {
      const slug = mdFile.replace('.md', '');
      const hasMedia = mediaFiles.includes(`${slug}.media.json`);

      if (!hasMedia) {
        // Get the metadata to show title
        const metadataPath = path.join(this.outputDir, `${slug}.json`);
        try {
          const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
          unprocessed.push({
            slug,
            title: metadata.title,
            file: mdFile
          });
        } catch (error) {
          unprocessed.push({
            slug,
            title: slug,
            file: mdFile
          });
        }
      }
    }

    if (unprocessed.length === 0) {
      console.log(chalk.green('✅ All files have been processed!'));
      return [];
    }

    console.log(chalk.yellow(`Found ${unprocessed.length} unprocessed files:\n`));
    unprocessed.forEach((item, index) => {
      console.log(chalk.white(`  ${index + 1}. ${item.title}`));
      console.log(chalk.gray(`     File: ${item.file}`));
    });

    return unprocessed;
  }

  async recordMediaForFile() {
    const unprocessed = await this.listUnprocessedFiles();

    if (unprocessed.length === 0) {
      return;
    }

    console.log(chalk.cyan('\n📝 Record media URLs for processed files\n'));

    const choice = await this.question('\nSelect file number to record media (or "all" for batch, "q" to quit): ');

    if (choice.toLowerCase() === 'q') {
      this.rl.close();
      return;
    }

    if (choice.toLowerCase() === 'all') {
      await this.batchRecordMedia(unprocessed);
    } else {
      const index = parseInt(choice) - 1;
      if (index >= 0 && index < unprocessed.length) {
        await this.recordSingleMedia(unprocessed[index]);
      } else {
        console.log(chalk.red('Invalid selection'));
      }
    }

    // Ask if want to continue
    const continueChoice = await this.question('\nRecord another? (y/n): ');
    if (continueChoice.toLowerCase() === 'y') {
      await this.recordMediaForFile();
    } else {
      this.rl.close();
    }
  }

  async recordSingleMedia(item) {
    console.log(chalk.blue(`\n📹 Recording media for: ${item.title}\n`));

    const audioUrl = await this.question('Audio URL (press Enter to skip): ');
    const videoUrl = await this.question('Video URL (press Enter to skip): ');

    if (!audioUrl && !videoUrl) {
      console.log(chalk.yellow('No media URLs provided, skipping...'));
      return;
    }

    const mediaData = {
      slug: item.slug,
      audioUrl: audioUrl || null,
      videoUrl: videoUrl || null,
      processedAt: new Date().toISOString()
    };

    const mediaPath = path.join(this.outputDir, `${item.slug}.media.json`);
    await fs.writeFile(mediaPath, JSON.stringify(mediaData, null, 2));

    console.log(chalk.green(`✅ Media file created for ${item.title}`));

    // Optionally sync immediately
    const syncNow = await this.question('Sync to Notion now? (y/n): ');
    if (syncNow.toLowerCase() === 'y') {
      await this.syncSingleMedia(mediaData, item);
    }
  }

  async batchRecordMedia(items) {
    console.log(chalk.blue('\n📹 Batch media recording\n'));
    console.log(chalk.gray('Enter URLs for each file. Press Enter to skip.\n'));

    const mediaRecords = [];

    for (const item of items) {
      console.log(chalk.cyan(`\n${item.title}:`));
      const audioUrl = await this.question('  Audio URL: ');
      const videoUrl = await this.question('  Video URL: ');

      if (audioUrl || videoUrl) {
        const mediaData = {
          slug: item.slug,
          audioUrl: audioUrl || null,
          videoUrl: videoUrl || null,
          processedAt: new Date().toISOString()
        };

        const mediaPath = path.join(this.outputDir, `${item.slug}.media.json`);
        await fs.writeFile(mediaPath, JSON.stringify(mediaData, null, 2));

        mediaRecords.push({ mediaData, item });
        console.log(chalk.green(`  ✅ Recorded`));
      } else {
        console.log(chalk.gray(`  ⏭️  Skipped`));
      }
    }

    if (mediaRecords.length > 0) {
      console.log(chalk.green(`\n✅ Created ${mediaRecords.length} media files`));

      const syncNow = await this.question('\nSync all to Notion now? (y/n): ');
      if (syncNow.toLowerCase() === 'y') {
        for (const record of mediaRecords) {
          await this.syncSingleMedia(record.mediaData, record.item);
        }
      }
    }
  }

  async syncSingleMedia(mediaData, item) {
    try {
      const metadataPath = path.join(this.outputDir, `${item.slug}.json`);
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));

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
      console.log(chalk.green(`  ✅ Synced to Notion: ${item.title}`));
    } catch (error) {
      console.error(chalk.red(`  ❌ Sync failed: ${error.message}`));
    }
  }

  async generateBatchCSV() {
    console.log(chalk.blue('\n📊 Generating batch processing CSV...\n'));

    const files = await fs.readdir(this.outputDir);
    const markdownFiles = files.filter(f => f.endsWith('.md'));

    const csvLines = ['Title,Slug,File,URL,Status,AudioURL,VideoURL'];

    for (const mdFile of markdownFiles) {
      const slug = mdFile.replace('.md', '');
      const metadataPath = path.join(this.outputDir, `${slug}.json`);
      const mediaPath = path.join(this.outputDir, `${slug}.media.json`);

      try {
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
        let status = 'Pending';
        let audioUrl = '';
        let videoUrl = '';

        try {
          const media = JSON.parse(await fs.readFile(mediaPath, 'utf-8'));
          status = 'Processed';
          audioUrl = media.audioUrl || '';
          videoUrl = media.videoUrl || '';
        } catch (e) {
          // No media file yet
        }

        csvLines.push(`"${metadata.title}","${slug}","${mdFile}","${metadata.url}","${status}","${audioUrl}","${videoUrl}"`);
      } catch (error) {
        console.error(chalk.red(`Error processing ${mdFile}: ${error.message}`));
      }
    }

    const csvPath = path.join(this.outputDir, 'batch_processing.csv');
    await fs.writeFile(csvPath, csvLines.join('\n'));

    console.log(chalk.green(`✅ CSV created: ${csvPath}`));
    console.log(chalk.gray('You can use this CSV to track NotebookLM processing'));
  }

  async importFromCSV() {
    console.log(chalk.blue('\n📥 Import media URLs from CSV\n'));

    const csvPath = path.join(this.outputDir, 'batch_processing.csv');

    try {
      const csvContent = await fs.readFile(csvPath, 'utf-8');
      const lines = csvContent.split('\n');
      const header = lines[0];

      if (!header.includes('AudioURL') || !header.includes('VideoURL')) {
        console.error(chalk.red('CSV must have AudioURL and VideoURL columns'));
        return;
      }

      let imported = 0;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        // Simple CSV parsing (assumes quoted fields)
        const matches = line.match(/"([^"]*)"/g);
        if (matches && matches.length >= 7) {
          const slug = matches[1].replace(/"/g, '');
          const audioUrl = matches[5].replace(/"/g, '');
          const videoUrl = matches[6].replace(/"/g, '');

          if (audioUrl || videoUrl) {
            const mediaData = {
              slug,
              audioUrl: audioUrl || null,
              videoUrl: videoUrl || null,
              processedAt: new Date().toISOString()
            };

            const mediaPath = path.join(this.outputDir, `${slug}.media.json`);
            await fs.writeFile(mediaPath, JSON.stringify(mediaData, null, 2));
            imported++;
          }
        }
      }

      console.log(chalk.green(`✅ Imported ${imported} media records from CSV`));

      if (imported > 0) {
        const syncNow = await this.question('Sync all to Notion now? (y/n): ');
        if (syncNow.toLowerCase() === 'y') {
          await this.syncAllMedia();
        }
      }

    } catch (error) {
      console.error(chalk.red(`Error reading CSV: ${error.message}`));
    }
  }

  async syncAllMedia() {
    console.log(chalk.blue('\n🔄 Syncing all media to Notion...\n'));

    const files = await fs.readdir(this.outputDir);
    const mediaFiles = files.filter(f => f.endsWith('.media.json'));

    let syncedCount = 0;
    let errorCount = 0;

    for (const mediaFile of mediaFiles) {
      try {
        const mediaPath = path.join(this.outputDir, mediaFile);
        const mediaData = JSON.parse(await fs.readFile(mediaPath, 'utf-8'));

        const metadataPath = path.join(this.outputDir, `${mediaData.slug}.json`);
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));

        console.log(chalk.cyan(`Syncing: ${metadata.title}`));

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

        syncedCount++;
        console.log(chalk.green(`  ✅ Synced`));

      } catch (error) {
        errorCount++;
        console.error(chalk.red(`  ❌ Error: ${error.message}`));
      }
    }

    console.log(chalk.blue('\n📊 Summary'));
    console.log(chalk.blue('═'.repeat(40)));
    console.log(chalk.green(`✅ Synced: ${syncedCount} posts`));
    if (errorCount > 0) {
      console.log(chalk.red(`❌ Errors: ${errorCount} posts`));
    }
  }

  async showMenu() {
    console.log(chalk.blue('\n🎯 NotebookLM Media Helper\n'));
    console.log(chalk.white('1. List unprocessed files'));
    console.log(chalk.white('2. Record media URLs'));
    console.log(chalk.white('3. Generate batch CSV'));
    console.log(chalk.white('4. Import from CSV'));
    console.log(chalk.white('5. Sync all to Notion'));
    console.log(chalk.white('6. Exit\n'));

    const choice = await this.question('Select option (1-6): ');

    switch (choice) {
      case '1':
        await this.listUnprocessedFiles();
        break;
      case '2':
        await this.recordMediaForFile();
        break;
      case '3':
        await this.generateBatchCSV();
        break;
      case '4':
        await this.importFromCSV();
        break;
      case '5':
        await this.syncAllMedia();
        break;
      case '6':
        this.rl.close();
        return;
      default:
        console.log(chalk.red('Invalid option'));
    }

    // Show menu again unless exited
    if (choice !== '6' && choice !== '2') {
      await this.showMenu();
    } else if (choice !== '6') {
      this.rl.close();
    }
  }
}

async function main() {
  const helper = new NotebookLMMediaHelper();
  await helper.showMenu();
}

main().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});