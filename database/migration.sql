-- Habilitar extensão para UUID e pg_cron
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- Tabela de produtos
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
    image_url TEXT,
    status TEXT NOT NULL DEFAULT 'Disponível'
        CHECK (status IN ('Disponível', 'Reservado', 'Indisponível Temporariamente', 'Vendido')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reserved_at TIMESTAMPTZ,
    reservation_token UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_status ON products(status);

-- Tabela de histórico de eventos
CREATE TABLE product_events (
    id BIGSERIAL PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_events_product_id ON product_events(product_id);

-- Tabela de configuração geral (única linha)
CREATE TABLE config (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    pix_qr_code_url TEXT,
    pix_copy_paste TEXT,
    whatsapp_number TEXT
);

-- Garantir que sempre exista uma linha de configuração
INSERT INTO config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Função para registrar eventos
CREATE OR REPLACE FUNCTION log_event(
    p_product_id UUID,
    p_event_type TEXT,
    p_description TEXT
) RETURNS void AS $$
BEGIN
    INSERT INTO product_events (product_id, event_type, description)
    VALUES (p_product_id, p_event_type, p_description);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função de reserva (chamada pública)
CREATE OR REPLACE FUNCTION reserve_product(p_product_id UUID)
RETURNS UUID AS $$
DECLARE
    new_token UUID;
BEGIN
    UPDATE products
    SET status = 'Reservado',
        reserved_at = now(),
        reservation_token = gen_random_uuid(),
        updated_at = now()
    WHERE id = p_product_id AND status = 'Disponível'
    RETURNING reservation_token INTO new_token;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto não está disponível para reserva.';
    END IF;

    PERFORM log_event(p_product_id, 'reserva', 'Cliente clicou em Comprar');
    RETURN new_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para expirar uma reserva específica (chamada pelo frontend/cron)
CREATE OR REPLACE FUNCTION expire_reservation(p_product_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE products
    SET status = 'Indisponível Temporariamente',
        updated_at = now()
    WHERE id = p_product_id
      AND status = 'Reservado'
      AND now() > reserved_at + interval '10 minutes';

    IF FOUND THEN
        PERFORM log_event(p_product_id, 'expiracao', 'Reserva expirou');
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função usada pelo cron para expirar todas as reservas vencidas
CREATE OR REPLACE FUNCTION cron_expire_reservations()
RETURNS void AS $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT id FROM products
        WHERE status = 'Reservado'
          AND now() > reserved_at + interval '10 minutes'
    LOOP
        PERFORM expire_reservation(r.id);
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Agendamento do cron (executa a cada minuto)
SELECT cron.schedule(
    'expire-reservations',  -- nome do job
    '* * * * *',            -- a cada minuto
    'SELECT cron_expire_reservations();'
);

-- Função para confirmar pagamento (admin)
CREATE OR REPLACE FUNCTION confirm_payment(p_product_id UUID)
RETURNS void AS $$
DECLARE
    current_status TEXT;
BEGIN
    SELECT status INTO current_status FROM products WHERE id = p_product_id;
    IF current_status NOT IN ('Reservado', 'Indisponível Temporariamente') THEN
        RAISE EXCEPTION 'Transição inválida: produto não está em estado que permite confirmação.';
    END IF;

    UPDATE products
    SET status = 'Vendido',
        updated_at = now()
    WHERE id = p_product_id;

    PERFORM log_event(p_product_id, 'confirmacao', 'Proprietário confirmou pagamento');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para liberar produto (voltar para Disponível) – admin
CREATE OR REPLACE FUNCTION release_product(p_product_id UUID)
RETURNS void AS $$
BEGIN
    IF (SELECT status FROM products WHERE id = p_product_id) <> 'Indisponível Temporariamente' THEN
        RAISE EXCEPTION 'Produto não pode ser liberado a partir do estado atual.';
    END IF;

    UPDATE products
    SET status = 'Disponível',
        reserved_at = NULL,
        reservation_token = NULL,
        updated_at = now()
    WHERE id = p_product_id;

    PERFORM log_event(p_product_id, 'liberacao', 'Produto liberado novamente');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Configuração RLS

-- Habilitar RLS nas tabelas
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE config ENABLE ROW LEVEL SECURITY;

-- Políticas para products
-- Leitura pública de todos os produtos
CREATE POLICY "Public read products" ON products
    FOR SELECT USING (true);

-- Inserção, atualização e deleção apenas para usuários autenticados (admin)
CREATE POLICY "Admin all products" ON products
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- Políticas para product_events
CREATE POLICY "Public read events" ON product_events
    FOR SELECT USING (true);

CREATE POLICY "Admin insert events" ON product_events
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Políticas para config
CREATE POLICY "Public read config" ON config
    FOR SELECT USING (true);

CREATE POLICY "Admin all config" ON config
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- Garantir que as funções possam ser executadas:
-- reserve_product: pública (anônima)
GRANT EXECUTE ON FUNCTION reserve_product TO anon, authenticated;
-- expire_reservation: pública (chamada pelo frontend)
GRANT EXECUTE ON FUNCTION expire_reservation TO anon, authenticated;
-- confirm_payment, release_product: apenas authenticated
GRANT EXECUTE ON FUNCTION confirm_payment TO authenticated;
GRANT EXECUTE ON FUNCTION release_product TO authenticated;
-- log_event: internamente chamada por outras funções, permissão já definida como SECURITY DEFINER
