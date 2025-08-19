export function extractTextFromBlock(block) {
  const texts = [];
  console.log(`[LOG]     Extracting text from block type: ${block.type}`);
  
  switch (block.type) {
    case 'paragraph':
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
    case 'bulleted_list_item':
    case 'numbered_list_item':
    case 'toggle':
    case 'quote':
    case 'callout':
      if (block[block.type]?.rich_text) {
        texts.push(...block[block.type].rich_text);
      }
      break;
    case 'to_do':
      if (block.to_do?.rich_text) {
        texts.push(...block.to_do.rich_text);
      }
      break;
    case 'code':
      if (block.code?.rich_text) {
        texts.push(...block.code.rich_text);
      }
      break;
    case 'table_row':
      if (block.table_row?.cells) {
        for (const cell of block.table_row.cells) {
          texts.push(...cell);
        }
      }
      break;
  }
  
  return texts;
}

export function searchAndReplaceInRichText(richTextArray, searchText, replaceText) {
  let modified = false;
  console.log(`[LOG]     Searching for "${searchText}" in rich text array with ${richTextArray.length} items`);
  
  const updatedRichText = richTextArray.map(item => {
    let updatedItem = { ...item };
    
    // Process regular text content
    if (item.type === 'text' && item.text?.content) {
      const originalContent = item.text.content;
      const newContent = originalContent.replace(new RegExp(escapeRegExp(searchText), 'g'), replaceText);
      
      if (originalContent !== newContent) {
        modified = true;
        console.log(`[LOG]       ✓ Found and replaced in text content: "${searchText}" → "${replaceText}"`);
        updatedItem = {
          ...item,
          text: {
            ...item.text,
            content: newContent
          }
        };
      }
    }
    
    // Process link URLs
    if (item.type === 'text' && item.text?.link?.url) {
      const originalUrl = item.text.link.url;
      const newUrl = originalUrl.replace(new RegExp(escapeRegExp(searchText), 'g'), replaceText);
      
      if (originalUrl !== newUrl) {
        modified = true;
        console.log(`[LOG]       ✓ Found and replaced in link URL: "${searchText}" → "${replaceText}"`);
        console.log(`[LOG]         Original URL: ${originalUrl}`);
        console.log(`[LOG]         New URL: ${newUrl}`);
        updatedItem = {
          ...updatedItem,
          text: {
            ...updatedItem.text,
            link: {
              ...item.text.link,
              url: newUrl
            }
          }
        };
      }
    }
    
    // Process href (for databases and other link types)
    if (item.href) {
      const originalHref = item.href;
      const newHref = originalHref.replace(new RegExp(escapeRegExp(searchText), 'g'), replaceText);
      
      if (originalHref !== newHref) {
        modified = true;
        console.log(`[LOG]       ✓ Found and replaced in href: "${searchText}" → "${replaceText}"`);
        updatedItem = {
          ...updatedItem,
          href: newHref
        };
      }
    }
    
    return updatedItem;
  });
  
  return { modified, updatedRichText };
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function processBlock(notion, block, searchText, replaceText) {
  console.log(`[LOG]   Processing block ID: ${block.id}, Type: ${block.type}`);
  const textArray = extractTextFromBlock(block);
  
  if (textArray.length === 0) {
    console.log(`[LOG]     No text found in block`);
    return { modified: false };
  }
  
  const { modified, updatedRichText } = searchAndReplaceInRichText(textArray, searchText, replaceText);
  
  if (!modified) {
    console.log(`[LOG]     No matches found in block`);
    return { modified: false };
  }
  
  console.log(`[LOG]     Text modifications found, updating block...`);
  
  const updateData = {};
  
  switch (block.type) {
    case 'paragraph':
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
    case 'bulleted_list_item':
    case 'numbered_list_item':
    case 'toggle':
    case 'quote':
    case 'callout':
      updateData[block.type] = { rich_text: updatedRichText };
      break;
    case 'to_do':
      updateData.to_do = { 
        rich_text: updatedRichText,
        checked: block.to_do.checked 
      };
      break;
    case 'code':
      updateData.code = { 
        rich_text: updatedRichText,
        language: block.code.language 
      };
      break;
  }
  
  if (Object.keys(updateData).length > 0) {
    console.log(`[LOG]     Sending update request to Notion API for block ${block.id}`);
    await notion.blocks.update({
      block_id: block.id,
      ...updateData
    });
    console.log(`[LOG]     ✓ Block ${block.id} updated successfully`);
    return { modified: true, blockId: block.id };
  }
  
  return { modified: false };
}