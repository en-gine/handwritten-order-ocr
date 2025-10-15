-- migrations/002_add_vector_embeddings.sql
-- Add vector embedding columns (F32_BLOB type) for semantic matching

-- Add embedding column to products (768-dim F32 vector)
ALTER TABLE products ADD COLUMN embedding F32_BLOB(768);

-- Add embedding column to customer_context
ALTER TABLE customer_context ADD COLUMN embedding F32_BLOB(768);

-- Add embedding column to order_history
ALTER TABLE order_history ADD COLUMN embedding F32_BLOB(768);
