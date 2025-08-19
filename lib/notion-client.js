import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

export function createNotionClient() {
  const apiKey = process.env.NOTION_API_KEY;
  
  if (!apiKey) {
    throw new Error('NOTION_API_KEY is not set in environment variables');
  }
  
  return new Client({
    auth: apiKey,
  });
}