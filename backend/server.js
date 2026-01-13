import express from "express";
import { query } from "./db/index.js";
import classifyRoutes from "./routes/classify.routes.js";
import dotenv from "dotenv";
import cors from 'cors';

dotenv.config();

const app = express();

app.use(cors())
app.use(express.json());
app.use("/classify", classifyRoutes);

app.get("/health", async (req, res) => {
  try {
    const result = await query("SELECT 1");
    console.log("db health success");
    res.json({ status: "ok", db: result.rows });
  } catch (err) {
    console.error("DB health check failed:", err.message);
    res.status(503).json({ status: "db-unavailable", error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
