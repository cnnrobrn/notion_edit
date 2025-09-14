import { config } from 'dotenv';
import { Client } from '@notionhq/client';
import { getAllPages, getPageContent } from './lib/page-fetcher.js';
import chalk from 'chalk';
import ora from 'ora';

config();

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function checkH1Tags() {
  const spinner = ora('Fetching all pages from Notion...').start();
  
  try {
    const pages = await getAllPages(notion);
    spinner.succeed(`Found ${pages.length} pages`);
    
    let pagesWithH1 = 0;
    let pagesWithoutH1 = 0;
    const pagesWithH1Details = [];
    const pagesWithoutH1Details = [];
    
    const progressSpinner = ora('Checking pages for h1 tags...').start();
    
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      progressSpinner.text = `Checking page ${i + 1}/${pages.length}...`;
      
      try {
        const blocks = await getPageContent(notion, page.id);
        const hasH1 = blocks.some(block => block.type === 'heading_1');
        
        const pageTitle = page.properties?.title?.title?.[0]?.text?.content || 
                         page.properties?.Name?.title?.[0]?.text?.content || 
                         'Untitled';
        
        if (hasH1) {
          pagesWithH1++;
          pagesWithH1Details.push({
            title: pageTitle,
            id: page.id,
            url: page.url
          });
        } else {
          pagesWithoutH1++;
          pagesWithoutH1Details.push({
            title: pageTitle,
            id: page.id,
            url: page.url
          });
        }
      } catch (error) {
        console.error(chalk.red(`Error checking page ${page.id}: ${error.message}`));
      }
    }
    
    progressSpinner.succeed('Finished checking all pages');
    
    console.log('\n' + chalk.bold('=== H1 Tag Report ==='));
    console.log(chalk.green(`Pages WITH h1 tags: ${pagesWithH1}`));
    console.log(chalk.yellow(`Pages WITHOUT h1 tags: ${pagesWithoutH1}`));
    console.log(chalk.blue(`Total pages checked: ${pages.length}`));
    console.log(chalk.cyan(`Percentage with h1: ${((pagesWithH1 / pages.length) * 100).toFixed(1)}%`));
    
    if (pagesWithoutH1Details.length > 0) {
      console.log('\n' + chalk.bold('Pages without h1 tags:'));
      pagesWithoutH1Details.slice(0, 10).forEach(page => {
        console.log(chalk.yellow(`  - ${page.title}`));
      });
      if (pagesWithoutH1Details.length > 10) {
        console.log(chalk.gray(`  ... and ${pagesWithoutH1Details.length - 10} more`));
      }
    }
    
  } catch (error) {
    spinner.fail('Error occurred');
    console.error(chalk.red('Error:', error.message));
    process.exit(1);
  }
}

checkH1Tags();