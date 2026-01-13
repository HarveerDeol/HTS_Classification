import pg from 'pg';
import { HfInference } from '@huggingface/inference';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.PG_HOST,      
  port: Number(process.env.PG_PORT), 
  database: process.env.PG_DB,   
  user: process.env.PG_USER,      
  password: process.env.PG_PASSWORD, 
  ssl: {
    require: true,
    rejectUnauthorized: false,
  }
});

const hf = new HfInference(process.env.HF_TOKEN);
const EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2";

export async function retrieveHTSCodes(productDescription, k = 5) {
  try {
    console.log('🔍 Generating query embedding...');
    
    const queryEmbedding = await hf.featureExtraction({
      model: EMBEDDING_MODEL,
      inputs: `Product: ${productDescription}`
    });

    const flatEmbedding = Array.isArray(queryEmbedding[0]) ? queryEmbedding[0] : queryEmbedding;

    console.log('📊 Searching for top', k, 'similar HTS codes...');
    
    const result = await pool.query(`
      SELECT 
        htsno as code,
        descript as description,
        general,
        special,
        indent,
        1 - (embedding <=> $1::vector) as similarity
      FROM tariff_codes
      WHERE indent <= 2 
        AND embedding IS NOT NULL
        AND htsno IS NOT NULL
      ORDER BY 
        embedding <=> $1::vector,
        indent DESC
      LIMIT $2
    `, [`[${flatEmbedding.join(',')}]`, k]);

    console.log(`✅ Found ${result.rows.length} candidates`);
    console.log("Top candidates:", result.rows);
    
    return result.rows;
  } catch (err) {
    console.error('❌ Retrieval error:', err);
    throw err;
  }
}

export async function closePool() {
  await pool.end();
}