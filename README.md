# Notion Find & Replace

A command-line tool to find and replace text across all pages in your Notion workspace.

## Features

- Search and replace text across all pages in a Notion workspace
- Dry-run mode to preview changes before applying them
- Interactive prompts for search and replace text
- Detailed progress reporting and error handling
- Supports all common Notion block types (paragraphs, headings, lists, code blocks, etc.)

## Prerequisites

- Node.js 18+ installed
- A Notion integration with access to your workspace

## Setup

### 1. Create a Notion Integration

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Give it a name (e.g., "Find Replace Tool")
4. Select the workspace you want to use
5. Copy the Internal Integration Token

### 2. Connect the Integration to Your Pages

1. Open your Notion workspace
2. For each page or database you want to search:
   - Click the "..." menu in the top right
   - Go to "Connections"
   - Add your integration

Note: The integration needs to be connected to the parent page to access all child pages.

### 3. Install and Configure

```bash
# Clone or download this project
cd notion_edit

# Install dependencies
npm install

# Create a .env file
cp .env.example .env

# Edit .env and add your Notion integration token
# NOTION_API_KEY=your_integration_token_here
```

## Usage

### Find and Replace

Replace text across all pages:

```bash
npm start replace
```

Or with command-line options:

```bash
npm start replace -s "old text" -r "new text"

# Skip confirmation prompt
npm start replace -s "old text" -r "new text" -y

# Suppress individual block warnings
npm start replace -s "old text" -r "new text" --silent
```

### Dry Run

Preview what would be changed without making modifications:

```bash
npm start dry-run
```

Or specify the search text:

```bash
npm start dry-run -s "text to find"
```

## How It Works

1. The tool fetches all pages from your Notion workspace that the integration has access to
2. For each page, it retrieves all blocks (paragraphs, headings, lists, etc.)
3. It searches for the specified text in each block's content
4. If found, it replaces the text and updates the block in Notion
5. Provides a detailed summary of all changes made

## Supported Block Types

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

## Limitations

- Only searches and replaces plain text content (not in titles, databases properties, or formulas)
- Requires the integration to be connected to pages (not automatically applied to all workspace pages)
- Does not search in comments, page titles, or database properties
- Table blocks require special permissions and may not always be editable

## Error Handling

The tool will continue processing even if individual blocks fail, and will report:
- Total pages scanned
- Pages successfully modified
- Number of replacements made
- Any errors encountered

## Safety Tips

1. Always run a dry-run first to preview changes
2. Test on a small set of pages before running on your entire workspace
3. Consider backing up important pages before bulk replacements
4. The tool will ask for confirmation before making changes (unless using -y flag)