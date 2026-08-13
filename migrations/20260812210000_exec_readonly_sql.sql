-- Función de solo lectura para ejecutar SELECT dinámico con tope de 50 filas.
-- Validación de palabras prohibidas y de que comience con SELECT/WITH.
-- Devuelve las filas como JSONB (array de objetos).
CREATE OR REPLACE FUNCTION public.exec_readonly_sql(p_query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  normalized TEXT;
  final_query TEXT;
  result JSONB;
BEGIN
  normalized := btrim(p_query);
  IF normalized = '' THEN
    RAISE EXCEPTION 'Query vacia';
  END IF;

  -- Quitar posibles bloques de codigo (```sql ... ```)
  normalized := regexp_replace(normalized, '^```[A-Za-z]*\s*', '', 'i');
  normalized := regexp_replace(normalized, '```\s*$', '');
  normalized := btrim(normalized);

  -- Debe ser una consulta de solo lectura (en PG \y = word boundary)
  IF normalized !~* '^\s*(SELECT|WITH)\y' THEN
    RAISE EXCEPTION 'Solo se permiten consultas SELECT';
  END IF;

  IF normalized ~* '\y(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|VACUUM|EXECUTE|COMMENT|REINDEX|CALL|DO|PREPARE|DEALLOCATE|NOTIFY|LISTEN|UNLISTEN|SET)\y' THEN
    RAISE EXCEPTION 'Consulta no permitida: contiene una instruccion no-SELECT';
  END IF;

  -- Tope de 50 filas
  normalized := btrim(normalized, '; ');
  IF normalized !~* '\ylimit\y' THEN
    normalized := normalized || ' LIMIT 50';
  END IF;

  final_query := 'SELECT coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (' || normalized || ') AS t';
  EXECUTE final_query INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.exec_readonly_sql(TEXT) FROM PUBLIC;
