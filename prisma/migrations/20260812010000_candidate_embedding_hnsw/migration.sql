-- HNSW index for talent-pool cosine similarity (pgvector)
-- Requires Candidate.embedding vector(768) from init migration.

CREATE INDEX IF NOT EXISTS "Candidate_embedding_hnsw_idx"
  ON "Candidate"
  USING hnsw (embedding vector_cosine_ops);
