export async function convertBlockType(notion, blockId, fromType, toType, preserveContent = true) {
  try {
    // First, get the current block to preserve its content
    const block = await notion.blocks.retrieve({ block_id: blockId });
    
    if (block.type !== fromType) {
      return { success: false, error: `Block is not of type ${fromType}` };
    }
    
    const updateData = {};
    
    // Handle conversion from to_do to bulleted_list_item
    if (fromType === 'to_do' && toType === 'bulleted_list_item') {
      updateData.bulleted_list_item = {
        rich_text: block.to_do.rich_text,
        color: block.to_do.color || 'default'
      };
    }
    // Handle conversion from bulleted_list_item to to_do
    else if (fromType === 'bulleted_list_item' && toType === 'to_do') {
      updateData.to_do = {
        rich_text: block.bulleted_list_item.rich_text,
        checked: false,
        color: block.bulleted_list_item.color || 'default'
      };
    }
    // Handle conversion from numbered_list_item to bulleted_list_item
    else if (fromType === 'numbered_list_item' && toType === 'bulleted_list_item') {
      updateData.bulleted_list_item = {
        rich_text: block.numbered_list_item.rich_text,
        color: block.numbered_list_item.color || 'default'
      };
    }
    // Handle conversion from bulleted_list_item to numbered_list_item
    else if (fromType === 'bulleted_list_item' && toType === 'numbered_list_item') {
      updateData.numbered_list_item = {
        rich_text: block.bulleted_list_item.rich_text,
        color: block.bulleted_list_item.color || 'default'
      };
    }
    // Add more conversion types as needed
    else {
      return { 
        success: false, 
        error: `Conversion from ${fromType} to ${toType} is not supported` 
      };
    }
    
    // Update the block with the new type
    await notion.blocks.update({
      block_id: blockId,
      ...updateData
    });
    
    return { success: true, blockId };
    
  } catch (error) {
    return { 
      success: false, 
      error: error.message,
      blockId 
    };
  }
}

export async function batchConvertBlocks(notion, blocks, fromType, toType, options = {}) {
  const { dryRun = false, onProgress = null } = options;
  
  const results = {
    total: blocks.length,
    converted: 0,
    failed: 0,
    errors: []
  };
  
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    
    if (onProgress) {
      onProgress(i + 1, blocks.length, block);
    }
    
    if (block.type === fromType) {
      if (!dryRun) {
        const result = await convertBlockType(notion, block.id, fromType, toType);
        
        if (result.success) {
          results.converted++;
        } else {
          results.failed++;
          results.errors.push({
            blockId: block.id,
            error: result.error
          });
        }
      } else {
        // In dry run mode, just count what would be converted
        results.converted++;
      }
    }
  }
  
  return results;
}

export async function findBlocksOfType(notion, pageId, blockType, recursive = true) {
  const blocks = [];
  
  async function searchBlocks(parentId) {
    let hasMore = true;
    let cursor = undefined;
    
    while (hasMore) {
      const response = await notion.blocks.children.list({
        block_id: parentId,
        start_cursor: cursor,
        page_size: 100
      });
      
      for (const block of response.results) {
        if (block.type === blockType) {
          blocks.push(block);
        }
        
        if (recursive && block.has_children) {
          await searchBlocks(block.id);
        }
      }
      
      hasMore = response.has_more;
      cursor = response.next_cursor;
    }
  }
  
  await searchBlocks(pageId);
  return blocks;
}