import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
import chalk from 'chalk';
import ora from 'ora';

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

async function clearContent64Fields(databaseId) {
  console.log(chalk.cyan('\n🧹 Starting Content64 field cleanup...\n'));

  const spinner = ora('Fetching all blog pages...').start();

  try {
    let hasMore = true;
    let cursor = undefined;
    let totalPages = 0;
    let clearedPages = 0;
    let skippedPages = 0;
    let errorCount = 0;

    while (hasMore) {
      const response = await notion.databases.query({
        database_id: databaseId,
        start_cursor: cursor,
        page_size: 10
      });

      for (const page of response.results) {
        totalPages++;

        const title = page.properties.Name?.title?.[0]?.plain_text ||
                     page.properties.Title?.title?.[0]?.plain_text ||
                     'Untitled';

        spinner.stop();
        console.log(chalk.cyan(`\n📄 Processing: ${title}`));
        spinner.start(`Clearing Content64 fields...`);

        // Check if any Content64 fields have data
        let hasContent64Data = false;
        const fieldsToCheck = ['Content64'];

        // Add numbered fields
        for (let i = 2; i <= 15; i++) {
          fieldsToCheck.push(`Content64_${i}`);
        }

        for (const fieldName of fieldsToCheck) {
          const field = page.properties[fieldName];
          if (field && field.type === 'rich_text' && field.rich_text && field.rich_text.length > 0) {
            hasContent64Data = true;
            break;
          }
        }

        if (!hasContent64Data) {
          skippedPages++;
          spinner.stop();
          console.log(chalk.gray(`  ⏭️  Skipped (no Content64 data): ${title}`));
          spinner.start();
          continue;
        }

        // Clear all Content64 fields
        let fieldsCleared = 0;
        let fieldsFailed = 0;

        for (const fieldName of fieldsToCheck) {
          const field = page.properties[fieldName];

          if (field && field.type === 'rich_text' && field.rich_text && field.rich_text.length > 0) {
            try {
              await notion.pages.update({
                page_id: page.id,
                properties: {
                  [fieldName]: {
                    rich_text: []
                  }
                }
              });

              fieldsCleared++;
              spinner.stop();
              console.log(chalk.green(`  ✅ Cleared ${fieldName}`));
              spinner.start();

              // Small delay to avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 200));
            } catch (error) {
              fieldsFailed++;
              spinner.stop();
              console.log(chalk.red(`  ❌ Failed to clear ${fieldName}: ${error.message}`));
              spinner.start();
            }
          }
        }

        if (fieldsCleared > 0) {
          clearedPages++;
          spinner.stop();
          console.log(chalk.green(`  ✨ Cleared ${fieldsCleared} fields from: ${title}`));
          spinner.start();
        }

        if (fieldsFailed > 0) {
          errorCount += fieldsFailed;
        }

        // Longer delay between pages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      hasMore = response.has_more;
      cursor = response.next_cursor;
    }

    spinner.stop();

    console.log(chalk.blue('\n📊 Cleanup Summary'));
    console.log(chalk.blue('═'.repeat(40)));
    console.log(chalk.green(`✅ Pages cleared: ${clearedPages}`));
    console.log(chalk.gray(`⏭️  Pages skipped (no data): ${skippedPages}`));
    console.log(chalk.cyan(`📄 Total pages processed: ${totalPages}`));
    if (errorCount > 0) {
      console.log(chalk.red(`❌ Field clear errors: ${errorCount}`));
    }
    console.log(chalk.blue('═'.repeat(40)));
    console.log(chalk.green('\n✨ Cleanup complete!\n'));

  } catch (error) {
    spinner.fail(chalk.red(`Error during cleanup: ${error.message}`));
    console.error(chalk.red('\nStack trace:'), error);
  }
}

async function main() {
  console.log(chalk.blue.bold('\n🗑️  Content64 Field Cleanup Tool\n'));
  console.log(chalk.yellow('⚠️  This will clear all Content64 data from your blog posts.'));
  console.log(chalk.yellow('    This action cannot be easily undone!\n'));

  if (!process.env.NOTION_API_KEY) {
    console.error(chalk.red('❌ NOTION_API_KEY is not set in .env file'));
    process.exit(1);
  }

  const databaseId = await findBlogsDatabase();
  if (!databaseId) {
    console.error(chalk.red('Failed to find Blogs database'));
    process.exit(1);
  }

  // Ask for confirmation
  console.log(chalk.yellow('Press Ctrl+C to cancel, or wait 3 seconds to continue...\n'));
  await new Promise(resolve => setTimeout(resolve, 3000));

  await clearContent64Fields(databaseId);
}

main().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});