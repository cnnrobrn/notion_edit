# NotebookLM Integration Workflow Guide

## Overview

This workflow automates the process of:
1. **Extracting** blog content from Notion
2. **Preparing** it for NotebookLM processing
3. **Creating** video and podcast content via NotebookLM
4. **Syncing** the media links back to Notion

## Architecture

```
Notion Database (Blogs)
    ↓
[notebooklm-workflow.js] → Extract content
    ↓
Markdown Files + Metadata
    ↓
Manual: Upload to NotebookLM
    ↓
Generate Audio/Video
    ↓
[notebooklm-media-helper.js] → Record media URLs
    ↓
Sync back to Notion (VideoLink & AudioLink columns)
```

## Prerequisites

### 1. Notion Database Setup

Your Notion database needs the following columns:
- **Name/Title**: Blog post title
- **Slug-AI**: URL slug for the blog post
- **VideoLink**: URL field for video content
- **AudioLink**: URL field for audio/podcast content

### 2. Environment Configuration

Create a `.env` file with:
```env
NOTION_API_KEY=your_notion_api_key_here
```

## Usage

### Step 1: Pull Content from Notion

Extract all blog posts that don't have media yet:

```bash
npm run notebooklm:pull
```

This will:
- Connect to your Notion database
- Extract full content from each blog post
- Create markdown files in `notebooklm_output/`
- Generate metadata files for tracking

### Step 2: Process in NotebookLM

#### Manual Process:
1. Go to https://notebooklm.google.com
2. Create a new notebook
3. Upload the markdown files from `notebooklm_output/`
4. Generate Audio Overview
5. Generate Video (if available)
6. Download or get shareable links for the media

#### For Each Blog Post:
The URL formula for your blogs is:
```
https://getcolby.com/blog/{{Slug-AI}}
```

### Step 3: Record Media URLs

Use the interactive helper to record media URLs:

```bash
npm run notebooklm:helper
```

Options:
1. **List unprocessed files** - See which posts need media
2. **Record media URLs** - Input URLs for audio/video
3. **Generate batch CSV** - Export for tracking
4. **Import from CSV** - Bulk import media URLs
5. **Sync all to Notion** - Push updates to database

### Step 4: Sync Media to Notion

After recording media URLs, sync them back:

```bash
npm run notebooklm:sync
```

This updates the VideoLink and AudioLink columns in Notion.

## Batch Processing

For large volumes of content:

1. **Generate CSV for tracking:**
   ```bash
   npm run notebooklm:helper
   # Select option 3
   ```

2. **Process in NotebookLM in batches**

3. **Update CSV with media URLs**

4. **Import back:**
   ```bash
   npm run notebooklm:helper
   # Select option 4
   ```

## File Structure

```
notebooklm_output/
├── manifest.json           # Master list of exported posts
├── [slug].md              # Markdown content for NotebookLM
├── [slug].json            # Metadata (ID, title, URL)
├── [slug].media.json      # Media URLs (after processing)
└── batch_processing.csv   # Tracking spreadsheet

notebooklm_processed/      # Completed media files
```

## Media File Format

After processing in NotebookLM, create `.media.json` files:

```json
{
  "slug": "blog-post-slug",
  "audioUrl": "https://...",
  "videoUrl": "https://...",
  "processedAt": "2025-01-16T..."
}
```

## Commands Reference

| Command | Description |
|---------|-------------|
| `npm run notebooklm` | Run full workflow |
| `npm run notebooklm:pull` | Extract content from Notion |
| `npm run notebooklm:sync` | Sync media links to Notion |
| `npm run notebooklm:helper` | Interactive media helper |

## Automation Ideas

### 1. Google Apps Script
Create a script to batch upload to NotebookLM and track processing.

### 2. Webhook Integration
Set up webhooks to notify when NotebookLM processing is complete.

### 3. Cloud Storage
Upload generated media to cloud storage (S3, GCS) and use public URLs.

### 4. CI/CD Pipeline
Automate the entire workflow using GitHub Actions or similar.

## Troubleshooting

### Issue: Notion API 502 Error
- Wait a few minutes and retry
- Check Notion API status
- Verify API key is correct

### Issue: Missing Columns in Notion
- Add VideoLink and AudioLink URL columns to your database
- Ensure column names match exactly

### Issue: Large Content Files
- NotebookLM has file size limits
- Content is automatically split into manageable chunks
- Process very long posts separately

## Best Practices

1. **Process in batches** - Don't upload 100+ files at once to NotebookLM
2. **Use consistent naming** - Keep slugs consistent across systems
3. **Track progress** - Use the CSV export to monitor processing
4. **Store media properly** - Upload to reliable cloud storage
5. **Test first** - Try with a few posts before bulk processing

## Example Workflow

```bash
# 1. Pull latest blog content
npm run notebooklm:pull

# 2. Check what needs processing
npm run notebooklm:helper
# Select option 1 to list unprocessed

# 3. Process batch in NotebookLM
# (Manual step - upload files, generate media)

# 4. Record media URLs
npm run notebooklm:helper
# Select option 2 to record URLs

# 5. Sync to Notion
npm run notebooklm:sync

# 6. Verify in Notion
# Check that VideoLink and AudioLink columns are populated
```

## Future Enhancements

- [ ] Direct NotebookLM API integration (when available)
- [ ] Automated media upload to cloud storage
- [ ] Webhook notifications for completed processing
- [ ] Batch scheduling for large volumes
- [ ] Quality checks for generated content
- [ ] Analytics tracking for media performance

## Support

For issues or questions:
1. Check the error logs in console
2. Verify your Notion API key and database structure
3. Ensure all required columns exist in Notion
4. Review the generated files in `notebooklm_output/`