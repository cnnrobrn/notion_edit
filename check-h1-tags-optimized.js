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
    let errorCount = 0;
    const pagesWithH1Details = [];
    const pagesWithoutH1Details = [];
    
    console.log(chalk.cyan(`\nProcessing ${pages.length} pages in batches...\n`));
    
    const BATCH_SIZE = 50;
    const totalBatches = Math.ceil(pages.length / BATCH_SIZE);
    
    for (let batch = 0; batch < totalBatches; batch++) {
      const start = batch * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, pages.length);
      const batchPages = pages.slice(start, end);
      
      console.log(chalk.blue(`Processing batch ${batch + 1}/${totalBatches} (pages ${start + 1}-${end})`));
      
      for (const page of batchPages) {
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
          errorCount++;
        }
      }
      
      console.log(chalk.gray(`  Progress: ${pagesWithH1 + pagesWithoutH1 + errorCount}/${pages.length} pages checked`));
      console.log(chalk.gray(`  Current stats: ${pagesWithH1} with h1, ${pagesWithoutH1} without h1, ${errorCount} errors\n`));
    }
    
    console.log('\n' + chalk.bold('=== H1 Tag Report ==='));
    console.log(chalk.green(`✓ Pages WITH h1 tags: ${pagesWithH1}`));
    console.log(chalk.yellow(`✗ Pages WITHOUT h1 tags: ${pagesWithoutH1}`));
    if (errorCount > 0) {
      console.log(chalk.red(`⚠ Pages with errors: ${errorCount}`));
    }
    console.log(chalk.blue(`Total pages checked: ${pagesWithH1 + pagesWithoutH1 + errorCount}`));
    console.log(chalk.cyan(`Percentage with h1: ${((pagesWithH1 / (pagesWithH1 + pagesWithoutH1)) * 100).toFixed(1)}%`));
    
    if (pagesWithoutH1Details.length > 0) {
      console.log('\n' + chalk.bold('Sample of pages without h1 tags:'));
      pagesWithoutH1Details.slice(0, 20).forEach(page => {
        console.log(chalk.yellow(`  - ${page.title}`));
      });
      if (pagesWithoutH1Details.length > 20) {
        console.log(chalk.gray(`  ... and ${pagesWithoutH1Details.length - 20} more`));
      }
    }
    
    const exportData = {
      summary: {
        totalPages: pages.length,
        pagesWithH1,
        pagesWithoutH1,
        errorCount,
        percentageWithH1: ((pagesWithH1 / (pagesWithH1 + pagesWithoutH1)) * 100).toFixed(1)
      },
      pagesWithH1: pagesWithH1Details,
      pagesWithoutH1: pagesWithoutH1Details
    };
    
    const fs = await import('fs');
    fs.writeFileSync('h1-report.json', JSON.stringify(exportData, null, 2));
    console.log('\n' + chalk.green('Full report saved to h1-report.json'));
    
  } catch (error) {
    console.error(chalk.red('Error:', error.message));
    process.exit(1);
  }
}

checkH1Tags();