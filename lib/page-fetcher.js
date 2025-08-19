export async function getAllPages(notion) {
  const pages = [];
  let hasMore = true;
  let cursor = undefined;
  let batchCount = 0;
  
  console.log('[LOG] Starting to fetch all pages from Notion workspace...');
  
  while (hasMore) {
    batchCount++;
    console.log(`[LOG] Fetching page batch ${batchCount} (up to 100 pages per batch)...`);
    
    const response = await notion.search({
      filter: {
        property: 'object',
        value: 'page'
      },
      start_cursor: cursor,
      page_size: 100
    });
    
    pages.push(...response.results);
    console.log(`[LOG] Batch ${batchCount}: Retrieved ${response.results.length} pages (Total so far: ${pages.length})`);
    
    hasMore = response.has_more;
    cursor = response.next_cursor;
    
    if (hasMore) {
      console.log(`[LOG] More pages available, fetching next batch...`);
    }
  }
  
  console.log(`[LOG] Finished fetching pages. Total pages found: ${pages.length}`);
  return pages;
}

export async function getPageContent(notion, pageId) {
  const blocks = [];
  let hasMore = true;
  let cursor = undefined;
  let batchCount = 0;
  
  console.log(`[LOG] Fetching blocks for page ID: ${pageId}`);
  
  while (hasMore) {
    batchCount++;
    console.log(`[LOG]   Block batch ${batchCount}: Fetching up to 100 blocks...`);
    
    const response = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100
    });
    
    blocks.push(...response.results);
    console.log(`[LOG]   Block batch ${batchCount}: Retrieved ${response.results.length} blocks (Total: ${blocks.length})`);
    
    hasMore = response.has_more;
    cursor = response.next_cursor;
  }
  
  console.log(`[LOG] Finished fetching blocks for page. Total blocks: ${blocks.length}`);
  return blocks;
}