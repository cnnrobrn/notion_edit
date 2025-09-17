import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
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

async function extractTextFromBlock(block) {
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

async function getAllBlocksFromPage(pageId) {
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
          const childBlocks = await getAllBlocksFromPage(block.id);
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

async function extractPageContent(pageId) {
  const blocks = await getAllBlocksFromPage(pageId);
  const contentParts = [];

  for (const block of blocks) {
    const text = await extractTextFromBlock(block);
    if (text && text.trim()) {
      contentParts.push(text);
    }
  }

  return contentParts.join('');
}

async function getExistingNotebookLMLink(page) {
  // Check if there's already a NotebookLM link stored
  const notebookLMProperty = page.properties.NotebookLM || page.properties.notebooklm || page.properties.VideoLink;

  if (notebookLMProperty && notebookLMProperty.type === 'url') {
    return notebookLMProperty.url;
  }

  if (notebookLMProperty && notebookLMProperty.type === 'rich_text') {
    const text = notebookLMProperty.rich_text?.[0]?.plain_text || '';
    if (text.includes('notebooklm.google.com')) {
      return text;
    }
  }

  return null;
}

async function updatePageWithNotebookLMLink(pageId, link) {
  try {
    await notion.pages.update({
      page_id: pageId,
      properties: {
        'NotebookLM': {
          url: link
        }
      }
    });
    return true;
  } catch (error) {
    // If NotebookLM field doesn't exist, try VideoLink
    try {
      await notion.pages.update({
        page_id: pageId,
        properties: {
          'VideoLink': {
            url: link
          }
        }
      });
      return true;
    } catch (error2) {
      console.error(chalk.red(`  ✗ Error updating page with link: ${error2.message}`));
      console.log(chalk.yellow(`  💡 Make sure you have a "NotebookLM" or "VideoLink" URL field in your database`));
      return false;
    }
  }
}

async function createBatchExport(pages, outputDir) {
  const batchSize = 10; // Process in batches of 10 for NotebookLM
  const batches = [];

  for (let i = 0; i < pages.length; i += batchSize) {
    batches.push(pages.slice(i, i + batchSize));
  }

  console.log(chalk.cyan(`\n📦 Creating ${batches.length} batches for NotebookLM import`));

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchDir = path.join(outputDir, `batch_${String(batchIndex + 1).padStart(3, '0')}`);
    await fs.mkdir(batchDir, { recursive: true });

    const batchInfo = {
      batchNumber: batchIndex + 1,
      totalBatches: batches.length,
      posts: []
    };

    for (const page of batch) {
      const title = page.properties.Name?.title?.[0]?.plain_text ||
                   page.properties.Title?.title?.[0]?.plain_text ||
                   `Untitled_${page.id.substring(0, 8)}`;

      const slug = title.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 50);

      batchInfo.posts.push({
        id: page.id,
        title: title,
        filename: `${slug}.md`
      });
    }

    // Create batch info file
    await fs.writeFile(
      path.join(batchDir, 'batch_info.json'),
      JSON.stringify(batchInfo, null, 2)
    );

    // Create instructions file
    const instructions = `# NotebookLM Batch ${batchIndex + 1} of ${batches.length}

## Instructions for NotebookLM Import:

1. Go to https://notebooklm.google.com
2. Create a new notebook named: "Blog Batch ${batchIndex + 1}"
3. Upload all .md files from this folder (${batch.length} files)
4. Generate an Audio Overview for the notebook
5. Copy the notebook sharing link
6. Update the batch_info.json with the NotebookLM link

## Posts in this batch:
${batchInfo.posts.map(p => `- ${p.title}`).join('\n')}

## After generating the audio:
Run the update script to add the NotebookLM links back to Notion.
`;

    await fs.writeFile(
      path.join(batchDir, 'README.md'),
      instructions
    );

    console.log(chalk.gray(`  📁 Batch ${batchIndex + 1}: ${batch.length} posts`));
  }

  return batches;
}

async function main() {
  console.log(chalk.blue('\n📚 NotebookLM Content Preparation Tool\n'));

  if (!process.env.NOTION_API_KEY) {
    console.error(chalk.red('❌ NOTION_API_KEY is not set in .env file'));
    process.exit(1);
  }

  const databaseId = await findBlogsDatabase();
  if (!databaseId) {
    console.error(chalk.red('Failed to find Blogs database'));
    process.exit(1);
  }

  const spinner = ora('Fetching all blog pages...').start();

  try {
    const allPages = [];
    let hasMore = true;
    let cursor = undefined;

    while (hasMore) {
      const response = await notion.databases.query({
        database_id: databaseId,
        start_cursor: cursor,
        page_size: 100
      });

      allPages.push(...response.results);
      hasMore = response.has_more;
      cursor = response.next_cursor;
    }

    spinner.succeed(chalk.green(`Found ${allPages.length} blog posts`));

    // Create output directory
    const outputDir = path.join(process.cwd(), 'notebooklm_export');
    await fs.mkdir(outputDir, { recursive: true });

    console.log(chalk.cyan(`\n📁 Output directory: ${outputDir}`));

    // Statistics
    let processedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Create batches for NotebookLM
    const batches = await createBatchExport(allPages, outputDir);

    // Process each page and save content
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const batchDir = path.join(outputDir, `batch_${String(batchIndex + 1).padStart(3, '0')}`);

      console.log(chalk.cyan(`\n📝 Processing batch ${batchIndex + 1}/${batches.length}`));

      for (const page of batch) {
        const title = page.properties.Name?.title?.[0]?.plain_text ||
                     page.properties.Title?.title?.[0]?.plain_text ||
                     `Untitled_${page.id.substring(0, 8)}`;

        // Check if already has NotebookLM link
        const existingLink = await getExistingNotebookLMLink(page);
        if (existingLink) {
          skippedCount++;
          console.log(chalk.gray(`  ⏭️  Skipped (has link): ${title}`));
          continue;
        }

        try {
          spinner.start(`Processing: ${title}`);

          // Extract content
          const content = await extractPageContent(page.id);

          if (!content || content.trim().length < 100) {
            spinner.warn(chalk.yellow(`  ⚠️  Skipped (too short): ${title}`));
            skippedCount++;
            continue;
          }

          // Create markdown file with metadata
          const markdown = `# ${title}

*Blog Post ID: ${page.id}*
*Date: ${new Date().toISOString().split('T')[0]}*

---

${content}

---

## NotebookLM Instructions

This content is ready for NotebookLM processing. To generate an audio overview:

1. Import this file into NotebookLM
2. Generate Audio Overview
3. Share the notebook and get the link
4. Update Notion with the link

---
`;

          // Save to file
          const slug = title.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 50);

          const filename = path.join(batchDir, `${slug}.md`);
          await fs.writeFile(filename, markdown);

          processedCount++;
          spinner.succeed(chalk.green(`  ✅ Exported: ${title}`));

        } catch (error) {
          errorCount++;
          spinner.fail(chalk.red(`  ❌ Error: ${title} - ${error.message}`));
        }
      }
    }

    // Create master instructions
    const masterInstructions = `# NotebookLM Bulk Processing Instructions

## Overview
- Total posts: ${allPages.length}
- Batches created: ${batches.length}
- Posts per batch: ~10

## Processing Steps:

1. **For each batch folder:**
   - Go to https://notebooklm.google.com
   - Create a new notebook
   - Upload all .md files from the batch
   - Generate Audio Overview
   - Get shareable link

2. **Update tracking sheet:**
   - Record NotebookLM link for each batch
   - Note any issues or missing content

3. **Run update script:**
   - Use the update script to sync links back to Notion

## Automation Tips:
- Use Google Apps Script to batch create notebooks
- Consider using Zapier/Make for automation
- Process batches during off-peak hours

## Status:
- Processed: ${processedCount} posts
- Skipped: ${skippedCount} posts
- Errors: ${errorCount} posts

Generated: ${new Date().toISOString()}
`;

    await fs.writeFile(
      path.join(outputDir, 'README.md'),
      masterInstructions
    );

    console.log(chalk.blue('\n📊 Summary'));
    console.log(chalk.blue('═'.repeat(40)));
    console.log(chalk.green(`✅ Exported: ${processedCount} posts`));
    console.log(chalk.gray(`⏭️  Skipped: ${skippedCount} posts`));
    if (errorCount > 0) {
      console.log(chalk.red(`❌ Errors: ${errorCount} posts`));
    }
    console.log(chalk.blue('═'.repeat(40)));
    console.log(chalk.cyan(`\n📁 Files saved to: ${outputDir}`));
    console.log(chalk.yellow('\n🎯 Next steps:'));
    console.log(chalk.white('  1. Open each batch folder'));
    console.log(chalk.white('  2. Upload files to NotebookLM'));
    console.log(chalk.white('  3. Generate audio overviews'));
    console.log(chalk.white('  4. Save the NotebookLM links'));
    console.log(chalk.white('  5. Run update script to sync back to Notion\n'));

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