import { createNotionClient } from './lib/notion-client.js';
import { getAllPages } from './lib/page-fetcher.js';
import ora from 'ora';
import chalk from 'chalk';

async function testQuoteConverter() {
  console.log(chalk.cyan('\n🔄 Testing quote converter on first 10 pages...\n'));
  
  const spinner = ora('Fetching pages...').start();
  
  try {
    const notion = createNotionClient();
    const pages = await getAllPages(notion);
    spinner.succeed(`Found ${pages.length} pages, testing first 10`);
    
    let quotesFound = 0;
    
    // Only process first 10 pages
    for (let i = 0; i < Math.min(10, pages.length); i++) {
      const page = pages[i];
      const pageTitle = page.properties?.title?.title?.[0]?.plain_text || 
                       page.properties?.Name?.title?.[0]?.plain_text || 
                       'Untitled';
      
      console.log(chalk.gray(`Checking page ${i + 1}: ${pageTitle}`));
      
      try {
        const response = await notion.blocks.children.list({
          block_id: page.id,
          page_size: 10  // Small batch
        });
        
        for (const block of response.results) {
          if (block.type === 'quote') {
            quotesFound++;
            console.log(chalk.green(`  ✓ Found quote block in "${pageTitle}"`));
          }
        }
      } catch (error) {
        if (!error.message?.includes('ai_block')) {
          console.log(chalk.yellow(`  ⚠ Error in "${pageTitle}": ${error.message}`));
        }
      }
      
      // Add delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log(chalk.cyan(`\n📊 Test complete! Found ${quotesFound} quotes in first 10 pages`));
    
  } catch (error) {
    spinner.fail('Test failed');
    console.error(chalk.red(error.message));
  }
}

testQuoteConverter();