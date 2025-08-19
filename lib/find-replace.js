import ora from 'ora';
import chalk from 'chalk';
import { getAllPages, getPageContent } from './page-fetcher.js';
import { processBlock } from './text-processor.js';

export async function findAndReplaceInWorkspace(notion, searchText, replaceText, options = {}) {
  const spinner = ora('Fetching all pages from workspace...').start();
  console.log(chalk.gray(`[LOG] Starting find and replace operation`));
  console.log(chalk.gray(`[LOG] Search text: "${searchText}"`));
  console.log(chalk.gray(`[LOG] Replace text: "${replaceText}"`));
  
  try {
    console.log(chalk.gray(`[LOG] Fetching pages from Notion API...`));
    const pages = await getAllPages(notion);
    spinner.succeed(`Found ${pages.length} pages in workspace`);
    console.log(chalk.gray(`[LOG] Successfully fetched ${pages.length} pages`));
    
    const results = {
      totalPages: pages.length,
      modifiedPages: [],
      errors: [],
      totalReplacements: 0
    };
    
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageTitle = getPageTitle(page);
      
      spinner.start(`Processing page ${i + 1}/${pages.length}: ${pageTitle}`);
      console.log(chalk.gray(`[LOG] Processing page ${i + 1}/${pages.length}: ${pageTitle} (ID: ${page.id})`));
      
      try {
        console.log(chalk.gray(`[LOG] Fetching blocks for page: ${pageTitle}`));
        const blocks = await getPageContent(notion, page.id);
        console.log(chalk.gray(`[LOG] Found ${blocks.length} blocks in page: ${pageTitle}`));
        
        let pageModified = false;
        let pageReplacements = 0;
        
        for (let j = 0; j < blocks.length; j++) {
          const block = blocks[j];
          try {
            console.log(chalk.gray(`[LOG] Processing block ${j + 1}/${blocks.length} (type: ${block.type}, id: ${block.id})`));
            const result = await processBlock(notion, block, searchText, replaceText);
            if (result.modified) {
              pageModified = true;
              pageReplacements++;
              console.log(chalk.gray(`[LOG] ✓ Block modified: ${block.id}`));
            }
          } catch (blockError) {
            console.log(chalk.gray(`[LOG] ✗ Error processing block ${block.id}: ${blockError.message}`));
            if (!options.silent) {
              console.warn(chalk.yellow(`Warning: Could not process block ${block.id}: ${blockError.message}`));
            }
          }
        }
        
        if (pageModified) {
          results.modifiedPages.push({
            id: page.id,
            title: pageTitle,
            replacements: pageReplacements
          });
          results.totalReplacements += pageReplacements;
          spinner.succeed(`Modified page ${i + 1}/${pages.length}: ${pageTitle} (${pageReplacements} replacements)`);
          console.log(chalk.gray(`[LOG] Page modified successfully: ${pageTitle} with ${pageReplacements} replacements`));
        } else {
          spinner.info(`No changes in page ${i + 1}/${pages.length}: ${pageTitle}`);
          console.log(chalk.gray(`[LOG] No changes needed in page: ${pageTitle}`));
        }
        
      } catch (pageError) {
        console.log(chalk.gray(`[LOG] ERROR: Failed to process page ${pageTitle}: ${pageError.message}`));
        results.errors.push({
          pageId: page.id,
          pageTitle: pageTitle,
          error: pageError.message
        });
        spinner.fail(`Error processing page ${i + 1}/${pages.length}: ${pageTitle} - ${pageError.message}`);
      }
    }
    
    console.log(chalk.gray(`[LOG] Operation completed. Total replacements: ${results.totalReplacements}`));
    return results;
    
  } catch (error) {
    console.log(chalk.gray(`[LOG] FATAL ERROR: ${error.message}`));
    spinner.fail(`Failed to fetch pages: ${error.message}`);
    throw error;
  }
}

function getPageTitle(page) {
  if (page.properties?.title?.title?.[0]?.plain_text) {
    return page.properties.title.title[0].plain_text;
  }
  
  if (page.properties?.Name?.title?.[0]?.plain_text) {
    return page.properties.Name.title[0].plain_text;
  }
  
  for (const prop in page.properties) {
    if (page.properties[prop]?.title?.[0]?.plain_text) {
      return page.properties[prop].title[0].plain_text;
    }
  }
  
  return 'Untitled';
}