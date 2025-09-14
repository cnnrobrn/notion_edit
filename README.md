# Notion Workspace Tools

A comprehensive Node.js toolkit for managing and analyzing Notion workspaces, featuring bulk text replacement, content analysis, and database management capabilities.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Core Tools](#core-tools)
  - [Checkbox to Bullet Point Converter](#checkbox-to-bullet-point-converter)
  - [Quote Block to Quoted Text Converter](#quote-block-to-quoted-text-converter)
  - [Text-to-Speech Converter](#text-to-speech-converter)
  - [Find and Replace](#find-and-replace)
  - [H1 Tag Analyzer](#h1-tag-analyzer)
  - [Database Page Counter](#database-page-counter)
- [Usage Examples](#usage-examples)
- [API Documentation](#api-documentation)
- [Architecture](#architecture)
- [Performance Considerations](#performance-considerations)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Features

### Core Capabilities
- **Checkbox to Bullet Converter**: Convert all to-do items to bullet points across your workspace
- **Quote to Text Converter**: Convert all quote blocks to regular paragraphs with quotation marks
- **Text-to-Speech Converter**: Convert blog content to audio using OpenAI TTS with onyx voice
- **Bulk Find & Replace**: Search and replace text across all pages in your Notion workspace
- **Content Analysis**: Analyze page structure, including H1 tag usage across your content
- **Database Management**: Query and analyze specific Notion databases
- **Dry Run Mode**: Preview changes before applying them
- **Batch Processing**: Efficient handling of large workspaces with thousands of pages
- **Comprehensive Logging**: Detailed operation logs for debugging and auditing
- **Error Resilience**: Continues processing even when individual pages fail

### Technical Features
- Asynchronous batch processing for optimal performance
- Rate limit handling for Notion API
- Progress tracking with visual indicators
- JSON export for analysis results
- Support for all Notion block types
- Link URL replacement support

## Prerequisites

- Node.js v16.0.0 or higher
- npm or yarn package manager
- Notion account with admin access
- Notion API integration token

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/notion-workspace-tools.git
cd notion-workspace-tools
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Notion Integration

1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Give your integration a name (e.g., "Workspace Tools")
4. Select the workspace you want to access
5. Copy the Internal Integration Token

### 4. Configure Environment Variables

Create a `.env` file in the project root:

```env
NOTION_API_KEY=your_integration_token_here
OPENAI_API_KEY=your_openai_api_key_here  # Required for TTS conversion
```

Or copy from the example:

```bash
cp .env.example .env
# Then edit .env with your token
```

### 5. Connect Integration to Your Workspace

1. Open any Notion page in your workspace
2. Click the "..." menu in the top right
3. Select "Connections"
4. Find and add your integration
5. For bulk operations, ensure the integration has access to all relevant pages

## Core Tools

### Checkbox to Bullet Point Converter

Converts all checkboxes (to-do items) to bullet points across your entire Notion workspace.

#### Usage

```bash
# Preview what would be converted (dry run)
npm start convert-checkboxes -- --dry-run

# Convert all checkboxes to bullets (with confirmation)
npm start convert-checkboxes

# Convert without confirmation prompt
npm start convert-checkboxes -- --yes

# Run standalone script
node convert-checkboxes-to-bullets.js --dry-run
```

#### Features
- Converts all to-do/checkbox blocks to bullet points
- Preserves text content, formatting, and colors
- Handles nested blocks recursively
- Dry-run mode for safe preview
- Progress tracking and detailed reporting
- Continues processing even if individual conversions fail

#### Important Notes
- Due to Notion API limitations, block type changes require deleting the original block and creating a new one
- The new bullet points will appear after the original checkbox position
- This operation cannot be easily undone - use dry-run mode first to preview changes
- AI-generated blocks (ai_block) are automatically skipped as they're not accessible via the API

### Quote Block to Quoted Text Converter

Converts all quote blocks to regular paragraphs with quotation marks.

#### Usage

```bash
# Preview what would be converted (dry run)
npm start convert-quotes -- --dry-run

# Convert all quotes to quoted text (with confirmation)
npm start convert-quotes

# Convert without confirmation prompt
npm start convert-quotes -- --yes

# Run standalone script
node convert-quotes-to-text.js --dry-run
```

#### Features
- Converts quote blocks to paragraphs with "quoted text"
- Preserves text content, formatting, and colors
- Handles nested blocks recursively
- Dry-run mode for safe preview
- Progress tracking and detailed reporting
- Skips unsupported block types (like AI blocks) gracefully

#### Important Notes
- Converts quote blocks to regular paragraphs surrounded by quotation marks
- The new paragraphs will appear after the original quote position
- This operation cannot be easily undone - use dry-run mode first

### Text-to-Speech Converter

Converts blog post content to audio using OpenAI's TTS API with the onyx voice and stores it as base64 in the Content64 field.

#### Usage

```bash
# Convert blog content to audio
npm run tts

# Or run directly
node convert-content-to-tts.js
```

#### Features
- Automatically finds and processes the "Blogs" database
- Converts Content field text to speech using OpenAI TTS
- Uses the "onyx" voice for natural-sounding narration
- Encodes audio as base64 and stores in Content64 field
- Skips pages that already have Content64 populated
- Handles text up to 4096 characters (OpenAI TTS limit)
- Includes retry logic for API failures
- Progress tracking with visual indicators
- Detailed summary of processed, skipped, and failed pages

#### Requirements
- OpenAI API key must be set in `.env` file
- Blog pages must have a "Content" field with text
- Blog pages must have a "Content64" field for storing audio

#### Important Notes
- The script processes up to 4096 characters per blog post (OpenAI limit)
- Audio is stored as base64 text in the Content64 field
- Large audio files may result in significant base64 text
- The script will skip pages that already have Content64 data
- Processing includes a small delay between pages to avoid rate limits

### Find and Replace

The main tool for bulk text replacement across your entire Notion workspace.

#### Basic Usage

```bash
# Interactive mode
npm start replace

# With command line arguments
npm start replace -s "old text" -r "new text"

# Skip confirmation prompt
npm start replace -s "old text" -r "new text" -y

# Suppress individual block warnings
npm start replace -s "old text" -r "new text" --silent
```

#### Dry Run Mode

Preview what would be changed without making actual modifications:

```bash
# Interactive search
npm start dry-run

# With search term
npm start dry-run -s "search term"
```

#### Features
- Searches through all text content in all blocks
- Replaces text in regular content, links, and URLs
- Maintains text formatting and styling
- Provides detailed summary of changes
- Error handling for inaccessible pages

### H1 Tag Analyzer

Analyze heading structure across your workspace to ensure proper content hierarchy.

#### Basic Version

```bash
node check-h1-tags.js
```

#### Optimized Version (Recommended for Large Workspaces)

```bash
node check-h1-tags-optimized.js
```

#### Features
- Counts pages with and without H1 tags
- Calculates percentage statistics
- Exports full report to JSON
- Batch processing for performance
- Sample list of pages without H1 tags

#### Output Format

```json
{
  "summary": {
    "totalPages": 1206,
    "pagesWithH1": 129,
    "pagesWithoutH1": 1077,
    "errorCount": 0,
    "percentageWithH1": "10.7"
  },
  "pagesWithH1": [...],
  "pagesWithoutH1": [...]
}
```

### Database Page Counter

Count and analyze pages in specific Notion databases.

```bash
node count-database-pages.js
```

To use with a different database, edit the `databaseId` in the script:

```javascript
const databaseId = 'your-database-id-here';
```

#### Extracting Database ID from URL

Given a Notion database URL like:
```
https://www.notion.so/23a07890f53280e98cded8006815e521?v=...
```

The database ID is: `23a07890-f532-80e9-8cde-d8006815e521`
(Note the formatting change with dashes)

## Usage Examples

### Example 1: Update Company Name

```bash
npm start replace -s "OldCompany Inc." -r "NewCompany Corp." -y
```

### Example 2: Fix Common Typos

```bash
npm start replace -s "teh" -r "the" -y
npm start replace -s "recieve" -r "receive" -y
```

### Example 3: Update URLs

```bash
npm start replace -s "http://old-domain.com" -r "https://new-domain.com" -y
```

### Example 4: Content Audit

```bash
# Check for outdated year references
npm start dry-run -s "2023"

# Find pages with specific terms
npm start dry-run -s "deprecated"
```

### Example 5: SEO Analysis

```bash
# Check H1 tag coverage
node check-h1-tags-optimized.js

# Analyze specific database
node count-database-pages.js
```

## Supported Block Types

The tools support all common Notion block types:

- Paragraphs
- Headings (H1, H2, H3)
- Bulleted lists
- Numbered lists
- Toggle lists
- To-do items
- Quotes
- Callouts
- Code blocks
- Table cells

## API Documentation

### Library Modules

#### `lib/notion-client.js`
Creates and configures the Notion API client.

```javascript
import { createNotionClient } from './lib/notion-client.js';
const notion = createNotionClient();
```

#### `lib/page-fetcher.js`
Handles page and block retrieval from Notion.

```javascript
import { getAllPages, getPageContent } from './lib/page-fetcher.js';

const pages = await getAllPages(notion);
const blocks = await getPageContent(notion, pageId);
```

#### `lib/text-processor.js`
Processes and modifies text content in Notion blocks.

```javascript
import { extractTextFromBlock, replaceTextInBlock } from './lib/text-processor.js';

const texts = extractTextFromBlock(block);
const modified = replaceTextInBlock(block, searchText, replaceText);
```

#### `lib/find-replace.js`
Orchestrates the find and replace operation.

```javascript
import { findAndReplaceInWorkspace } from './lib/find-replace.js';

const results = await findAndReplaceInWorkspace(notion, searchText, replaceText, options);
```

### Result Object Structure

```javascript
{
  totalPages: 1206,
  modifiedPages: [
    {
      id: "page-id",
      title: "Page Title",
      replacements: 5
    }
  ],
  totalReplacements: 42,
  errors: [
    {
      pageId: "page-id",
      pageTitle: "Page Title",
      error: "Error message"
    }
  ]
}
```

## Architecture

### Project Structure

```
notion-workspace-tools/
├── index.js                    # Main CLI entry point
├── lib/
│   ├── notion-client.js       # Notion API client setup
│   ├── page-fetcher.js        # Page retrieval logic
│   ├── text-processor.js      # Text manipulation utilities
│   └── find-replace.js        # Core find-replace logic
├── convert-content-to-tts.js   # Text-to-speech converter
├── check-h1-tags.js            # H1 tag analyzer
├── check-h1-tags-optimized.js  # Batch-optimized H1 analyzer
├── count-database-pages.js     # Database page counter
├── .env                        # Environment variables
├── .env.example                # Example environment file
├── package.json                # Project dependencies
└── README.md                   # Documentation
```

### Data Flow

1. **Authentication**: Environment variables → Notion Client
2. **Page Discovery**: Notion API → Page Fetcher → Page List
3. **Content Processing**: Page Blocks → Text Processor → Modified Blocks
4. **Updates**: Modified Blocks → Notion API → Updated Pages
5. **Reporting**: Results → Console/JSON Export

## Performance Considerations

### Large Workspace Handling

For workspaces with 1000+ pages:

1. **Use Optimized Scripts**: The `-optimized` versions implement batch processing
2. **Batch Size**: Default is 50 pages per batch, adjustable in code
3. **Rate Limiting**: Built-in delays prevent API throttling
4. **Memory Management**: Processes pages sequentially to avoid memory issues

### API Rate Limits

- Notion API allows 3 requests per second
- Scripts include automatic retry logic
- Use `--silent` flag to reduce console output overhead

### Optimization Tips

1. **Run During Off-Hours**: Less competition for API resources
2. **Test on Subset First**: Use dry-run mode or test on specific database
3. **Monitor Progress**: Scripts provide real-time progress updates
4. **Export Results**: Use JSON export for large result sets

## Limitations

- Only searches and replaces plain text content (not in titles, databases properties, or formulas)
- Requires the integration to be connected to pages (not automatically applied to all workspace pages)
- Does not search in comments, page titles, or database properties
- Table blocks require special permissions and may not always be editable

## Troubleshooting

### Common Issues

#### "NOTION_API_KEY not found"
- Ensure `.env` file exists in project root
- Check that the API key is correctly formatted
- Verify no extra spaces or quotes in the `.env` file

#### "Integration not found" or 401 errors
- Confirm integration is connected to your workspace
- Check that pages are shared with the integration
- Verify the API key is current and not revoked

#### "Page not found" or 404 errors
- Ensure the integration has access to the page
- Check if the page still exists in Notion
- Verify database IDs are correctly formatted

#### Timeout Issues
- Increase timeout values in scripts
- Process smaller batches
- Check network connectivity
- Consider running scripts with fewer pages

#### Memory Issues
- Reduce batch size in optimized scripts
- Process specific databases instead of entire workspace
- Clear Node.js cache: `node --max-old-space-size=4096 script.js`

### Debug Mode

Enable verbose logging by modifying scripts:

```javascript
// Add to any script for more details
console.log(JSON.stringify(response, null, 2));
```

### Getting Help

1. Check existing issues in the repository
2. Review Notion API documentation
3. Enable debug logging for detailed error information
4. Create an issue with:
   - Error message
   - Script being run
   - Workspace size estimate
   - Node.js version

## Safety Tips

1. **Always run a dry-run first** to preview changes
2. **Test on a small set of pages** before running on your entire workspace
3. **Consider backing up important pages** before bulk replacements
4. **The tool will ask for confirmation** before making changes (unless using -y flag)

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Maintain existing code style
- Add tests for new features
- Update documentation
- Follow semantic versioning
- Include examples in PR description

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Built with [Notion API](https://developers.notion.com/)
- Uses [Commander.js](https://github.com/tj/commander.js/) for CLI
- Styled with [Chalk](https://github.com/chalk/chalk)
- Progress indicators by [Ora](https://github.com/sindresorhus/ora)
- Logging with [Winston](https://github.com/winstonjs/winston)

## Roadmap

- [ ] Add support for filtering by page properties
- [ ] Implement regex pattern matching
- [ ] Add backup/restore functionality
- [ ] Create web interface
- [ ] Add scheduling capabilities
- [ ] Implement change history tracking
- [ ] Add support for multiple workspaces
- [ ] Create GitHub Action for CI/CD
- [ ] Add support for database properties
- [ ] Implement parallel processing for faster operations
- [ ] Add export to CSV/Excel functionality
- [ ] Create interactive mode with menu system

---

**Note**: This tool modifies content in your Notion workspace. Always test on a small subset of pages first and maintain backups of critical content.