import { Pool } from "pg";
import { HfInference } from '@huggingface/inference';
import dotenv from "dotenv";

dotenv.config();


export const pool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  database: process.env.PG_DB,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl: {
    require: true,
    rejectUnauthorized: false,
  },
});

//{ rejectUnauthorized: false, requestCert: false }

const hf = new HfInference(process.env.HF_TOKEN);
const EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
const BATCH_SIZE = 10;

async function generateEmbeddings() {
  try {
    // Embed indent 0, 1, AND 2 (specific product codes)
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM tariff_codes WHERE indent <= 2 AND embedding IS NULL'
    );
    const totalRows = parseInt(countResult.rows[0].count);
    console.log(`\nFound ${totalRows} HTS codes (indent<=2) needing embeddings\n`);

    let processed = 0;
    let batchNumber = 0;

    while (processed < totalRows) {
      batchNumber++;
      
      // In your embedding script, add a WHERE clause to check for unique rows
      const result = await pool.query(
        `SELECT DISTINCT ON (htsno, descript, indent) 
        htsno, descript, indent 
        FROM tariff_codes 
        WHERE indent <= 2 
        AND embedding IS NULL 
        AND htsno IS NOT NULL
        ORDER BY htsno, descript, indent
        LIMIT $1`,
        [BATCH_SIZE]
      );

      if (result.rows.length === 0) break;

      console.log(`\n--- Batch ${batchNumber} (${processed}/${totalRows}) ---`);

      for (const row of result.rows) {
        try {
          // Richer text for more specific codes
          let textToEmbed;
          if (row.indent === 0) {
            textToEmbed = `HTS ${row.htsno}: ${row.descript}`;
          } else {
            // For specific codes, add more context
            textToEmbed = `HTS Code ${row.htsno} - ${row.descript}`;
          }
          
          const embedding = await hf.featureExtraction({
            model: EMBEDDING_MODEL,
            inputs: textToEmbed
          });

          const flatEmbedding = Array.isArray(embedding[0]) ? embedding[0] : embedding;
          
          await pool.query(
            'UPDATE tariff_codes SET embedding = $1 WHERE htsno = $2',
            [`[${flatEmbedding.join(',')}]`, row.htsno]
          );
          
          processed++;
          console.log(`✓ ${processed}/${totalRows} [indent=${row.indent}] ${row.htsno}: ${row.descript.substring(0, 40)}...`);
          
          await new Promise(resolve => setTimeout(resolve, 700));
          
        } catch (embedErr) {
          console.error(`✗ Failed: ${embedErr.message}`);
        }
      }
    }

    console.log(`\n✅ Done! Processed ${processed} embeddings`);
    
  } catch (err) {
    console.error('Fatal error:', err);
  } finally {
    await pool.end();
  }
}

generateEmbeddings();