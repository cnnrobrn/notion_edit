import { Client } from '@notionhq/client';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function findBlogsDatabase() {
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

async function convertTextToSpeech(text, maxRetries = 3) {
  const maxLength = 4096;

  if (!text || text.trim().length === 0) {
    console.log(chalk.yellow('  ⚠ Empty text, skipping TTS conversion'));
    return null;
  }

  const processedText = text.substring(0, maxLength);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mp3Response = await openai.audio.speech.create({
        model: "tts-1",
        voice: "onyx",
        input: processedText,
      });

      const buffer = Buffer.from(await mp3Response.arrayBuffer());

      const base64Audio = buffer.toString('base64');

      return base64Audio;
    } catch (error) {
      console.log(chalk.yellow(`  ⚠ TTS attempt ${attempt}/${maxRetries} failed: ${error.message}`));

      if (attempt === maxRetries) {
        console.log(chalk.red(`  ✗ Failed to convert text to speech after ${maxRetries} attempts`));
        return null;
      }

      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }

  return null;
}

async function updatePageWithAudio(pageId, audioBase64) {
  try {
    const chunks = [];
    const maxChunkSize = 2000;

    for (let i = 0; i < audioBase64.length; i += maxChunkSize) {
      chunks.push({
        type: 'text',
        text: {
          content: audioBase64.substring(i, Math.min(i + maxChunkSize, audioBase64.length))
        }
      });
    }

    await notion.pages.update({
      page_id: pageId,
      properties: {
        'Content64': {
          rich_text: chunks
        }
      }
    });

    return true;
  } catch (error) {
    console.error(chalk.red(`  ✗ Error updating page with audio: ${error.message}`));
    return false;
  }
}

async function getPageContent(page) {
  const contentProperty = page.properties.Content || page.properties.content;

  if (!contentProperty || contentProperty.type !== 'rich_text') {
    return null;
  }

  const richTextArray = contentProperty.rich_text || [];

  return richTextArray.map(rt => rt.plain_text || '').join('');
}

async function hasExistingAudio(page) {
  const content64Property = page.properties.Content64 || page.properties.content64;

  if (!content64Property || content64Property.type !== 'rich_text') {
    return false;
  }

  const richTextArray = content64Property.rich_text || [];

  const existingContent = richTextArray.map(rt => rt.plain_text || '').join('').trim();

  return existingContent.length > 0;
}

async function main() {
  console.log(chalk.blue('\n🎙️  Starting Text-to-Speech conversion for blog posts...\n'));

  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
    console.error(chalk.red('❌ OPENAI_API_KEY is not set in .env file'));
    console.log(chalk.yellow('Please add your OpenAI API key to the .env file'));
    process.exit(1);
  }

  const databaseId = await findBlogsDatabase();
  if (!databaseId) {
    console.error(chalk.red('Failed to find Blogs database'));
    process.exit(1);
  }

  const spinner = ora('Fetching blog pages...').start();

  try {
    let hasMore = true;
    let cursor = undefined;
    let processedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let emptyContentCount = 0;

    while (hasMore) {
      const response = await notion.databases.query({
        database_id: databaseId,
        start_cursor: cursor,
        page_size: 10
      });

      for (const page of response.results) {
        const title = page.properties.Name?.title?.[0]?.plain_text ||
                     page.properties.Title?.title?.[0]?.plain_text ||
                     page.properties.name?.title?.[0]?.plain_text ||
                     'Untitled';

        spinner.stop();
        console.log(chalk.cyan(`\nProcessing: ${title}`));
        spinner.start(`Processing: ${title}`);

        if (await hasExistingAudio(page)) {
          skippedCount++;
          spinner.stop();
          console.log(chalk.gray(`  ⏭️  Skipped (already has audio): ${title}`));
          spinner.start();
          continue;
        }

        const content = await getPageContent(page);

        if (!content || content.trim().length === 0) {
          emptyContentCount++;
          spinner.stop();
          console.log(chalk.yellow(`  ⚠️  No content found in: ${title}`));
          spinner.start();
          continue;
        }

        spinner.stop();
        console.log(chalk.gray(`  📝 Content length: ${content.length} characters`));
        console.log(chalk.gray(`  🎤 Converting to speech with onyx voice...`));
        spinner.start(`Converting ${title} to speech...`);

        const audioBase64 = await convertTextToSpeech(content);

        if (audioBase64) {
          spinner.stop();
          console.log(chalk.gray(`  📦 Audio size: ${(audioBase64.length / 1024).toFixed(2)} KB (base64)`));
          spinner.start(`Updating ${title} in Notion...`);

          const success = await updatePageWithAudio(page.id, audioBase64);

          if (success) {
            processedCount++;
            spinner.stop();
            console.log(chalk.green(`  ✅ Successfully processed: ${title}`));
            spinner.start();
          } else {
            failedCount++;
            spinner.stop();
            console.log(chalk.red(`  ❌ Failed to update: ${title}`));
            spinner.start();
          }
        } else {
          failedCount++;
          spinner.stop();
          console.log(chalk.red(`  ❌ Failed to convert to speech: ${title}`));
          spinner.start();
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      hasMore = response.has_more;
      cursor = response.next_cursor;
    }

    spinner.stop();

    console.log(chalk.blue('\n📊 Summary'));
    console.log(chalk.blue('═'.repeat(40)));
    console.log(chalk.green(`✅ Successfully processed: ${processedCount} pages`));
    console.log(chalk.gray(`⏭️  Skipped (already had audio): ${skippedCount} pages`));
    console.log(chalk.yellow(`⚠️  Empty content: ${emptyContentCount} pages`));
    if (failedCount > 0) {
      console.log(chalk.red(`❌ Failed: ${failedCount} pages`));
    }
    console.log(chalk.blue('═'.repeat(40)));
    console.log(chalk.green('\n✨ TTS conversion complete!\n'));

  } catch (error) {
    spinner.fail(chalk.red(`Error: ${error.message}`));
    console.error(chalk.red('\nStack trace:'), error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});