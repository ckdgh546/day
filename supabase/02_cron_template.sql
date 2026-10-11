-- 01 SQL 적용, Edge Function 배포, Secrets 등록까지 끝낸 후 실행.
-- YOUR_PROJECT_REF / YOUR_LONG_RANDOM_CRON_TOKEN을 실제 값으로 교체하세요.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- Vault는 Secret을 클라이언트에게 공개하지 않고 DB에 보관합니다.
SELECT vault.create_secret('YOUR_LONG_RANDOM_CRON_TOKEN', 'daywith_push_cron_token');

SELECT cron.schedule(
  'daywith-push-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/daywith-push?mode=run',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-daywith-cron', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='daywith_push_cron_token')
    ),
    body := '{"mode":"run"}'::jsonb,
    timeout_milliseconds := 15000
  );
  $$
);
-- 주의: 프로젝트/대시보드의 pg_cron/pg_net/Vault 활성화 정책에 따라
-- Extensions 화면에서 먼저 활성화해야 할 수 있습니다.
-- 처음엔 Cron을 만들기 전에 '알림 시험'을 확인할 것을 권장합니다.
