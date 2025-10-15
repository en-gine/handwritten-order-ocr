-- migrations/003_add_vector_indexes.sql
-- Create DiskANN vector indexes for similarity search

-- Create index on products embedding (cosine similarity)
CREATE INDEX idx_products_embedding
ON products(libsql_vector_idx(embedding, 'metric=cosine'));

-- Create index on customer_context embedding (cosine similarity)
CREATE INDEX idx_context_embedding
ON customer_context(libsql_vector_idx(embedding, 'metric=cosine'));

-- Create index on order_history embedding (cosine similarity)
CREATE INDEX idx_order_history_embedding
ON order_history(libsql_vector_idx(embedding, 'metric=cosine'));
