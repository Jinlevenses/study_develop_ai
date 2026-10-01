# Task Brief T-00-91 — YAML 범위 fixture

## 2. 범위

```yaml
allowed_paths:
  - tools/sample/src/**
  - 'tools/sample/test/{unit,golden}/**/*.spec.ts'   # 주석은 제거된다
  - tools/sample/package.json
test_ids:
  - UT-SID-001~005
  - UT-SID-010
  - IT-650~652
```

- 테스트 ID 범위: UT-ZZZ-999 (YAML 블록이 있으면 산문은 무시한다)
