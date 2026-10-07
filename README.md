# tasarlayalim-infra

Tasarlayalım'ın telefon-first, çok projeli AI geliştirme altyapısının merkezi bootstrap ve operasyon reposu.

## Hedef mimari

```text
Telefon / ChatGPT
        |
      GitHub
        |
   CI / Quality Gates
        |
      Coolify
        |
      Docker
        |
 *.demo.tasarlayalim.com
```

## Mevcut durum

- Ubuntu Server 24.04 LTS
- Docker + Coolify
- Coolify: `https://coolify.tasarlayalim.com`
- Demo wildcard: `*.demo.tasarlayalim.com`
- GitHub private repository integration
- Agent policy: `AGENTS.md`
- Operations runbook: `PROJECT_RUNBOOK.md`
- Lightweight Docker smoke-test app
- GitHub Actions CI workflow

## Test application

Test uygulaması `docker/test-app` altında bulunur. Amaç GitHub -> CI -> Docker -> Coolify -> demo domain zincirini doğrulamaktır.

Local build örneği:

```bash
docker build -t tasarlayalim-infra-test ./docker/test-app
docker run --rm -p 8080:80 tasarlayalim-infra-test
```

Health check:

```bash
./scripts/healthcheck.sh http://127.0.0.1:8080
```

## Güvenlik

Secret, token, parola, private key veya production credential repository'ye commit edilmez.

Production üzerinde destructive veya geri dönüşü zor işlemler `AGENTS.md` içindeki HIGH IMPACT kurallarına tabidir.
