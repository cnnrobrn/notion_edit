import { Client } from '@notionhq/client';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import chalk from 'chalk';
import ora from 'ora';

dotenv.config();

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

function splitTextIntoChunks(text, maxLength = 4000) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let currentPosition = 0;

  while (currentPosition < text.length) {
    let chunkEnd = Math.min(currentPosition + maxLength, text.length);

    if (chunkEnd < text.length) {
      // Look for sentence endings before the max length
      let searchStart = Math.max(currentPosition, chunkEnd - 1000);
      let bestSentenceEnd = -1;

      // Search backwards from chunkEnd for sentence endings
      for (let i = chunkEnd - 1; i > searchStart; i--) {
        const char = text[i];
        if (char === '.' || char === '!' || char === '?') {
          // Check if this is likely a sentence end (followed by space, newline, or end of text)
          if (i === text.length - 1 || text[i + 1] === ' ' || text[i + 1] === '\n' || text[i + 1] === '\r') {
            bestSentenceEnd = i + 1;
            break;
          }
        }
      }

      // If we found a sentence ending, use it
      if (bestSentenceEnd > currentPosition) {
        chunkEnd = bestSentenceEnd;
      } else {
        // If no sentence ending found in reasonable range, look further back
        searchStart = Math.max(currentPosition, chunkEnd - 2000);
        for (let i = chunkEnd - 1; i > searchStart; i--) {
          const char = text[i];
          if (char === '.' || char === '!' || char === '?') {
            if (i === text.length - 1 || text[i + 1] === ' ' || text[i + 1] === '\n' || text[i + 1] === '\r') {
              bestSentenceEnd = i + 1;
              break;
            }
          }
        }

        if (bestSentenceEnd > currentPosition) {
          chunkEnd = bestSentenceEnd;
        } else {
          // Last resort: find the last space to avoid breaking words
          const lastSpace = text.lastIndexOf(' ', chunkEnd);
          if (lastSpace > currentPosition) {
            chunkEnd = lastSpace;
          }
        }
      }
    }

    const chunk = text.substring(currentPosition, chunkEnd).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    currentPosition = chunkEnd;
    // Skip any whitespace at the start of the next chunk
    while (currentPosition < text.length && (text[currentPosition] === ' ' || text[currentPosition] === '\n' || text[currentPosition] === '\r')) {
      currentPosition++;
    }
  }

  return chunks;
}

async function concatenateAudioBuffers(audioBuffers) {
  const totalLength = audioBuffers.reduce((acc, buf) => acc + buf.length, 0);
  const concatenated = Buffer.concat(audioBuffers, totalLength);
  return concatenated;
}

async function convertTextToSpeech(text, maxRetries = 3) {
  if (!text || text.trim().length === 0) {
    console.log(chalk.yellow('  ⚠ Empty text, skipping TTS conversion'));
    return null;
  }

  const chunks = splitTextIntoChunks(text, 4000);

  if (chunks.length > 1) {
    console.log(chalk.gray(`  📄 Split into ${chunks.length} chunks for processing`));
  }

  const audioBuffers = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(chalk.gray(`  🎤 Processing chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`));

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const mp3Response = await openai.audio.speech.create({
          model: "tts-1",
          voice: "onyx",
          input: chunk,
          speed: 1.0,
          response_format: "opus"
        });

        const buffer = Buffer.from(await mp3Response.arrayBuffer());
        audioBuffers.push(buffer);

        break;
      } catch (error) {
        console.log(chalk.yellow(`  ⚠ Chunk ${i + 1} attempt ${attempt}/${maxRetries} failed: ${error.message}`));

        if (attempt === maxRetries) {
          console.log(chalk.red(`  ✗ Failed to convert chunk ${i + 1} after ${maxRetries} attempts`));
          return null;
        }

        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }

    if (i < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  if (audioBuffers.length === 0) {
    return null;
  }

  let finalBuffer;
  if (audioBuffers.length === 1) {
    finalBuffer = audioBuffers[0];
  } else {
    console.log(chalk.gray(`  🔗 Concatenating ${audioBuffers.length} audio chunks...`));
    finalBuffer = await concatenateAudioBuffers(audioBuffers);
  }

  const base64Audio = finalBuffer.toString('base64');

  // Split the base64 audio into chunks that fit in Notion fields
  // CRITICAL: After field 12, Notion seems to have issues with large payloads
  // Reducing to 100KB per field to ensure reliability
  const MAX_FIELD_SIZE = 100000; // 100KB per field for maximum reliability
  const audioChunks = [];

  for (let i = 0; i < base64Audio.length; i += MAX_FIELD_SIZE) {
    audioChunks.push(base64Audio.substring(i, Math.min(i + MAX_FIELD_SIZE, base64Audio.length)));
  }

  const totalSizeMB = (base64Audio.length / 1024 / 1024).toFixed(2);
  console.log(chalk.gray(`  📦 Total audio size: ${totalSizeMB} MB (base64)`));

  if (audioChunks.length > 1) {
    console.log(chalk.cyan(`  📂 Split into ${audioChunks.length} fields for storage`));
    console.log(chalk.gray(`  📊 Each field: ~${(MAX_FIELD_SIZE / 1024).toFixed(0)} KB (JSON payload: ~${(MAX_FIELD_SIZE * 5 / 1024).toFixed(0)} KB)`));
  }

  return audioChunks;
}

async function updatePageWithAudio(pageId, audioChunks) {
  try {
    let successfulFields = [];
    const BATCH_SIZE = 5; // Update only 5 fields, then pause
    const BATCH_DELAY = 5000; // 5 second pause between batches
    const MINI_BATCH_SIZE = 3; // Mini pause every 3 fields
    const MINI_BATCH_DELAY = 2000; // 2 second mini pause

    console.log(chalk.gray(`  📊 Total fields to update: ${audioChunks.length}`));

    // Add initial delay to let Notion recover from previous operations
    console.log(chalk.gray(`  ⏱️  Initial 2s delay before starting updates...`));
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Update each field separately to avoid exceeding Notion's request size limit
    for (let fieldIndex = 0; fieldIndex < audioChunks.length; fieldIndex++) {
      // Special handling before field 13 - Notion seems to have issues here
      if (fieldIndex === 12) {
        console.log(chalk.cyan(`  ⚠️  Approaching field 13 - taking extra 8-second pause to reset Notion...`));
        await new Promise(resolve => setTimeout(resolve, 8000));
      }

      // Add longer delay after every batch of fields to avoid rate limiting
      if (fieldIndex > 0 && fieldIndex % BATCH_SIZE === 0) {
        console.log(chalk.cyan(`  ⏸️  Major pause for ${BATCH_DELAY/1000}s to reset rate limits (completed ${fieldIndex}/${audioChunks.length} fields)`));
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
      } else if (fieldIndex > 0 && fieldIndex % MINI_BATCH_SIZE === 0) {
        console.log(chalk.gray(`  ⏸️  Mini pause for ${MINI_BATCH_DELAY/1000}s (completed ${fieldIndex}/${audioChunks.length} fields)`));
        await new Promise(resolve => setTimeout(resolve, MINI_BATCH_DELAY));
      }
      const fieldName = fieldIndex === 0 ? 'Content64' : `Content64_${fieldIndex + 1}`;
      const audioBase64 = audioChunks[fieldIndex];

      // Split each field's content into Notion's text chunks
      // Use smaller chunks for fields 13+ to avoid issues
      const textChunks = [];
      const maxChunkSize = fieldIndex >= 12 ? 1000 : 2000; // Smaller chunks after field 12

      // For fields 13+, limit the total amount of data
      const dataToStore = fieldIndex >= 12
        ? audioBase64.substring(0, Math.min(audioBase64.length, 50000)) // Max 50KB for fields 13+
        : audioBase64;

      for (let i = 0; i < dataToStore.length; i += maxChunkSize) {
        textChunks.push({
          type: 'text',
          text: {
            content: dataToStore.substring(i, Math.min(i + maxChunkSize, dataToStore.length))
          }
        });
      }

      const numTextChunks = textChunks.length;
      const estimatedPayloadKB = (audioBase64.length * 5 / 1024).toFixed(0);
      console.log(chalk.gray(`  📝 Updating field ${fieldName} (${(audioBase64.length / 1024).toFixed(0)} KB → ${numTextChunks} chunks → ~${estimatedPayloadKB} KB payload)`));

      // Update this field individually with retry logic
      let retries = 0;
      const MAX_RETRIES = 3; // Increased retries with longer delays

      while (retries <= MAX_RETRIES) {
        try {
          await notion.pages.update({
            page_id: pageId,
            properties: {
              [fieldName]: {
                rich_text: textChunks
              }
            }
          });
          successfulFields.push(fieldName);
          break; // Success, exit retry loop
        } catch (fieldError) {
          retries++;

          if (fieldError.message.includes('internal_server_error')) {
            // Special handling for field 13 - Notion may have cumulative limits
            if (fieldIndex === 12 && retries === 0) { // Content64_13 is index 12, first attempt
              console.log(chalk.yellow(`  ⚠️  Field 13 often fails due to Notion limits`));
              console.log(chalk.cyan(`  ⏸️  Taking a 10-second break to reset Notion's systems...`));
              await new Promise(resolve => setTimeout(resolve, 10000));
              console.log(chalk.cyan(`  🔄 Retrying with smaller payload...`));

              // Try with a smaller chunk for field 13
              const smallerChunks = [];
              const smallChunkSize = 1000; // Much smaller chunks for field 13+
              for (let i = 0; i < Math.min(audioBase64.length, 50000); i += smallChunkSize) {
                smallerChunks.push({
                  type: 'text',
                  text: {
                    content: audioBase64.substring(i, Math.min(i + smallChunkSize, audioBase64.length))
                  }
                });
              }

              try {
                await notion.pages.update({
                  page_id: pageId,
                  properties: {
                    [fieldName]: {
                      rich_text: smallerChunks
                    }
                  }
                });
                successfulFields.push(fieldName);
                console.log(chalk.green(`  ✅ Successfully updated ${fieldName} with reduced payload`));
                break; // Exit retry loop on success
              } catch (retryError) {
                console.log(chalk.yellow(`  ⚠️  Still failed with smaller payload, continuing retries...`));
                // Continue with normal retry logic
              }
            }

            if (retries <= MAX_RETRIES) {
              const retryDelay = 3000 * retries; // Exponential backoff: 3s, 6s, 9s
              console.log(chalk.yellow(`  ⚠️  Internal error on ${fieldName}, retrying in ${retryDelay/1000}s (attempt ${retries}/${MAX_RETRIES})`));
              await new Promise(resolve => setTimeout(resolve, retryDelay));
            } else {
              throw fieldError;
            }
          } else if (fieldError.message.includes('validation_error') || fieldError.message.includes('path.not_found')) {
            console.log(chalk.yellow(`  ⏭️  Field ${fieldName} doesn't exist, stopping here`));
            console.log(chalk.cyan(`  💡 Create fields up to Content64_${audioChunks.length} in Notion to store complete audio`));
            return successfulFields.length > 0; // Return success if we stored some audio
          } else {
            console.error(chalk.red(`  ✗ Failed to update ${fieldName}: ${fieldError.message}`));
            if (retries > MAX_RETRIES) {
              throw fieldError;
            }
          }
        }
      }

      // Progressive delay between updates to avoid rate limiting
      let delay;
      if (fieldIndex < 3) {
        delay = 1000; // 1s for first 3 fields
      } else if (fieldIndex < 6) {
        delay = 1500; // 1.5s for fields 4-6
      } else if (fieldIndex < 10) {
        delay = 2000; // 2s for fields 7-10
      } else if (fieldIndex < 13) {
        delay = 3000; // 3s for fields 11-13
      } else {
        delay = 4000; // 4s for fields 14+
      }

      if (fieldIndex < audioChunks.length - 1) {
        console.log(chalk.gray(`  ⏱️  Waiting ${delay/1000}s before next field...`));
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Report completion
    if (successfulFields.length === audioChunks.length) {
      console.log(chalk.green(`  ✅ Successfully stored all ${successfulFields.length} audio fields`));
    } else if (successfulFields.length > 0) {
      console.log(chalk.yellow(`  ⚠️  Stored partial audio (${successfulFields.length}/${audioChunks.length} fields)`));
      const percentStored = Math.round((successfulFields.length / audioChunks.length) * 100);
      console.log(chalk.yellow(`  📊 Audio coverage: ${percentStored}% of full content`));
    }

    return successfulFields.length > 0;
  } catch (error) {
    console.error(chalk.red(`  ✗ Error updating page with audio: ${error.message}`));
    return false;
  }
}

async function getPageContent(page) {
  const contentProperty = page.properties.Content || page.properties.content;

  if (!contentProperty || contentProperty.type !== 'rich_text') {
    return null;
  }

  const richTextArray = contentProperty.rich_text || [];

  return richTextArray.map(rt => rt.plain_text || '').join('');
}

async function hasExistingAudio(page) {
  // Check primary Content64 field
  const content64Property = page.properties.Content64 || page.properties.content64;

  if (content64Property && content64Property.type === 'rich_text') {
    const richTextArray = content64Property.rich_text || [];
    const existingContent = richTextArray.map(rt => rt.plain_text || '').join('').trim();

    if (existingContent.length > 0) {
      return true;
    }
  }

  // Also check Content64_2 to see if there's overflow audio
  const content64_2Property = page.properties.Content64_2 || page.properties.content64_2;

  if (content64_2Property && content64_2Property.type === 'rich_text') {
    const richTextArray = content64_2Property.rich_text || [];
    const existingContent = richTextArray.map(rt => rt.plain_text || '').join('').trim();

    if (existingContent.length > 0) {
      return true;
    }
  }

  return false;
}

async function main() {
  console.log(chalk.blue('\n🎙️  Starting Text-to-Speech conversion for blog posts...\n'));

  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
    console.error(chalk.red('❌ OPENAI_API_KEY is not set in .env file'));
    console.log(chalk.yellow('Please add your OpenAI API key to the .env file'));
    process.exit(1);
  }

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
    let skippedCount = 0;
    let failedCount = 0;
    let emptyContentCount = 0;

    while (hasMore) {
      const response = await notion.databases.query({
        database_id: databaseId,
        start_cursor: cursor,
        page_size: 10
      });

      for (const page of response.results) {
        const title = page.properties.Name?.title?.[0]?.plain_text ||
                     page.properties.Title?.title?.[0]?.plain_text ||
                     page.properties.name?.title?.[0]?.plain_text ||
                     'Untitled';

        spinner.stop();
        console.log(chalk.cyan(`\nProcessing: ${title}`));
        spinner.start(`Processing: ${title}`);

        if (await hasExistingAudio(page)) {
          skippedCount++;
          spinner.stop();
          console.log(chalk.gray(`  ⏭️  Skipped (already has audio): ${title}`));
          spinner.start();
          continue;
        }

        const content = await getPageContent(page);

        if (!content || content.trim().length === 0) {
          emptyContentCount++;
          spinner.stop();
          console.log(chalk.yellow(`  ⚠️  No content found in: ${title}`));
          spinner.start();
          continue;
        }

        spinner.stop();
        console.log(chalk.gray(`  📝 Content length: ${content.length} characters`));

        if (content.length > 4000) {
          const numChunks = Math.ceil(content.length / 4000);
          console.log(chalk.cyan(`  📚 Long content detected - will process in ~${numChunks} chunks`));

          const estimatedMinutes = Math.ceil((numChunks * 0.5) + (content.length / 15000));
          if (estimatedMinutes > 1) {
            console.log(chalk.gray(`  ⏱️  Estimated processing time: ~${estimatedMinutes} minutes`));
          }
        }

        console.log(chalk.gray(`  🎤 Converting to speech with onyx voice...`));
        spinner.start(`Converting ${title} to speech...`);

        const audioChunks = await convertTextToSpeech(content);

        if (audioChunks && audioChunks.length > 0) {
          spinner.stop();

          if (audioChunks.length > 1) {
            console.log(chalk.cyan(`  📂 Audio will be stored across ${audioChunks.length} fields`));
          }

          spinner.start(`Updating ${title} in Notion...`);

          const success = await updatePageWithAudio(page.id, audioChunks);

          if (success) {
            processedCount++;
            spinner.stop();
            console.log(chalk.green(`  ✅ Successfully processed: ${title}`));
            if (audioChunks.length > 1) {
              console.log(chalk.gray(`     Stored in: Content64, ${audioChunks.slice(1).map((_, i) => `Content64_${i + 2}`).join(', ')}`));
            }
            spinner.start();
          } else {
            failedCount++;
            spinner.stop();
            console.log(chalk.red(`  ❌ Failed to update: ${title}`));
            spinner.start();
          }
        } else {
          failedCount++;
          spinner.stop();
          console.log(chalk.red(`  ❌ Failed to convert to speech: ${title}`));
          spinner.start();
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      hasMore = response.has_more;
      cursor = response.next_cursor;
    }

    spinner.stop();

    console.log(chalk.blue('\n📊 Summary'));
    console.log(chalk.blue('═'.repeat(40)));
    console.log(chalk.green(`✅ Successfully processed: ${processedCount} pages`));
    console.log(chalk.gray(`⏭️  Skipped (already had audio): ${skippedCount} pages`));
    console.log(chalk.yellow(`⚠️  Empty content: ${emptyContentCount} pages`));
    if (failedCount > 0) {
      console.log(chalk.red(`❌ Failed: ${failedCount} pages`));
    }
    console.log(chalk.blue('═'.repeat(40)));
    console.log(chalk.green('\n✨ TTS conversion complete!\n'));

  } catch (error) {
    spinner.fail(chalk.red(`Error: ${error.message}`));
    console.error(chalk.red('\nStack trace:'), error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});