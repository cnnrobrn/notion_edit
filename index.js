#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import { createNotionClient } from './lib/notion-client.js';
import { findAndReplaceInWorkspace } from './lib/find-replace.js';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

program
  .name('notion-find-replace')
  .description('Find and replace text across all pages in a Notion workspace')
  .version('1.0.0');

program
  .command('replace')
  .description('Find and replace text in all Notion pages')
  .option('-s, --search <text>', 'Text to search for')
  .option('-r, --replace <text>', 'Text to replace with')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--silent', 'Suppress warnings about individual block errors')
  .action(async (options) => {
    try {
      let searchText = options.search;
      let replaceText = options.replace;
      
      if (!searchText) {
        searchText = await prompt(chalk.cyan('Enter text to search for: '));
      }
      
      if (!replaceText) {
        replaceText = await prompt(chalk.cyan('Enter replacement text: '));
      }
      
      if (!searchText) {
        console.error(chalk.red('Search text cannot be empty'));
        process.exit(1);
      }
      
      console.log(chalk.yellow('\n⚠️  WARNING: This will modify all pages in your Notion workspace!'));
      console.log(chalk.gray(`Searching for: "${searchText}"`));
      console.log(chalk.gray(`Replacing with: "${replaceText}"`));
      console.log(chalk.gray('[LOG] Starting replacement operation...'));
      
      if (!options.yes) {
        const confirm = await prompt(chalk.yellow('\nDo you want to continue? (yes/no): '));
        if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
          console.log(chalk.gray('Operation cancelled'));
          rl.close();
          process.exit(0);
        }
      }
      
      console.log();
      
      console.log(chalk.gray('[LOG] Creating Notion client...'));
      const notion = createNotionClient();
      console.log(chalk.gray('[LOG] Notion client created successfully'));
      console.log(chalk.gray('[LOG] Starting find and replace operation...'));
      const results = await findAndReplaceInWorkspace(notion, searchText, replaceText, {
        silent: options.silent
      });
      
      console.log(chalk.green('\n✅ Operation completed!'));
      console.log(chalk.white(`\nSummary:`));
      console.log(chalk.gray(`• Total pages scanned: ${results.totalPages}`));
      console.log(chalk.blue(`• Pages modified: ${results.modifiedPages.length}`));
      console.log(chalk.blue(`• Total replacements: ${results.totalReplacements}`));
      
      if (results.modifiedPages.length > 0) {
        console.log(chalk.white('\nModified pages:'));
        results.modifiedPages.forEach(page => {
          console.log(chalk.gray(`  • ${page.title} (${page.replacements} replacements)`));
        });
      }
      
      if (results.errors.length > 0) {
        console.log(chalk.red(`\n⚠️  Errors encountered: ${results.errors.length}`));
        results.errors.forEach(error => {
          console.log(chalk.red(`  • ${error.pageTitle}: ${error.error}`));
        });
      }
      
      rl.close();
      
    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error.message}`));
      if (error.message.includes('NOTION_API_KEY')) {
        console.log(chalk.yellow('\nPlease make sure you have:'));
        console.log(chalk.gray('1. Created a Notion integration at https://www.notion.so/my-integrations'));
        console.log(chalk.gray('2. Copied the integration token'));
        console.log(chalk.gray('3. Created a .env file with NOTION_API_KEY=your_token'));
        console.log(chalk.gray('4. Connected the integration to your workspace pages'));
      }
      rl.close();
      process.exit(1);
    }
  });

program
  .command('dry-run')
  .description('Preview what would be replaced without making changes')
  .option('-s, --search <text>', 'Text to search for')
  .action(async (options) => {
    try {
      let searchText = options.search;
      
      if (!searchText) {
        searchText = await prompt(chalk.cyan('Enter text to search for: '));
      }
      
      if (!searchText) {
        console.error(chalk.red('Search text cannot be empty'));
        process.exit(1);
      }
      
      console.log(chalk.cyan(`\nSearching for occurrences of: "${searchText}"...\n`));
      console.log(chalk.gray('[LOG] Starting dry-run operation...'));
      
      console.log(chalk.gray('[LOG] Creating Notion client...'));
      const notion = createNotionClient();
      console.log(chalk.gray('[LOG] Notion client created successfully'));
      const { getAllPages, getPageContent } = await import('./lib/page-fetcher.js');
      const { extractTextFromBlock } = await import('./lib/text-processor.js');
      
      console.log(chalk.gray('[LOG] Fetching all pages for dry-run...'));
      const pages = await getAllPages(notion);
      console.log(chalk.gray(`[LOG] Starting to scan ${pages.length} pages for occurrences...`));
      let totalOccurrences = 0;
      const pagesWithMatches = [];
      
      for (let idx = 0; idx < pages.length; idx++) {
        const page = pages[idx];
        const pageTitle = getPageTitle(page);
        console.log(chalk.gray(`[LOG] Scanning page ${idx + 1}/${pages.length}: ${pageTitle}`));
        const blocks = await getPageContent(notion, page.id);
        let pageOccurrences = 0;
        
        for (const block of blocks) {
          const texts = extractTextFromBlock(block);
          for (const richText of texts) {
            // Check regular text content
            if (richText.type === 'text' && richText.text?.content) {
              const matches = (richText.text.content.match(new RegExp(escapeRegExp(searchText), 'g')) || []).length;
              if (matches > 0) {
                pageOccurrences += matches;
              }
            }
            
            // Check link URLs
            if (richText.type === 'text' && richText.text?.link?.url) {
              const matches = (richText.text.link.url.match(new RegExp(escapeRegExp(searchText), 'g')) || []).length;
              if (matches > 0) {
                pageOccurrences += matches;
                console.log(chalk.gray(`[LOG]   Found ${matches} occurrence(s) in link URL: ${richText.text.link.url}`));
              }
            }
            
            // Check href
            if (richText.href) {
              const matches = (richText.href.match(new RegExp(escapeRegExp(searchText), 'g')) || []).length;
              if (matches > 0) {
                pageOccurrences += matches;
                console.log(chalk.gray(`[LOG]   Found ${matches} occurrence(s) in href: ${richText.href}`));
              }
            }
          }
        }
        
        if (pageOccurrences > 0) {
          totalOccurrences += pageOccurrences;
          pagesWithMatches.push({ title: pageTitle, occurrences: pageOccurrences });
        }
      }
      
      if (totalOccurrences === 0) {
        console.log(chalk.yellow('No occurrences found.'));
      } else {
        console.log(chalk.green(`Found ${totalOccurrences} occurrences in ${pagesWithMatches.length} pages:\n`));
        pagesWithMatches.forEach(page => {
          console.log(chalk.gray(`  • ${page.title}: ${page.occurrences} occurrence(s)`));
        });
      }
      
      rl.close();
      
    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error.message}`));
      rl.close();
      process.exit(1);
    }
  });

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

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

program.parse();