import { createNotionClient } from './lib/notion-client.js';
import { getAllPages } from './lib/page-fetcher.js';
import ora from 'ora';
import chalk from 'chalk';

async function convertQuotesToText(notion, dryRun = false) {
  console.log(chalk.cyan('\n🔄 Starting quote block to quoted text conversion...\n'));
  
  if (dryRun) {
    console.log(chalk.yellow('🔍 DRY RUN MODE - No changes will be made\n'));
  }
  
  const spinner = ora('Fetching all pages from workspace...').start();
  
  try {
    const pages = await getAllPages(notion);
    spinner.succeed(`Found ${pages.length} pages in workspace`);
    
    let totalQuotes = 0;
    let convertedQuotes = 0;
    let processedPages = 0;
    let pagesWithQuotes = [];
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
        let pageQuoteCount = 0;
        
        while (hasMoreBlocks) {
          const response = await notion.blocks.children.list({
            block_id: page.id,
            start_cursor: cursor,
            page_size: 100
          });
          
          for (const block of response.results) {
            if (block.type === 'quote') {
              totalQuotes++;
              pageQuoteCount++;
              
              if (!dryRun) {
                try {
                  // Get the quote content
                  const quoteText = block.quote.rich_text;
                  
                  // Create new paragraph with quoted text
                  const quotedRichText = [];
                  
                  // Add opening quote
                  quotedRichText.push({
                    type: 'text',
                    text: { content: '"' },
                    plain_text: '"'
                  });
                  
                  // Add the original text
                  quotedRichText.push(...quoteText);
                  
                  // Add closing quote
                  quotedRichText.push({
                    type: 'text',
                    text: { content: '"' },
                    plain_text: '"'
                  });
                  
                  // Create a new paragraph block with quoted content
                  await notion.blocks.children.append({
                    block_id: page.id,
                    children: [{
                      paragraph: {
                        rich_text: quotedRichText,
                        color: block.quote.color || 'default'
                      }
                    }],
                    after: block.id
                  });
                  
                  // Delete the original quote block
                  await notion.blocks.delete({
                    block_id: block.id
                  });
                  
                  convertedQuotes++;
                } catch (updateError) {
                  console.error(chalk.red(`\n❌ Failed to convert quote in block ${block.id}: ${updateError.message}`));
                  errors.push({
                    pageId: page.id,
                    pageTitle,
                    blockId: block.id,
                    error: updateError.message
                  });
                }
              } else {
                convertedQuotes++;
              }
            } else if (block.has_children) {
              // Check children even if parent is not a quote
              await processChildBlocks(notion, block.id, page.id, dryRun);
            }
          }
          
          hasMoreBlocks = response.has_more;
          cursor = response.next_cursor;
        }
        
        if (pageQuoteCount > 0) {
          pagesWithQuotes.push({
            id: page.id,
            title: pageTitle,
            quoteCount: pageQuoteCount
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
    console.log(`  • Pages with quotes: ${pagesWithQuotes.length}`);
    console.log(`  • Total quotes found: ${totalQuotes}`);
    
    if (dryRun) {
      console.log(chalk.yellow(`  • Quotes that would be converted: ${convertedQuotes}`));
    } else {
      console.log(chalk.green(`  • Quotes successfully converted: ${convertedQuotes}`));
    }
    
    if (errors.length > 0) {
      console.log(chalk.red(`  • Errors encountered: ${errors.length}`));
      console.log(chalk.red('\n❌ Errors:'));
      errors.forEach(err => {
        console.log(`  • Page "${err.pageTitle}": ${err.error}`);
      });
    }
    
    if (pagesWithQuotes.length > 0 && dryRun) {
      console.log(chalk.cyan('\n📝 Pages with quotes:'));
      pagesWithQuotes.slice(0, 10).forEach(page => {
        console.log(`  • ${page.title} (${page.quoteCount} quotes)`);
      });
      if (pagesWithQuotes.length > 10) {
        console.log(chalk.gray(`  ... and ${pagesWithQuotes.length - 10} more pages`));
      }
    }
    
    return {
      totalPages: processedPages,
      pagesWithQuotes: pagesWithQuotes.length,
      totalQuotes,
      convertedQuotes,
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
        if (block.type === 'quote') {
          if (!dryRun) {
            try {
              // Get the quote content
              const quoteText = block.quote.rich_text;
              
              // Create new paragraph with quoted text
              const quotedRichText = [];
              
              // Add opening quote
              quotedRichText.push({
                type: 'text',
                text: { content: '"' },
                plain_text: '"'
              });
              
              // Add the original text
              quotedRichText.push(...quoteText);
              
              // Add closing quote
              quotedRichText.push({
                type: 'text',
                text: { content: '"' },
                plain_text: '"'
              });
              
              // Create a new paragraph block with quoted content
              await notion.blocks.children.append({
                block_id: blockId,
                children: [{
                  paragraph: {
                    rich_text: quotedRichText,
                    color: block.quote.color || 'default'
                  }
                }],
                after: block.id
              });
              
              // Delete the original quote block
              await notion.blocks.delete({
                block_id: block.id
              });
            } catch (updateError) {
              console.error(chalk.red(`\n❌ Failed to convert nested quote ${block.id}: ${updateError.message}`));
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
export { convertQuotesToText };

// Main execution for standalone use
if (import.meta.url === `file://${process.argv[1]}`) {
  async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run') || args.includes('-d');
    const skipConfirmation = args.includes('-y') || args.includes('--yes');
    
    console.log(chalk.bold.cyan('\n🔄 Notion Quote to Quoted Text Converter\n'));
    
    if (!skipConfirmation && !dryRun) {
      console.log(chalk.yellow('⚠️  Warning: This will convert ALL quote blocks to quoted paragraphs across your entire workspace.'));
      console.log(chalk.yellow('This action cannot be easily undone.\n'));
      console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
      
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    try {
      const notion = createNotionClient();
      const results = await convertQuotesToText(notion, dryRun);
      
      if (dryRun && results.totalQuotes > 0) {
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