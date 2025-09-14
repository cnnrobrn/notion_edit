import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
import chalk from 'chalk';
import ora from 'ora';

dotenv.config();

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

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
      text = extractTextFromRichText(richTextArray);
      break;
      
    case 'code':
      text = block.code?.rich_text?.map(rt => rt.plain_text).join('') || '';
      break;
      
    case 'table':
      break;
      
    case 'divider':
      text = '\n';
      break;
      
    default:
      break;
  }
  
  return text;
}

function extractTextFromRichText(richTextArray) {
  if (!richTextArray || !Array.isArray(richTextArray)) {
    return '';
  }
  
  return richTextArray.map(richText => {
    let text = richText.plain_text || '';
    
    if (richText.href) {
      return text;
    }
    
    return text;
  }).join('');
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
      contentParts.push(text.trim());
    }
  }
  
  let content = contentParts.join(' ');
  
  content = content.replace(/\s+/g, ' ');
  
  content = content.replace(/([.!?])\s*([A-Z])/g, '$1 $2');
  
  content = content.replace(/\s+([.,;:!?])/g, '$1');
  
  return content.trim();
}

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

async function updateBlogWithContent(pageId, content) {
  try {
    const chunks = [];
    const maxLength = 2000;
    
    for (let i = 0; i < content.length; i += maxLength) {
      chunks.push({
        type: 'text',
        text: {
          content: content.substring(i, Math.min(i + maxLength, content.length))
        }
      });
    }
    
    await notion.pages.update({
      page_id: pageId,
      properties: {
        'Content': {
          rich_text: chunks
        }
      }
    });
    return true;
  } catch (error) {
    console.error(chalk.red(`Error updating page: ${error.message}`));
    return false;
  }
}

async function main() {
  console.log(chalk.blue('Starting content extraction for TTS...'));
  
  const databaseId = await findBlogsDatabase();
  if (!databaseId) {
    console.error(chalk.red('Failed to find Blogs database'));
    process.exit(1);
  }
  
  const spinner = ora('Fetching blog pages...').start();
  
  try {
    let hasMore = true;
    let cursor = undefined;
    let processedCount = 0;
    let failedCount = 0;
    
    while (hasMore) {
      const response = await notion.databases.query({
        database_id: databaseId,
        start_cursor: cursor,
        page_size: 10
      });
      
      for (const page of response.results) {
        const title = page.properties.Name?.title?.[0]?.plain_text || 
                     page.properties.Title?.title?.[0]?.plain_text || 
                     'Untitled';
        
        spinner.text = `Processing: ${title}`;
        
        try {
          const content = await extractPageContent(page.id);
          
          if (content) {
            const success = await updateBlogWithContent(page.id, content);
            
            if (success) {
              processedCount++;
              console.log(chalk.green(`✓ Processed: ${title}`));
              console.log(chalk.gray(`  Preview: ${content.substring(0, 100)}...`));
            } else {
              failedCount++;
              console.log(chalk.red(`✗ Failed to update: ${title}`));
            }
          } else {
            console.log(chalk.yellow(`⚠ No content found in: ${title}`));
          }
        } catch (error) {
          failedCount++;
          console.log(chalk.red(`✗ Error processing ${title}: ${error.message}`));
        }
      }
      
      hasMore = response.has_more;
      cursor = response.next_cursor;
    }
    
    spinner.stop();
    
    console.log(chalk.blue('\n--- Summary ---'));
    console.log(chalk.green(`Successfully processed: ${processedCount} pages`));
    if (failedCount > 0) {
      console.log(chalk.red(`Failed: ${failedCount} pages`));
    }
    
  } catch (error) {
    spinner.fail(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}

main().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});