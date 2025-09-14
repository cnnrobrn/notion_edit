import { createNotionClient } from './lib/notion-client.js';
import { getAllPages } from './lib/page-fetcher.js';
import ora from 'ora';
import chalk from 'chalk';

async function convertCheckboxesToBullets(notion, dryRun = false) {
  console.log(chalk.cyan('\n🔄 Starting checkbox to bullet point conversion...\n'));
  
  if (dryRun) {
    console.log(chalk.yellow('🔍 DRY RUN MODE - No changes will be made\n'));
  }
  
  const spinner = ora('Fetching all pages from workspace...').start();
  
  try {
    const pages = await getAllPages(notion);
    spinner.succeed(`Found ${pages.length} pages in workspace`);
    
    let totalCheckboxes = 0;
    let convertedCheckboxes = 0;
    let processedPages = 0;
    let pagesWithCheckboxes = [];
    const errors = [];
    
    for (const page of pages) {
      processedPages++;
      const pageTitle = page.properties?.title?.title?.[0]?.plain_text || 
                       page.properties?.Name?.title?.[0]?.plain_text || 
                       'Untitled';
      
      process.stdout.write(chalk.gray(`\rProcessing page ${processedPages}/${pages.length}: ${pageTitle.substring(0, 50)}...`));
      
      try {
        let hasMoreBlocks = true;
        let cursor = undefined;
        let pageCheckboxCount = 0;
        
        while (hasMoreBlocks) {
          const response = await notion.blocks.children.list({
            block_id: page.id,
            start_cursor: cursor,
            page_size: 100
          });
          
          for (const block of response.results) {
            if (block.type === 'to_do') {
              totalCheckboxes++;
              pageCheckboxCount++;
              
              if (!dryRun) {
                try {
                  // Get the parent block ID and position
                  const parentId = page.id;
                  
                  // Create a new bulleted_list_item block with the same content
                  await notion.blocks.children.append({
                    block_id: parentId,
                    children: [{
                      bulleted_list_item: {
                        rich_text: block.to_do.rich_text,
                        color: block.to_do.color || 'default'
                      }
                    }],
                    after: block.id
                  });
                  
                  // Delete the original to_do block
                  await notion.blocks.delete({
                    block_id: block.id
                  });
                  
                  convertedCheckboxes++;
                } catch (updateError) {
                  console.error(chalk.red(`\n❌ Failed to convert checkbox in block ${block.id}: ${updateError.message}`));
                  errors.push({
                    pageId: page.id,
                    pageTitle,
                    blockId: block.id,
                    error: updateError.message
                  });
                }
              } else {
                convertedCheckboxes++;
              }
            } else if (block.has_children) {
              // Check children even if parent is not a checkbox
              await processChildBlocks(notion, block.id, page.id, dryRun);
            }
          }
          
          hasMoreBlocks = response.has_more;
          cursor = response.next_cursor;
        }
        
        if (pageCheckboxCount > 0) {
          pagesWithCheckboxes.push({
            id: page.id,
            title: pageTitle,
            checkboxCount: pageCheckboxCount
          });
        }
        
      } catch (error) {
        errors.push({
          pageId: page.id,
          pageTitle,
          error: error.message
        });
      }
    }
    
    // Clear the processing line
    process.stdout.write('\r' + ' '.repeat(100) + '\r');
    
    // Display results
    console.log(chalk.green('\n✅ Conversion complete!\n'));
    console.log(chalk.cyan('📊 Summary:'));
    console.log(`  • Total pages processed: ${processedPages}`);
    console.log(`  • Pages with checkboxes: ${pagesWithCheckboxes.length}`);
    console.log(`  • Total checkboxes found: ${totalCheckboxes}`);
    
    if (dryRun) {
      console.log(chalk.yellow(`  • Checkboxes that would be converted: ${convertedCheckboxes}`));
    } else {
      console.log(chalk.green(`  • Checkboxes successfully converted: ${convertedCheckboxes}`));
    }
    
    if (errors.length > 0) {
      console.log(chalk.red(`  • Errors encountered: ${errors.length}`));
      console.log(chalk.red('\n❌ Errors:'));
      errors.forEach(err => {
        console.log(`  • Page "${err.pageTitle}": ${err.error}`);
      });
    }
    
    if (pagesWithCheckboxes.length > 0 && dryRun) {
      console.log(chalk.cyan('\n📝 Pages with checkboxes:'));
      pagesWithCheckboxes.slice(0, 10).forEach(page => {
        console.log(`  • ${page.title} (${page.checkboxCount} checkboxes)`);
      });
      if (pagesWithCheckboxes.length > 10) {
        console.log(chalk.gray(`  ... and ${pagesWithCheckboxes.length - 10} more pages`));
      }
    }
    
    return {
      totalPages: processedPages,
      pagesWithCheckboxes: pagesWithCheckboxes.length,
      totalCheckboxes,
      convertedCheckboxes,
      errors
    };
    
  } catch (error) {
    spinner.fail('Failed to process workspace');
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    throw error;
  }
}

async function processChildBlocks(notion, blockId, parentId, dryRun) {
  try {
    let hasMoreBlocks = true;
    let cursor = undefined;
    
    while (hasMoreBlocks) {
      let response;
      try {
        response = await notion.blocks.children.list({
          block_id: blockId,
          start_cursor: cursor,
          page_size: 100
        });
      } catch (error) {
        // Skip unsupported block types like ai_block
        if (error.message?.includes('ai_block') || error.message?.includes('not supported')) {
          return;
        }
        throw error;
      }
      
      for (const block of response.results) {
        if (block.type === 'to_do') {
          if (!dryRun) {
            try {
              // Create a new bulleted_list_item block with the same content
              await notion.blocks.children.append({
                block_id: blockId,
                children: [{
                  bulleted_list_item: {
                    rich_text: block.to_do.rich_text,
                    color: block.to_do.color || 'default'
                  }
                }],
                after: block.id
              });
              
              // Delete the original to_do block
              await notion.blocks.delete({
                block_id: block.id
              });
            } catch (updateError) {
              console.error(chalk.red(`\n❌ Failed to convert nested checkbox ${block.id}: ${updateError.message}`));
            }
          }
        }
        
        if (block.has_children) {
          await processChildBlocks(notion, block.id, blockId, dryRun);
        }
      }
      
      hasMoreBlocks = response.has_more;
      cursor = response.next_cursor;
    }
  } catch (error) {
    // Only show error if it's not about unsupported block types
    if (!error.message?.includes('ai_block') && !error.message?.includes('not supported')) {
      console.error(chalk.red(`\n❌ Error processing child blocks: ${error.message}`));
    }
  }
}

// Export the function for use in index.js
export { convertCheckboxesToBullets };

// Main execution for standalone use
if (import.meta.url === `file://${process.argv[1]}`) {
  async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run') || args.includes('-d');
    const skipConfirmation = args.includes('-y') || args.includes('--yes');
    
    console.log(chalk.bold.cyan('\n🔄 Notion Checkbox to Bullet Point Converter\n'));
    
    if (!skipConfirmation && !dryRun) {
      console.log(chalk.yellow('⚠️  Warning: This will convert ALL checkboxes to bullet points across your entire workspace.'));
      console.log(chalk.yellow('This action cannot be easily undone.\n'));
      console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
      
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    try {
      const notion = createNotionClient();
      const results = await convertCheckboxesToBullets(notion, dryRun);
      
      if (dryRun && results.totalCheckboxes > 0) {
        console.log(chalk.yellow('\n💡 To apply these changes, run without --dry-run flag'));
      }
      
    } catch (error) {
      console.error(chalk.red(`\n❌ Failed to complete conversion: ${error.message}`));
      process.exit(1);
    }
  }

  main().catch(error => {
    console.error(chalk.red(`\n❌ Unexpected error: ${error.message}`));
    process.exit(1);
  });
}