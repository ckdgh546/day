-- DayWith 6.4: 기존 daywith_events 테이블은 변경하지 않습니다.
-- Supabase SQL Editor에서 아래 내용을 한 번 실행하세요.
CREATE TABLE IF NOT EXISTS public.daywith_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL CHECK (length(endpoint) BETWEEN 30 AND 4096),
  p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 20 AND 256),
  auth_key text NOT NULL CHECK (length(auth_key) BETWEEN 8 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);
CREATE INDEX IF NOT EXISTS daywith_push_subscriptions_user ON public.daywith_push_subscriptions(user_id);
ALTER TABLE public.daywith_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daywith_push_subscriptions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daywith_push_subscriptions TO authenticated;
DROP POLICY IF EXISTS dw_push_subscription_owner ON public.daywith_push_subscriptions;
CREATE POLICY dw_push_subscription_owner ON public.daywith_push_subscriptions
  FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE TABLE IF NOT EXISTS public.daywith_push_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_key text NOT NULL CHECK (length(job_key) BETWEEN 3 AND 120),
  due_at timestamptz NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 240),
  destination text NOT NULL DEFAULT '/day/' CHECK (destination IN ('/day/','/day/?from=push')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','cancelled','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id,job_key)
);
CREATE INDEX IF NOT EXISTS daywith_push_due ON public.daywith_push_jobs(due_at)
 WHERE status IN ('pending','processing');
ALTER TABLE public.daywith_push_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daywith_push_jobs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daywith_push_jobs TO authenticated;
DROP POLICY IF EXISTS dw_push_jobs_owner ON public.daywith_push_jobs;
CREATE POLICY dw_push_jobs_owner ON public.daywith_push_jobs
  FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- 동시 실행되더라도 동일한 예약을 중복 선점하지 않도록 처리
CREATE OR REPLACE FUNCTION public.daywith_claim_push_jobs(max_jobs integer DEFAULT 30)
RETURNS SETOF public.daywith_push_jobs LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $$
BEGIN
  RETURN QUERY
  UPDATE public.daywith_push_jobs j
     SET status='processing', claimed_at=now(), attempts=j.attempts+1
   WHERE j.id IN (
      SELECT c.id FROM public.daywith_push_jobs c
      WHERE ((c.status='pending') OR (c.status='processing' AND c.claimed_at < now()-interval '5 minutes'))
        AND c.due_at <= now() AND c.due_at >= now()-interval '2 hours'
        AND c.attempts < 3
      ORDER BY c.due_at
      LIMIT LEAST(GREATEST(max_jobs,1),50) FOR UPDATE SKIP LOCKED
    ) RETURNING j.*;
END $$;
REVOKE ALL ON FUNCTION public.daywith_claim_push_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daywith_claim_push_jobs(integer) TO service_role;
