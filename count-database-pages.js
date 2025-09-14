import { config } from 'dotenv';
import { Client } from '@notionhq/client';
import chalk from 'chalk';
import ora from 'ora';

config();

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function countDatabasePages(databaseId) {
  const spinner = ora('Fetching pages from database...').start();
  
  try {
    let pages = [];
    let hasMore = true;
    let cursor = undefined;
    let batchCount = 0;
    
    while (hasMore) {
      batchCount++;
      spinner.text = `Fetching batch ${batchCount}...`;
      
      const response = await notion.databases.query({
        database_id: databaseId,
        start_cursor: cursor,
        page_size: 100
      });
      
      pages.push(...response.results);
      hasMore = response.has_more;
      cursor = response.next_cursor;
    }
    
    spinner.succeed(`Database query complete`);
    
    console.log('\n' + chalk.bold('=== Database Statistics ==='));
    console.log(chalk.green(`Total pages in database: ${pages.length}`));
    console.log(chalk.blue(`Database ID: ${databaseId}`));
    
    // Get some sample page titles
    console.log('\n' + chalk.bold('Sample pages (first 10):'));
    for (let i = 0; i < Math.min(10, pages.length); i++) {
      const page = pages[i];
      const title = page.properties?.Name?.title?.[0]?.text?.content || 
                    page.properties?.title?.title?.[0]?.text?.content ||
                    page.properties?.Title?.title?.[0]?.text?.content ||
                    'Untitled';
      console.log(chalk.cyan(`  ${i + 1}. ${title}`));
    }
    
    if (pages.length > 10) {
      console.log(chalk.gray(`  ... and ${pages.length - 10} more pages`));
    }
    
  } catch (error) {
    spinner.fail('Error occurred');
    console.error(chalk.red('Error:', error.message));
    console.error(chalk.yellow('\nMake sure:'));
    console.error(chalk.yellow('1. Your NOTION_API_KEY has access to this database'));
    console.error(chalk.yellow('2. The database ID is correct'));
    console.error(chalk.yellow('3. The database is shared with your integration'));
    process.exit(1);
  }
}

// Extract database ID from the URL
const url = 'https://www.notion.so/23a07890f53280e98cded8006815e521?v=23a07890f5328149a697000cc8eb5a56';
const databaseId = '23a07890-f532-80e9-8cde-d8006815e521';

console.log(chalk.cyan('Counting pages in Notion database...'));
console.log(chalk.gray(`Database ID: ${databaseId}\n`));

countDatabasePages(databaseId);