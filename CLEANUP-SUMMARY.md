# 🧹 Resumo de Limpeza de Recursos

Data: 02 de Outubro de 2025

## ✅ **LIMPEZA REALIZADA**

### 1. **Filas SQS deletadas** ✅
- `talksy-meetingbot-jobs-test-standard`
- `talksy-meetingbot-jobs-test.fifo`
- `talksy-meetingbot-jobs-dlq.fifo`

**Economia**: ~$0.10/mês

### 2. **Serviços ECS deletados** ✅
- `meetingbot-dev-meetingbot-service` (DRAINING)
- `meetingbot-dev-server` (DRAINING)

**Economia**: $0 (apenas organização)

---

## ⚠️ **RECURSOS QUE PRECISAM DE DECISÃO MANUAL**

### 1. **Buckets S3 com gravações antigas**

#### `meetingbot-dev-52866384-bot-data` - 48 arquivos (~60 MB)
Contém gravações de setembro/2025. **Não deletar antes de migrar!**

**Ação recomendada**:
```bash
# Migrar gravações para bucket principal
aws s3 sync s3://meetingbot-dev-52866384-bot-data s3://talksy-videos-dev-0c18ea10/legacy/52866384/ --region us-east-1

# Depois deletar
aws s3 rb s3://meetingbot-dev-52866384-bot-data --force --region us-east-1
```

#### `meetingbot-dev-44989554-bot-data` - 2 arquivos
Bucket antigo com poucos arquivos.

**Ação recomendada**: Revisar e migrar se necessário

#### `talksy-meetingbot` - 1 arquivo
Bucket antigo.

**Ação recomendada**: Revisar e migrar se necessário

---

### 2. **Banco RDS de Produção**

**`meetingbot-prod`** (PostgreSQL db.t4g.micro)
- **Status**: Available
- **Custo**: ~$15-20/mês
- **Uso**: Não está sendo usado atualmente

**Opções**:
1. **Criar snapshot e deletar**:
   ```bash
   aws rds create-db-snapshot \
     --db-instance-identifier meetingbot-prod \
     --db-snapshot-identifier meetingbot-prod-backup-20251002 \
     --region us-east-1
   
   # Aguardar snapshot completar
   # Depois deletar
   aws rds delete-db-instance \
     --db-instance-identifier meetingbot-prod \
     --skip-final-snapshot \
     --region us-east-1
   ```

2. **Parar instance** (RDS não permite "stop" permanente, apenas 7 dias)

3. **Manter** (se pretende usar em produção)

---

### 3. **Load Balancer de Produção**

**`meetingbot-prod-alb`**
- **Status**: Active
- **Custo**: ~$16/mês  
- **Uso**: Não está sendo usado

**Ação recomendada**:
```bash
# Se não for usar, deletar
aws elbv2 delete-load-balancer \
  --load-balancer-arn arn:aws:elasticloadbalancing:us-east-1:228692667167:loadbalancer/app/meetingbot-prod-alb/919898503 \
  --region us-east-1
```

---

### 4. **Target Group Antigo**

**`meetingbot-dev-server-instance`**
- **Tipo**: instance (incompatível com awsvpc)
- **Substituído por**: meetingbot-dev-server-ip2

**Ação recomendada**:
```bash
aws elbv2 delete-target-group \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:228692667167:targetgroup/meetingbot-dev-server-instance/e14c12ff844e1369 \
  --region us-east-1
```

---

## 💰 **Economia Potencial Total**

| Recurso | Custo/Mês | Status |
|---------|-----------|--------|
| Filas SQS de teste | $0.10 | ✅ Deletado |
| Bucket S3 antigo (após migração) | $0.50 | ⏳ Pendente |
| Banco RDS prod | $15-20 | ⏳ Decisão manual |
| Load Balancer prod | $16 | ⏳ Decisão manual |
| **TOTAL** | **$32-37** | |

---

## 📊 **Recursos MANTIDOS (Em Uso)**

✅ **Bucket S3**: `talksy-videos-dev-0c18ea10`  
✅ **Fila SQS**: `talksy-meetingbot-jobs.fifo`  
✅ **Fila SQS**: `talksy-recording-completed.fifo`  
✅ **Banco RDS**: `meetingbot-dev`  
✅ **ECS Services**:
  - `meetingbot-dev-server-new`
  - `meetingbot-dev-service-processor`  
✅ **Load Balancer**: `meetingbot-dev-alb`  
✅ **ECR Repositories**: meetingbot-service, meetingbot-bot, meetingbot-server

---

## 🎯 **Próximos Passos Recomendados**

1. ✅ **Filas de teste** - Deletadas
2. ⏳ **Migrar gravações** dos buckets antigos
3. ⏳ **Decidir sobre banco prod** (snapshot + delete ou manter)
4. ⏳ **Decidir sobre LB prod** (delete se não usar)
5. ⏳ **Deletar target group antigo**

**Total de economia imediata**: $0.10/mês  
**Potencial após limpeza completa**: $32-37/mês

