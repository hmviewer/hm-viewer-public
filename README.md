# HM Viewer

시즌 기여도와 HM 서버 점수를 확인하는 Vercel 배포용 공개 소스입니다.

## 배포 환경변수

Vercel Project Settings > Environment Variables에 아래 값을 설정해야 합니다.

- `ADMIN_USERNAME`: 초기 관리자 아이디
- `ADMIN_PASSWORD`: 초기 관리자 비밀번호
- `SESSION_SECRET`: 세션 서명용 긴 임의 문자열
- `KV_REST_API_URL`: Vercel KV REST URL
- `KV_REST_API_TOKEN`: Vercel KV REST Token

`ADMIN_PASSWORD`, `SESSION_SECRET`, KV 토큰은 GitHub에 커밋하지 않습니다.

## 배포

이 저장소를 Public GitHub repository로 만든 뒤 Vercel Hobby 프로젝트에 연결하면 됩니다.

로컬 미리보기용 기본 관리자 계정은 공개 소스에 포함하지 않았습니다. 실제 로그인은 Vercel API와 환경변수/KV를 통해 처리됩니다.
