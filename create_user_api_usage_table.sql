-- Criar tabela user_api_usage para o MeetingBot Service
-- Esta é a tabela que o MeetingBot Service está tentando acessar

CREATE TABLE IF NOT EXISTS user_api_usage (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    month VARCHAR(7) NOT NULL, -- formato YYYY-MM
    year INTEGER NOT NULL,
    api_calls INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inserir dados de exemplo
INSERT INTO user_api_usage (user_id, month, year, api_calls) 
VALUES 
    ('user123', '2024-01', 2024, 150),
    ('user456', '2024-01', 2024, 75),
    ('user789', '2024-01', 2024, 200)
ON CONFLICT (user_id, month, year) 
DO UPDATE SET 
    api_calls = user_api_usage.api_calls + EXCLUDED.api_calls,
    updated_at = CURRENT_TIMESTAMP;

-- Verificar se foi criada
SELECT * FROM user_api_usage;
