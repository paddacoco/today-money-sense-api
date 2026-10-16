# 오늘의 금액감각 API - Render 배포용

이 폴더 전체를 GitHub 저장소의 새 브랜치 또는 새 저장소 루트에 업로드한 뒤 Render Web Service로 배포하면 됩니다.

## Render 설정
- Runtime: Docker
- Region: Singapore
- Plan: Free
- Dockerfile Path: `./Dockerfile`
- Docker Context: `.`
- Health Check Path: `/health`

## 환경변수
Render > Environment에서 필요한 값만 직접 등록하세요.

- `ALLOWED_ORIGIN=*`
- `PUBLIC_DATA_API_KEY=<공공데이터포털/고용24에 사용하는 키>`
- `KOSIS_API_KEY=<KOSIS 키가 있으면 입력>`
- `KOSIS_TABLE_SPECS_JSON=[]`
- `FTC_STARTUP_COST_URL=<공정위 API 엔드포인트를 확인한 뒤 입력>`

API 키는 GitHub에 커밋하지 마세요.

## 엔드포인트
- `GET /health`
- `GET /api/providers/health`
- `GET /api/questions/daily?date=YYYY-MM-DD`
- `POST /api/questions/practice`
  - JSON body: `{ "date": "YYYY-MM-DD", "exclude": [] }`

외부 API가 설정되지 않았거나 일시적으로 실패해도 기본 문제은행으로 동작하도록 구성되어 있습니다.
