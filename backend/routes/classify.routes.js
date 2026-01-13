// routes/classify.routes.js
import express from "express";
import { ChatGroq } from "@langchain/groq";
import { PromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import { retrieveHTSCodes } from "../utils/retrieval.js";
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Define structured output schema
const classificationSchema = z.object({
  hts_code: z.string().describe("The selected HTS code"),
  hts_code_description: z.string().describe("Full description of the selected code"),
  confidence: z.number().min(0).max(1).describe("Confidence score 0-1"),
  chapter: z.string().describe("Chapter number (2 digits)"),
  chapter_description: z.string().describe("Chapter description"),
  heading: z.string().describe("Heading number (4 digits)"),
  heading_description: z.string().describe("Heading description"),
  subheading: z.string().describe("Subheading number (6+ digits)"),
  subheading_description: z.string().describe("Subheading description"),
  reasoning_brief: z.string().describe("One sentence why this code was selected"),
  alternative_codes: z.array(z.string()).describe("Other considered HTS codes")
});

const parser = StructuredOutputParser.fromZodSchema(classificationSchema);

// Initialize LLM
const llm = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY,
  model: "llama-3.3-70b-versatile",
  temperature: 0,
  maxTokens: 600
});

// Classification prompt template
const classificationPrompt = PromptTemplate.fromTemplate(`You are an expert HTS classifier. Select the most appropriate code from the candidates.

Product Description: {product_description}
Country of Origin: {country_of_origin}

Retrieved Candidate Codes:
{candidates}

Selection Criteria:
1. Most specific match to product description
2. Consider semantic accuracy over similarity score
3. Prefer more detailed subheadings (higher indent)
4. Must select from provided candidates only

{format_instructions}

Provide brief reasoning (1 sentence) and list alternatives considered.`);

// Justification generation prompt (separate, detailed)
const justificationPrompt = PromptTemplate.fromTemplate(`Generate a formal HTS classification justification document.

Product: {product_description}
Selected Code: {hts_code}
Code Description: {hts_code_description}
Chapter: {chapter} - {chapter_description}
Heading: {heading} - {heading_description}
Subheading: {subheading} - {subheading_description}

Alternative Codes Considered:
{alternatives}

Brief Reasoning: {reasoning_brief}

Generate a professional justification following this structure:

# Classification Justification for Code {hts_code}

## Understanding the Product
[2-3 sentences describing the product and its key classification characteristics]

## Relevant Tariff Structure
**Chapter {chapter}**: {chapter_description}
**Heading {heading}**: {heading_description}
**Subheading {subheading}**: {subheading_description}

## Why This Classification
[3-4 sentences explaining why this code is correct, referencing the HTS structure]

## Exclusion of Alternatives
[2-3 sentences explaining why alternative codes were not selected]

## Conclusion
The classification of {hts_code} is justified based on [1-2 sentences summarizing key factors].

Keep it concise (under 400 words) and professional.`);

router.post("/", async (req, res) => {
  const { product_description, country_of_origin = "Unknown" } = req.body || {};
  
  if (!product_description?.trim()) {
    return res.status(400).json({ error: "product_description is required" });
  }

  try {
    console.log(`🔍 Classifying: "${product_description}"`);
    
    // Step 1: RAG Retrieval
    const candidates = await retrieveHTSCodes(product_description, 5);
    
    if (candidates.length === 0) {
      return res.status(404).json({ 
        error: "no_candidates_found",
        message: "No HTS codes found in database"
      });
    }

    // Format candidates for prompt
    const candidatesText = candidates
      .map((c, i) => 
        `${i + 1}. Code: ${c.code} | ${c.description} | Similarity: ${(c.similarity * 100).toFixed(1)}%`
      )
      .join('\n');

    // Step 2: LLM Classification with Structured Output
    const classificationChain = classificationPrompt.pipe(llm).pipe(parser);
    
    const classification = await classificationChain.invoke({
      product_description,
      country_of_origin,
      candidates: candidatesText,
      format_instructions: parser.getFormatInstructions()
    });

    console.log("✅ Classification:", classification.hts_code);

    // Step 3: Generate Detailed Justification (separate call for token efficiency)
    const justificationChain = justificationPrompt.pipe(llm);
    
    const justificationResponse = await justificationChain.invoke({
      product_description,
      hts_code: classification.hts_code,
      hts_code_description: classification.hts_code_description,
      chapter: classification.chapter,
      chapter_description: classification.chapter_description,
      heading: classification.heading,
      heading_description: classification.heading_description,
      subheading: classification.subheading,
      subheading_description: classification.subheading_description,
      alternatives: classification.alternative_codes.join(', '),
      reasoning_brief: classification.reasoning_brief
    });

    const justification = justificationResponse.content;

    // Step 4: Return comprehensive response
    res.json({
      classification: {
        hts_code: classification.hts_code,
        description: classification.hts_code_description,
        confidence: classification.confidence,
        structure: {
          chapter: {
            code: classification.chapter,
            description: classification.chapter_description
          },
          heading: {
            code: classification.heading,
            description: classification.heading_description
          },
          subheading: {
            code: classification.subheading,
            description: classification.subheading_description
          }
        },
        alternatives_considered: classification.alternative_codes
      },
      justification: justification,
      retrieved_candidates: candidates.map(c => ({
        code: c.code,
        description: c.description,
        similarity: parseFloat((c.similarity * 100).toFixed(1))
      })),
      metadata: {
        rag_enabled: true,
        langchain_version: "0.3.x",
        retrieval_count: candidates.length
      }
    });

  } catch (err) {
    console.error("❌ Classification error:", err);
    res.status(500).json({ 
      error: "classification_failed", 
      details: err.message 
    });
  }
});

export default router;