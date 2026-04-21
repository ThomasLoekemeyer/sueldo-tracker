-- Schema para sueldo-tracker
-- Ejecutar en: https://supabase.com/dashboard/project/ljwlanwmnuqgxftlirhh/sql/new

CREATE TABLE IF NOT EXISTS public.movimientos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tipo TEXT NOT NULL CHECK (tipo IN ('horas', 'ingreso', 'egreso')),
  horas NUMERIC,
  monto NUMERIC NOT NULL,
  descripcion TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON public.movimientos (fecha DESC);

ALTER TABLE public.movimientos ENABLE ROW LEVEL SECURITY;

-- Single-user, sin auth: el anon key puede hacer todo.
-- Si más adelante se agrega Supabase Auth, cambiar a USING (auth.uid() = user_id).
CREATE POLICY "sueldo_allow_all" ON public.movimientos
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
