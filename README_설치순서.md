# DayWith 6.4 — 화면 잠금 중 푸시(진동) 알림

기존 DayWith 6.3의 기록 / Supabase 계정 / SQL 이벤트 테이블은 유지합니다. **다른 AI 개발자 API, API 키, 유료 음성 서비스는 사용하지 않습니다.**

## 무엇이 가능한가?

- **휴대폰 화면이 잠기거나 DayWith 탭을 닫아도**, 예약된 집중 종료 / 운동 시작 / 첫 업무 / PC 마감 알림을 서버에서 발송합니다.
- Android에서는 웹 푸시의 **짧은 진동 패턴**을 요청합니다. 이는 사용자의 시스템 진동/알림 설정에 의해 무시되거나 알림음이 함께 날 수도 있습니다. 문자·음성 합성이나 캐릭터 음성은 잠금 화면에서 실행하지 않습니다.
- 웹 푸시는 **정확한 초 단위 예약이 아닙니다.** Supabase Cron이 매분 확인한 뒤 휴대폰 푸시 서버로 전달하므로 보통 분 단위 지연이 가능합니다. 인터넷, 절전·배터리, 알림 권한, 방해금지 모드에 따라 수신이 안 될 수도 있습니다.
- **지금은 배포 전 테스트 빌드입니다.** 브라우저/UI·예약 코드 모의테스트는 통과했지만 실제 Supabase 서버 배포 및 실물 휴대폰 잠금 중 진동까지는 여기서 검증할 수 없습니다.

## 1. GitHub day 저장소 업데이트

https://github.com/ckdgh546/day 에서 기존 `index.html`을 백업하고 아래 5개 파일을 저장소 최상위에 올립니다.

- `index.html`
- `sw.js` — 푸시가 도착했을 때 알림을 보여주는 필수 서비스 워커
- `manifest.webmanifest` — 휴대폰 홈 화면 설치 정보
- `icon-192.png`
- `icon-512.png`

GitHub Pages 주소는 그대로 **https://ckdgh546.github.io/day/** 입니다. 배포 후 새로고침하고 **DayWith 6.4**가 나오는지 확인합니다. 캐시 때문에 예전 버전이 보이면 잠시 기다린 뒤 사이트 데이터의 캐시만 새로고침합니다. 기존 사이트 저장 데이터는 삭제하지 않는 것이 안전합니다.

## 2. 기존 Supabase에 푸시 테이블만 추가

Supabase Dashboard → SQL Editor → New query 에서 `supabase/01_push_tables.sql` 내용을 붙여넣고 **Run**을 누릅니다.

> 기존의 `daywith_events`나 로그인 계정은 지우지 않습니다. 같은 SQL을 다시 실행해도 이미 있는 테이블은 유지되도록 작성했습니다.

## 3. VAPID 키 및 발송용 비밀 토큰 생성

압축 내 `VAPID_KEYGEN_LOCAL.html` 파일을 **본인 PC에서 로컬로** 열고 **키 새로 만들기**를 누릅니다. 이 파일은 외부 서버에 키를 전송하지 않습니다.

다음 세 값을 기록합니다.

- `VAPID_PUBLIC_KEY` — 사용자 공개키(비밀 아님)
- `VAPID_PRIVATE_KEY` — 푸시 발송 서명 비밀키(**절대 GitHub에 올리지 말 것**)
- `DAYWITH_CRON_TOKEN` — 예약 실행 보호 비밀값(**절대 GitHub에 올리지 말 것**)

생성기에서 키를 새로 만들면 이전 키와 달라집니다. 나중에 키를 새로 바꾸면 휴대폰에서 푸시 등록을 다시 해야 할 수 있습니다.

## 4. Supabase Edge Function 배포 (최초 1회)

Supabase Dashboard → **Edge Functions** → **Deploy a new function / Via Editor**로 `daywith-push`라는 함수를 만듭니다. 편집기에 `supabase/functions/daywith-push/index.ts` 내용을 붙여넣고 배포합니다.

환경 비밀 설정(Edge Functions → Secrets)에 아래 값을 넣습니다.

| Secret 이름 | 값 |
|---|---|
| `VAPID_PUBLIC_KEY` | 3단계에서 만든 공개키 |
| `VAPID_PRIVATE_KEY` | 3단계에서 만든 비밀키 |
| `DAYWITH_CRON_TOKEN` | 3단계에서 만든 보호 토큰 |
| `VAPID_SUBJECT` | `https://ckdgh546.github.io` |

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Supabase Edge 환경에 기본 주입되는 값입니다. **`SUPABASE_SERVICE_ROLE_KEY`나 푸시 비밀키를 절대 HTML/GitHub에 쓰지 마세요.**

**Verify JWT 검사 옵션은 해제**해야 예약 발송 Cron 호출이 가능합니다. 대신 함수 코드가 **일반 사용자의 JWT 검증과 예약 발송 전용 비밀 토큰 검사**를 직접 수행합니다. 배포 도구를 쓰는 경우 `supabase functions deploy daywith-push --no-verify-jwt`로 배포하세요.

먼저 여기까지만 마치고 DayWith 휴대폰 설정에서 **📳 이 기기 알림 켜기 → 🔔 알림 시험**을 눌러보세요. 초록색 성공 안내가 나와도 푸시 서비스가 요청을 수락했다는 뜻이지 휴대폰이 실제로 진동했다는 확정은 아닙니다.

## 5. Supabase Cron으로 실제 예약 시간에 발송

Supabase의 **Cron / pg_cron**과 **pg_net**, **Vault**를 사용합니다. Integrations → Cron에서 필요한 확장이 사용 가능해야 합니다.

`supabase/02_cron_template.sql` 텍스트 중:

- `YOUR_PROJECT_REF`를 본인 Supabase URL의 프로젝트 식별자로 바꿉니다. (예: `https://YOUR_PROJECT_REF.supabase.co`)
- `YOUR_LONG_RANDOM_CRON_TOKEN`은 위에서 생성한 `DAYWITH_CRON_TOKEN`과 **동일한 값**으로 바꿉니다.

그 후 SQL Editor에서 실행합니다. `daywith-push-every-minute` 예약 작업이 1분마다 `daywith-push` Edge Function을 호출합니다. **Vault 설정 실패 또는 Cron 오류가 나면 오류 내용을 확인하고 진행하세요.** Supabase 계정 요금제/쿼터를 확인하고 사용하세요. 별도 OpenAI API를 사용하지 않습니다.

## 6. 휴대폰에서 알림 활성화

1. 휴대폰의 **Chrome**으로 https://ckdgh546.github.io/day/ 접속.
2. Chrome 메뉴에서 **앱 설치 / 홈 화면에 추가**한 뒤 설치된 DayWith를 엽니다. (일반 Chrome 탭에서도 지원될 수 있지만 설치하면 관리가 쉬워집니다.)
3. 예전과 같은 Supabase 계정으로 로그인했는지 확인합니다.
4. DayWith의 **설정 → 📳 잠금 화면 진동 알림 → 이 기기 알림 켜기**를 누르고 알림 권한을 허용합니다.
5. **알림 시험**을 눌러서 알림이 오는지 확인한 뒤 화면을 잠가 놓고 다시 확인합니다. (휴대폰 시스템 **DayWith/Chrome 알림 허용, 진동 허용, 방해 금지** 설정이 중요합니다.)

**진동만 원하면** 삼성 휴대폰의 앱 알림 카테고리에서 알림음을 끄고 진동을 허용하세요. 브라우저/기기에 따라 알림 카테고리 및 진동 지원은 다릅니다. PWA가 진동을 강제하거나 휴대폰 무음/방해금지 정책을 무시할 수는 없습니다.

## 동작하지 않을 때 점검

- DayWith 설정에서 `푸시 서버 설정 필요`라면 Edge Function/Secrets/SQL 단계가 덜 끝난 것입니다.
- `알림을 수신할 기기가 없음`은 해당 휴대폰에서 **이 기기 알림 켜기**를 눌러 구독을 등록해야 한다는 뜻입니다.
- 시험 알림은 되는데 타이머 종료가 안 온다면 Cron Job이 활성화됐는지 / 예약 시각에 앱이 로그인되어 있었는지 확인하세요.
- PC에서 타이머를 시작해도 **휴대폰과 같은 계정**으로 동기화되고, 푸시 기능이 이미 활성화된 상태여야 서버 예약을 만듭니다.
- 앱이 **오프라인에서 집중을 시작**했다면 서버에 종료 시각을 예약할 수 없으므로 잠금 상태 푸시를 보장하지 않습니다.
- 6.4 파일 업로드만 해서는 실제 푸시가 시작되지 않습니다. **Supabase 테이블 + Edge Function + VAPID + Cron 설정과 휴대폰 권한 허용이 필요**합니다.

## 안전 및 개인정보

- 진동 알림의 잠금화면 본문은 업무 제목이나 민감한 기록 대신 일반적인 문구만 전송합니다.
- 푸시 구독 endpoint는 민감한 발송 주소입니다. 별도의 접근 정책을 적용하고 서버 로그에 기록하지 않습니다.
- `service_role` / 비밀 VAPID 키는 브라우저 코드에 포함되지 않습니다.
- 약 복용을 하지 않았다고 서버가 자동으로 복용 완료를 기록하거나, 복용 시각을 임의 변경하지 않습니다.
- 앱은 ChatGPT의 음성/대화 기능을 새로 연결하지 않으며, OpenAI의 별도 유료 개발자 서비스를 사용하지 않습니다.
